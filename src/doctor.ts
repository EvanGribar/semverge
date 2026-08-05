import { execFile as execFileCallback } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { promisify } from "node:util";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseConfig } from "./config.js";
import { compareVersions, parseVersion } from "./semver.js";
import type { MonorepoMode } from "./types.js";

const execFile = promisify(execFileCallback);
const MAX_DISCOVERY_FILES = 10_000;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "lib", "coverage", ".next", ".turbo", "target", "vendor"]);
const PACKAGE_MANAGER_LOCKFILES = ["pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json"];
const KNOWN_ROOT_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".yarnrc.yml",
  ".semverge.yml",
  "release-please-config.json",
  ".release-please-manifest.json",
  ".releaserc",
  ".releaserc.json",
  ".releaserc.yml",
  ".releaserc.yaml",
  "release.config.js",
  "release.config.cjs",
  "release.config.mjs",
  ...PACKAGE_MANAGER_LOCKFILES
]);
const BUILD_SCRIPT_NAMES = new Set(["build", "prepare", "prepack", "prepublishOnly", "release"]);

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun" | "unknown" | "multiple";
export type SetupStatus = "detected" | "not-detected" | "review";

export interface PackageManagerDiagnostic {
  name: PackageManagerName;
  source: string;
  lockfiles: string[];
}

export interface WorkspaceDiagnostic {
  kind: "single-package" | "workspace" | "unsupported";
  patterns: string[];
  packageCount: number;
  strategy: "single" | "fixed" | "independent" | "unknown";
}

export interface VersionDiagnostic {
  rootVersion?: string;
  packageVersions: Array<{ path: string; name?: string; version: string }>;
  tagCount: number;
  latestTag?: string;
  latestTagVersion?: string;
  gitAvailable: boolean;
}

export interface ReleaseToolDiagnostic {
  name: "release-please" | "changesets" | "semantic-release" | "semverge";
  sources: string[];
}

export interface BuildDiagnostic {
  scripts: string[];
  hasBuildHook: boolean;
}

export interface RegistryDiagnostic {
  status: SetupStatus;
  registry?: string;
  sources: string[];
  trustedPublishing: SetupStatus;
}

export interface GitHubDiagnostic {
  workflowFiles: string[];
  semvergeWorkflow: boolean;
  publishWorkflows: string[];
  permissions: {
    contents: string;
    pullRequests: string;
    idToken: string;
    actions: string;
  };
}

export interface RepositoryDoctorReport {
  path: string;
  packageManager: PackageManagerDiagnostic;
  workspace: WorkspaceDiagnostic;
  versions: VersionDiagnostic;
  releaseTools: ReleaseToolDiagnostic[];
  build: BuildDiagnostic;
  registry: RegistryDiagnostic;
  github: GitHubDiagnostic;
  warnings: string[];
}

interface JsonPackage {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  workspaces?: unknown;
  scripts?: unknown;
  publishConfig?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
}

interface RepositoryFile {
  path: string;
  content: string;
}

interface WorkflowObservation {
  path: string;
  content: string;
  publish: boolean;
  semverge: boolean;
  permissions: Record<string, string>;
  idTokenWrite: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function discoverRepositoryFiles(cwd: string): Promise<{ files: RepositoryFile[]; truncated: boolean }> {
  const files: RepositoryFile[] = [];
  let visited = 0;

  async function visit(directory: string): Promise<void> {
    if (visited >= MAX_DISCOVERY_FILES) {
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= MAX_DISCOVERY_FILES) {
        return;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(join(directory, entry.name));
        }
        continue;
      }
      visited += 1;
      const path = normalize(relative(cwd, join(directory, entry.name)));
      const knownFile = entry.name === "package.json" || (KNOWN_ROOT_FILES.has(entry.name) && !path.includes("/"));
      const changesetFile = path.startsWith(".changeset/");
      if (!knownFile && !changesetFile) {
        continue;
      }
      const content = await readOptional(join(directory, entry.name));
      if (content !== undefined) {
        files.push({ path, content });
      }
    }
  }

  await visit(cwd);
  return { files, truncated: visited >= MAX_DISCOVERY_FILES };
}

function parsePackage(content: string, path: string): JsonPackage | undefined {
  try {
    const value: unknown = JSON.parse(content);
    return isRecord(value) ? value as JsonPackage : undefined;
  } catch {
    return undefined;
  }
}

function packageDependencies(packageJson: JsonPackage | undefined): Set<string> {
  const result = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    const dependencies = packageJson?.[field];
    if (isRecord(dependencies)) {
      Object.keys(dependencies).forEach((name) => result.add(name));
    }
  }
  return result;
}

