import { basename, dirname, posix } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseVersion } from "./semver.js";
import { readTargetName, readTargetVersion, type VersionTarget } from "./version-adapters.js";
import type { Ecosystem, MonorepoMode, ShipkitConfig } from "./types.js";

export interface PackageDescriptor extends VersionTarget {
  id: string;
  name: string;
  version: string;
  private: boolean;
  releaseable: boolean;
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

function workspacePatterns(rootContent: string, pnpmWorkspaceContent: string | undefined, config: ShipkitConfig): string[] {
  if (config.monorepo.packages.length > 0) {
    return config.monorepo.packages.map(normalize);
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
  const packagePattern = normalizedPattern.endsWith("/package.json") ? normalizedPattern : `${normalizedPattern}/package.json`;
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
  const root = target.directory === "";
  const privateValue = target.ecosystem === "node" ? Boolean(jsonObject(content)?.private) : false;
  return {
    id: target.directory || name,
    name,
    manifestPath: normalized,
    version,
    private: privateValue,
    releaseable: releaseable && !privateValue,
    ...target
  };
}

function selectedMode(config: ShipkitConfig, packages: PackageDescriptor[]): Exclude<MonorepoMode, "auto"> {
  if (config.monorepo.mode !== "auto") {
    return config.monorepo.mode;
  }
  if (packages.length <= 1) {
    return "single";
  }
  const versions = new Set(packages.map((item) => item.version));
  return versions.size === 1 ? "fixed" : "independent";
}

export function discoverPackages(files: Record<string, string>, allPaths: string[], config: ShipkitConfig): PackageDiscoveryResult {
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
    const patterns = config.monorepo.mode === "single" ? [] : workspacePatterns(rootNode, pnpmWorkspace, config);
    for (const path of [...new Set(allPaths.map(normalize))].filter((item) => item.endsWith("/package.json") && item !== "package.json")) {
      const content = normalizedFiles.get(path);
      if (content && patterns.some((pattern) => matchesWorkspace(pattern, path))) {
        discovered.push(descriptor(path, content, true));
      }
    }
  } else if (rootPython) {
    discovered.push(descriptor("pyproject.toml", rootPython, true));
  } else if (rootRust) {
    discovered.push(descriptor("Cargo.toml", rootRust, true));
  }

  const unique = [...new Map(discovered.map((item) => [item.manifestPath, item])).values()];
  if (unique.length === 0) {
    throw new Error("Shipkit could not find a supported package manifest (package.json, pyproject.toml, or Cargo.toml).");
  }
  return { mode: selectedMode(config, unique), packages: unique };
}

export function packagePath(packageItem: PackageDescriptor, relativePath: string): string {
  const clean = normalize(relativePath);
  return packageItem.directory ? posix.join(packageItem.directory, clean) : clean;
}
