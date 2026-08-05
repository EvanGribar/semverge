import { basename, dirname, posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseVersion } from "./semver.js";
import { readTargetName, readTargetVersion, type VersionTarget } from "./version-adapters.js";
import type { Ecosystem, MonorepoMode, SemVergeConfig, WorkspaceDependencyField } from "./types.js";

export interface PackageDescriptor extends VersionTarget {
  id: string;
  name: string;
  version: string;
  private: boolean;
  releaseable: boolean;
  workspaceDependencies: string[];
  workspaceDependencyTypes: Record<string, WorkspaceDependencyField[]>;
}

export interface PackageDiscoveryResult {
  mode: Exclude<MonorepoMode, "auto">;
  packages: PackageDescriptor[];
}

function normalize(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function jsonObject(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function tomlArray(content: string, sectionName: string, key: string): string[] {
  let section = "";
  let value = "";
  let collecting = false;
  for (const line of content.split(/\r?\n/)) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      collecting = false;
      value = "";
      continue;
    }
    if (section !== sectionName) {
      continue;
    }
    if (!collecting) {
      const keyMatch = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
      if (!keyMatch) {
        continue;
      }
      value = keyMatch[1] ?? "";
    } else {
      value += line;
    }
    collecting = !value.includes("]");
    if (!collecting) {
      break;
    }
  }
  return [...value.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]?.trim() ?? "").filter(Boolean);
}

function tomlWorkspacePatterns(rootContent: string, ecosystem: Ecosystem): string[] {
  const sections = ecosystem === "rust" ? ["workspace"] : ["tool.uv.workspace", "tool.pdm.workspace"];
  return sections.flatMap((section) => tomlArray(rootContent, section, "members"));
}

function workspacePatterns(rootContent: string, pnpmWorkspaceContent: string | undefined, config: SemVergeConfig, ecosystem: Ecosystem): string[] {
  if (config.monorepo.packages.length > 0) {
    return config.monorepo.packages.map(normalize);
  }
  if (ecosystem === "python" || ecosystem === "rust") {
    return tomlWorkspacePatterns(rootContent, ecosystem).map(normalize);
  }
  const root = jsonObject(rootContent);
  const workspaces = root?.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((item): item is string => typeof item === "string").map(normalize);
  }
  if (workspaces && typeof workspaces === "object" && !Array.isArray(workspaces)) {
    const packages = (workspaces as Record<string, unknown>).packages;
    if (Array.isArray(packages)) {
      return packages.filter((item): item is string => typeof item === "string").map(normalize);
    }
  }
  if (pnpmWorkspaceContent) {
    try {
      const parsed: unknown = parseYaml(pnpmWorkspaceContent);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const packages = (parsed as Record<string, unknown>).packages;
        if (Array.isArray(packages)) {
          return packages.filter((item): item is string => typeof item === "string").map(normalize);
        }
      }
    } catch {
      // An invalid optional workspace file should be reported by the repository's own checks.
    }
  }
  return [];
}

function globRegex(pattern: string): RegExp {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character?.replace(/[.+^${}()|[\]\\]/g, "\\$&") ?? "";
    }
  }
  return new RegExp(`${expression}$`);
}

function matchesWorkspace(pattern: string, packagePath: string): boolean {
  const normalizedPattern = normalize(pattern);
  const candidate = normalize(packagePath);
  const manifestName = basename(candidate);
  const packagePattern = normalizedPattern.endsWith(`/${manifestName}`) || normalizedPattern === manifestName ? normalizedPattern : `${normalizedPattern}/${manifestName}`;
  return globRegex(packagePattern).test(candidate);
}

function packageTarget(path: string): { ecosystem: Ecosystem; directory: string } | null {
  const normalized = normalize(path);
  if (normalized.endsWith("/package.json") || normalized === "package.json") {
    return { ecosystem: "node", directory: normalized === "package.json" ? "" : dirname(normalized).replace(/\\/g, "/") };
  }
  if (normalized.endsWith("/pyproject.toml") || normalized === "pyproject.toml") {
    return { ecosystem: "python", directory: normalized === "pyproject.toml" ? "" : dirname(normalized).replace(/\\/g, "/") };
  }
  if (normalized.endsWith("/Cargo.toml") || normalized === "Cargo.toml") {
    return { ecosystem: "rust", directory: normalized === "Cargo.toml" ? "" : dirname(normalized).replace(/\\/g, "/") };
  }
  return null;
}

function descriptor(path: string, content: string, releaseable: boolean): PackageDescriptor {
  const normalized = normalize(path);
  const target = packageTarget(normalized);
  if (!target) {
    throw new Error(`Unsupported package manifest: ${path}`);
  }
  const name = readTargetName({ ecosystem: target.ecosystem, manifestPath: normalized, directory: target.directory }, content) ?? (target.directory || basename(dirname(normalized)) || "root");
  const version = readTargetVersion({ ecosystem: target.ecosystem, manifestPath: normalized, directory: target.directory }, content);
  if (!parseVersion(version)) {
    throw new Error(`${normalized} contains an invalid semantic version: ${version}`);
  }
  const privateValue = target.ecosystem === "node" ? Boolean(jsonObject(content)?.private) : false;
  const workspaceDependencyTypes = target.ecosystem === "node" ? nodeWorkspaceDependencyTypes(content) : {};
  return {
    id: target.directory || name,
    name,
    manifestPath: normalized,
    version,
    private: privateValue,
    releaseable: releaseable && !privateValue,
    workspaceDependencies: Object.keys(workspaceDependencyTypes),
    workspaceDependencyTypes,
    ...target
  };
}