function workspaces(root: JsonPackage | undefined, pnpmWorkspace: string | undefined): string[] {
  const value = root?.workspaces;
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (isRecord(value) && Array.isArray(value.packages)) {
    return value.packages.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (!pnpmWorkspace) {
    return [];
  }
  try {
    const parsed: unknown = parseYaml(pnpmWorkspace);
    const packages = isRecord(parsed) ? parsed.packages : undefined;
    return Array.isArray(packages) ? packages.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
  } catch {
    return [];
  }
}

function packageManager(root: JsonPackage | undefined, existingFiles: Set<string>): PackageManagerDiagnostic {
  const field = typeof root?.packageManager === "string" ? root.packageManager.trim() : "";
  const fromField = /^(npm|pnpm|yarn|bun)(?:@|$)/i.exec(field)?.[1]?.toLowerCase() as PackageManagerName | undefined;
  const lockfileManagers: Array<[PackageManagerName, string]> = [
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
    ["bun", "bun.lock"],
    ["bun", "bun.lockb"],
    ["npm", "package-lock.json"],
    ["npm", "npm-shrinkwrap.json"]
  ];
  const lockfiles = PACKAGE_MANAGER_LOCKFILES.filter((path) => existingFiles.has(path));
  if (fromField) {
    return { name: fromField, source: `package.json packageManager (${field})`, lockfiles };
  }
  const detected = [...new Map(lockfileManagers.filter(([, path]) => existingFiles.has(path)).map(([name, path]) => [name, path])).entries()];
  if (detected.length === 1) {
    return { name: detected[0]?.[0] ?? "unknown", source: `lockfile ${detected[0]?.[1] ?? ""}`, lockfiles };
  }
  if (detected.length > 1) {
    return { name: "multiple", source: "multiple package-manager lockfiles", lockfiles };
  }
  return { name: "unknown", source: "no packageManager field or recognized lockfile", lockfiles };
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

function matchesWorkspace(pattern: string, path: string): boolean {
  const normalizedPattern = normalize(pattern).replace(/^\.\//, "").replace(/\/$/, "");
  const packagePattern = normalizedPattern.endsWith("/package.json") ? normalizedPattern : `${normalizedPattern}/package.json`;
  return globRegex(packagePattern).test(normalize(path));
}

function workspaceManifests(manifests: Array<RepositoryFile & { packageJson?: JsonPackage }>, patterns: string[], includeRoot: boolean): Array<RepositoryFile & { packageJson?: JsonPackage }> {
  return manifests.filter((item) => item.path === "package.json" ? includeRoot : patterns.some((pattern) => matchesWorkspace(pattern, item.path)));
}

function workspaceDiagnostic(manifests: Array<RepositoryFile & { packageJson?: JsonPackage }>, patterns: string[], warnings: string[], configuredMode: MonorepoMode): WorkspaceDiagnostic {
  const packageManifests = manifests.filter((item) => item.path.endsWith("package.json"));
  const versions = packageManifests.map((item) => item.packageJson?.version).filter((version): version is string => Boolean(version && parseVersion(version)));
  const strategy = configuredMode !== "auto" ? configuredMode : packageManifests.length <= 1 ? "single" : new Set(versions).size <= 1 ? "fixed" : "independent";
  if (manifests.some((item) => item.path === "package.json" && !item.packageJson)) {
    warnings.push("package.json could not be parsed; workspace and release-tool detection may be incomplete.");
  }
  return {
    kind: packageManifests.length === 0 ? "unsupported" : patterns.length > 0 || packageManifests.length > 1 ? "workspace" : "single-package",
    patterns,
    packageCount: packageManifests.length,
    strategy
  };
}

function releaseTools(files: RepositoryFile[], root: JsonPackage | undefined, workflows: WorkflowObservation[]): ReleaseToolDiagnostic[] {
  const paths = new Set(files.map((file) => file.path));
  const dependencies = packageDependencies(root);
  const result: ReleaseToolDiagnostic[] = [];
  const add = (name: ReleaseToolDiagnostic["name"], sources: string[]) => {
    if (sources.length > 0) {
      result.push({ name, sources: [...new Set(sources)] });
    }
  };
  add("release-please", [
    ...(dependencies.has("release-please") || dependencies.has("release-please-manifest") ? ["package.json dependency"] : []),
    ...(paths.has("release-please-config.json") ? ["release-please-config.json"] : []),
    ...(paths.has(".release-please-manifest.json") ? [".release-please-manifest.json"] : []),
    ...(workflows.some((workflow) => /release-please/i.test(workflow.content)) ? ["GitHub workflow"] : [])
  ]);
  add("changesets", [
    ...(dependencies.has("@changesets/cli") ? ["package.json dependency"] : []),
    ...(paths.has(".changeset/config.json") || files.some((file) => file.path.startsWith(".changeset/")) ? [".changeset/"] : []),
    ...(workflows.some((workflow) => /changeset/i.test(workflow.content)) ? ["GitHub workflow"] : [])
  ]);
  add("semantic-release", [
    ...(dependencies.has("semantic-release") ? ["package.json dependency"] : []),
    ...(files.some((file) => [".releaserc", ".releaserc.json", ".releaserc.yml", ".releaserc.yaml", "release.config.js", "release.config.cjs", "release.config.mjs"].includes(file.path)) ? ["semantic-release configuration"] : []),
    ...(workflows.some((workflow) => /semantic-release/i.test(workflow.content)) ? ["GitHub workflow"] : [])
  ]);
  add("semverge", [
    ...(workflows.some((workflow) => workflow.semverge) ? ["GitHub workflow"] : []),
    ...(paths.has(".semverge.yml") ? [".semverge.yml"] : [])
  ]);
  return result;
}

function buildDiagnostic(root: JsonPackage | undefined): BuildDiagnostic {
  const scripts = isRecord(root?.scripts)
    ? Object.keys(root.scripts).filter((name) => BUILD_SCRIPT_NAMES.has(name) || name.startsWith("build:"))
    : [];
  return { scripts, hasBuildHook: scripts.length > 0 };
}

function safeRegistryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function registryFromNpmrc(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(?:@[^\s:]+:)?registry\s*=\s*(\S+)\s*$/i.exec(line);
    if (match?.[1]) {
      const registry = safeRegistryUrl(match[1]);
      if (registry) {
        return registry;
      }
    }
  }
  return undefined;
}

function registryDiagnostic(root: JsonPackage | undefined, files: RepositoryFile[], workflows: WorkflowObservation[]): RegistryDiagnostic {
  const sources: string[] = [];
  let registry: string | undefined;
  const publishConfig = isRecord(root?.publishConfig) ? root.publishConfig.registry : undefined;
  if (typeof publishConfig === "string") {
    registry = safeRegistryUrl(publishConfig);
  }
  if (registry) {
    sources.push("package.json publishConfig.registry");
  }
  for (const path of [".npmrc", ".yarnrc.yml"]) {
    const file = files.find((item) => item.path === path);
    if (!file) {
      continue;
    }
    const detected = path === ".npmrc" ? registryFromNpmrc(file.content) : undefined;
    if (detected && !registry) {
      registry = detected;
    }
    sources.push(path);
  }
  const publishWorkflows = workflows.filter((workflow) => workflow.publish);
  const trustedPublishing: SetupStatus = publishWorkflows.length === 0
    ? "not-detected"
    : publishWorkflows.every((workflow) => workflow.idTokenWrite) ? "detected" : "review";
  return {
    status: registry ? "detected" : sources.length > 0 ? "review" : "not-detected",
    registry,
    sources,
    trustedPublishing
  };
}

function permissionRank(value: string): number {
  if (value === "write" || value === "write-all") return 2;
  if (value === "read" || value === "read-all") return 1;
  return 0;
}

function permissionValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function workflowPermissions(value: unknown): Record<string, string> {
  if (value === "read-all" || value === "write-all") {
    return Object.fromEntries(["contents", "pull-requests", "id-token", "actions"].map((key) => [key, value]));
  }
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const permission = permissionValue(item);
    return permission ? [[key, permission]] : [];
  }));
}

function observeWorkflow(path: string, content: string, warnings: string[]): WorkflowObservation {
  const permissions: Record<string, string> = {};
  try {
    const parsed: unknown = parseYaml(content);
    if (isRecord(parsed)) {
      for (const [key, value] of Object.entries(workflowPermissions(parsed.permissions))) {
        permissions[key] = value;
      }
      const jobs = parsed.jobs;
      if (isRecord(jobs)) {
        for (const job of Object.values(jobs)) {
          if (!isRecord(job)) continue;
          for (const [key, value] of Object.entries(workflowPermissions(job.permissions))) {
            if (!permissions[key] || permissionRank(value) > permissionRank(permissions[key] ?? "")) {
              permissions[key] = value;
            }
          }
        }
      }
    }
  } catch {
    warnings.push(`${path} could not be parsed as YAML; workflow permission detection is incomplete.`);
  }
  const publish = /\b(?:npm|pnpm|yarn)\s+(?:npm\s+)?publish\b/i.test(content);
  return {
    path,
    content,
    publish,
    semverge: /uses:\s*[^\s]*semverge[^\s]*/i.test(content),
    permissions,
    idTokenWrite: permissions["id-token"] === "write" || permissions["id-token"] === "write-all"
  };
}

async function workflowObservations(cwd: string, warnings: string[]): Promise<WorkflowObservation[]> {
  const directory = join(cwd, ".github", "workflows");
  if (!(await exists(directory))) {
    return [];
  }
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const observations: WorkflowObservation[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
      continue;
    }
    const path = `.github/workflows/${entry.name}`;
    const content = await readOptional(join(directory, entry.name));
    if (content !== undefined) {
      observations.push(observeWorkflow(path, content, warnings));
    }
  }
  return observations;
}