function targetVersionPresent(path: string, content: string): boolean {
  const target = packageTarget(path);
  if (!target) {
    return false;
  }
  try {
    return Boolean(readTargetVersion({ ecosystem: target.ecosystem, manifestPath: normalize(path), directory: target.directory }, content).trim());
  } catch {
    return false;
  }
}

function nodeWorkspaceDependencyTypes(content: string, internalPackageNames: ReadonlySet<string> = new Set<string>()): Record<string, WorkspaceDependencyField[]> {
  const value = jsonObject(content);
  if (!value) {
    return {};
  }
  const types: Record<string, WorkspaceDependencyField[]> = {};
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    const dependencies = value[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
      continue;
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === "string" && (version.startsWith("workspace:") || internalPackageNames.has(name))) {
        types[name] = [...new Set([...(types[name] ?? []), field])];
      }
    }
  }
  return types;
}

function selectedMode(config: SemVergeConfig, packages: PackageDescriptor[]): Exclude<MonorepoMode, "auto"> {
  if (config.monorepo.mode !== "auto") {
    return config.monorepo.mode;
  }
  if (packages.length <= 1) {
    return "single";
  }
  const versions = new Set(packages.map((item) => item.version));
  return versions.size === 1 ? "fixed" : "independent";
}

export function discoverPackages(files: Record<string, string>, allPaths: string[], config: SemVergeConfig): PackageDiscoveryResult {
  const normalizedFiles = new Map(Object.entries(files).map(([path, content]) => [normalize(path), content]));
  const rootNode = normalizedFiles.get("package.json");
  const pnpmWorkspace = normalizedFiles.get("pnpm-workspace.yaml");
  const rootPython = normalizedFiles.get("pyproject.toml");
  const rootRust = normalizedFiles.get("Cargo.toml");
  const discovered: PackageDescriptor[] = [];

  if (rootNode) {
    const rootObject = jsonObject(rootNode);
    const rootIsPrivate = Boolean(rootObject?.private);
    if (config.monorepo.includeRoot || !rootIsPrivate) {
      discovered.push(descriptor("package.json", rootNode, config.monorepo.includeRoot));
    }
    const patterns = config.monorepo.mode === "single" ? [] : workspacePatterns(rootNode, pnpmWorkspace, config, "node");
    for (const path of [...new Set(allPaths.map(normalize))].filter((item) => item.endsWith("/package.json") && item !== "package.json")) {
      const content = normalizedFiles.get(path);
      if (content && patterns.some((pattern) => matchesWorkspace(pattern, path))) {
        discovered.push(descriptor(path, content, true));
      }
    }
  } else if (rootPython) {
    const patterns = config.monorepo.mode === "single" ? [] : workspacePatterns(rootPython, undefined, config, "python");
    if (config.monorepo.includeRoot && targetVersionPresent("pyproject.toml", rootPython)) {
      discovered.push(descriptor("pyproject.toml", rootPython, true));
    } else if (config.monorepo.includeRoot && patterns.length === 0) {
      discovered.push(descriptor("pyproject.toml", rootPython, true));
    }
    for (const path of [...new Set(allPaths.map(normalize))].filter((item) => item.endsWith("/pyproject.toml") && item !== "pyproject.toml")) {
      const content = normalizedFiles.get(path);
      if (content && patterns.some((pattern) => matchesWorkspace(pattern, path))) {
        discovered.push(descriptor(path, content, true));
      }
    }
  } else if (rootRust) {
    const patterns = config.monorepo.mode === "single" ? [] : workspacePatterns(rootRust, undefined, config, "rust");
    if (config.monorepo.includeRoot && targetVersionPresent("Cargo.toml", rootRust)) {
      discovered.push(descriptor("Cargo.toml", rootRust, true));
    } else if (config.monorepo.includeRoot && patterns.length === 0) {
      discovered.push(descriptor("Cargo.toml", rootRust, true));
    }
    for (const path of [...new Set(allPaths.map(normalize))].filter((item) => item.endsWith("/Cargo.toml") && item !== "Cargo.toml")) {
      const content = normalizedFiles.get(path);
      if (content && patterns.some((pattern) => matchesWorkspace(pattern, path))) {
        discovered.push(descriptor(path, content, true));
      }
    }
  }

  const unique = [...new Map(discovered.map((item) => [item.manifestPath, item])).values()];
  if (unique.length === 0) {
    throw new Error("SemVerge could not find a supported package manifest (package.json, pyproject.toml, or Cargo.toml).");
  }
  const internalPackageNames = new Set(unique.filter((item) => item.ecosystem === "node").map((item) => item.name));
  for (const packageItem of unique.filter((item) => item.ecosystem === "node")) {
    const content = normalizedFiles.get(packageItem.manifestPath);
    if (content !== undefined) {
      packageItem.workspaceDependencyTypes = nodeWorkspaceDependencyTypes(content, internalPackageNames);
      packageItem.workspaceDependencies = Object.keys(packageItem.workspaceDependencyTypes);
    }
  }
  return { mode: selectedMode(config, unique), packages: unique };
}

export function packagePath(packageItem: PackageDescriptor, relativePath: string): string {
  const clean = normalize(relativePath);
  return packageItem.directory ? posix.join(packageItem.directory, clean) : clean;
}