function githubDiagnostic(workflows: WorkflowObservation[]): GitHubDiagnostic {
  const permissionNames = ["contents", "pull-requests", "id-token", "actions"] as const;
  const permissions = Object.fromEntries(permissionNames.map((name) => {
    let value = "not declared";
    for (const workflow of workflows) {
      const candidate = workflow.permissions[name];
      if (candidate && permissionRank(candidate) > permissionRank(value)) {
        value = candidate;
      }
    }
    return [name, value];
  }));
  return {
    workflowFiles: workflows.map((workflow) => workflow.path),
    semvergeWorkflow: workflows.some((workflow) => workflow.semverge),
    publishWorkflows: workflows.filter((workflow) => workflow.publish).map((workflow) => workflow.path),
    permissions: {
      contents: permissions.contents ?? "not declared",
      pullRequests: permissions["pull-requests"] ?? "not declared",
      idToken: permissions["id-token"] ?? "not declared",
      actions: permissions.actions ?? "not declared"
    }
  };
}

function tagVersion(tag: string): string | undefined {
  const at = tag.lastIndexOf("@");
  const candidates = [at >= 0 ? tag.slice(at + 1) : tag, tag.replace(/^[^0-9]*/, "")];
  return candidates.find((candidate) => Boolean(parseVersion(candidate)));
}

async function versionDiagnostic(cwd: string, manifests: Array<RepositoryFile & { packageJson?: JsonPackage }>, warnings: string[]): Promise<VersionDiagnostic> {
  const packageVersions = manifests.flatMap((item) => {
    const version = item.packageJson?.version;
    return typeof version === "string" ? [{ path: item.path, name: item.packageJson?.name, version }] : [];
  });
  const result: VersionDiagnostic = {
    rootVersion: packageVersions.find((item) => item.path === "package.json")?.version,
    packageVersions,
    tagCount: 0,
    gitAvailable: false
  };
  try {
    const { stdout } = await execFile("git", ["tag", "--list"], { cwd, maxBuffer: 1024 * 1024 });
    const tags = stdout.split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean);
    result.tagCount = tags.length;
    for (const tag of tags) {
      const version = tagVersion(tag);
      if (!version || !parseVersion(version)) continue;
      if (!result.latestTagVersion || compareVersions(version, result.latestTagVersion) > 0) {
        result.latestTag = tag;
        result.latestTagVersion = version;
      }
    }
    result.gitAvailable = true;
  } catch {
    warnings.push("Git tags could not be inspected from this directory.");
  }
  return result;
}

export async function inspectRepository(cwd: string): Promise<RepositoryDoctorReport> {
  const warnings: string[] = [];
  const discovery = await discoverRepositoryFiles(cwd);
  if (discovery.truncated) {
    warnings.push(`Repository scan stopped after ${MAX_DISCOVERY_FILES.toLocaleString()} entries; package discovery may be incomplete.`);
  }
  const manifests = discovery.files.map((file) => ({ ...file, packageJson: file.path.endsWith("package.json") ? parsePackage(file.content, file.path) : undefined }));
  const root = manifests.find((file) => file.path === "package.json")?.packageJson;
  const existingFiles = new Set(discovery.files.map((file) => file.path));
  const workflows = await workflowObservations(cwd, warnings);
  let configuredMode: MonorepoMode = "auto";
  let includeRoot = true;
  let configuredPackages: string[] = [];
  const configContent = discovery.files.find((file) => file.path === ".semverge.yml")?.content;
  if (configContent !== undefined) {
    try {
      const config = parseConfig(configContent, ".semverge.yml");
      configuredMode = config.monorepo.mode;
      includeRoot = config.monorepo.includeRoot;
      configuredPackages = config.monorepo.packages;
    } catch {
      warnings.push(".semverge.yml could not be parsed; workspace scope falls back to repository manifests.");
    }
  }
  const patterns = configuredMode === "single" ? [] : configuredPackages.length > 0 ? configuredPackages : workspaces(root, discovery.files.find((file) => file.path === "pnpm-workspace.yaml")?.content);
  const scopedManifests = workspaceManifests(manifests, patterns, includeRoot);
  const workspace = workspaceDiagnostic(scopedManifests, patterns, warnings, configuredMode);
  const packageManagerReport = packageManager(root, existingFiles);
  if (packageManagerReport.name === "multiple") {
    warnings.push(`Multiple package-manager lockfiles were detected: ${packageManagerReport.lockfiles.join(", ")}.`);
  } else if (packageManagerReport.name === "unknown" && root) {
    warnings.push("Package manager was not detected; add packageManager to package.json or commit one lockfile.");
  }
  const build = buildDiagnostic(root);
  if (!build.hasBuildHook) {
    warnings.push("No standard build or packaging script was detected; review the artifact command before enabling publication.");
  }
  const github = githubDiagnostic(workflows);
  const publishWorkflows = workflows.filter((workflow) => workflow.publish);
  if (publishWorkflows.length > 0 && github.permissions.idToken === "not declared") {
    warnings.push("A package publish workflow was detected, but id-token: write was not declared; trusted publishing is not locally evidenced.");
  }
  if (github.semvergeWorkflow && github.permissions.contents !== "write" && github.permissions.contents !== "write-all") {
    warnings.push("A SemVerge workflow was detected without an explicit contents: write permission; release PR and tag publication may be blocked.");
  }
  const registry = registryDiagnostic(root, discovery.files, workflows);
  if (registry.trustedPublishing === "detected") {
    warnings.push("Trusted publishing is configured in a workflow, but registry/provider eligibility still requires a hosted proof run.");
  }
  if (workflows.length === 0) {
    warnings.push("No GitHub workflow files were detected; hosted release permissions and event wiring could not be inspected.");
  }
  return {
    path: cwd,
    packageManager: packageManagerReport,
    workspace,
    versions: await versionDiagnostic(cwd, scopedManifests, warnings),
    releaseTools: releaseTools(discovery.files, root, workflows),
    build,
    registry,
    github,
    warnings: [...new Set(warnings)]
  };
}

function joinOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none detected";
}

export function repositoryDoctorMarkdown(report: RepositoryDoctorReport): string {
  const packageVersions = report.versions.packageVersions.map((item) => `${item.name ?? item.path}=${item.version}`).join(", ");
  const latestTag = report.versions.latestTag ? `${report.versions.latestTag} (${report.versions.latestTagVersion})` : "none detected";
  const tools = report.releaseTools.map((tool) => `${tool.name} [${tool.sources.join(", ")}]`);
  const patterns = report.workspace.patterns.length > 0 ? `; patterns: ${report.workspace.patterns.join(", ")}` : "";
  const lines = [
    "Repository setup report",
    "",
    `Path: ${report.path}`,
    `Package manager: ${report.packageManager.name} (${report.packageManager.source})`,
    `Workspace: ${report.workspace.kind}; ${report.workspace.packageCount} package manifest(s); strategy ${report.workspace.strategy}${patterns}`,
    `Versions: ${packageVersions || "no supported package versions detected"}`,
    `Git tags: ${report.versions.tagCount}; latest semver tag ${latestTag}`,
    `Existing release tools: ${joinOrNone(tools)}`,
    `Build/package scripts: ${joinOrNone(report.build.scripts)}`,
    `Registry: ${report.registry.registry ?? "default or not explicitly configured"} (${report.registry.status}; sources: ${joinOrNone(report.registry.sources)})`,
    `Trusted publishing: ${report.registry.trustedPublishing}`,
    `GitHub workflows: ${joinOrNone(report.github.workflowFiles)}`,
    `GitHub permissions: contents=${report.github.permissions.contents}, pull-requests=${report.github.permissions.pullRequests}, id-token=${report.github.permissions.idToken}, actions=${report.github.permissions.actions}`,
    "",
    "Warnings:"
  ];
  lines.push(...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ["- none"]));
  lines.push("", "This report uses repository-local evidence only. It does not verify hosted GitHub permissions, registry credentials, or provider-side trusted-publishing eligibility.");
  return lines.join("\n");
}
