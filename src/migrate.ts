import { access, constants } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { VersionFileConfig } from "./types.js";

export const MIGRATION_TOOLS = ["release-please", "changesets", "semantic-release"] as const;
export type MigrationTool = typeof MIGRATION_TOOLS[number];

export interface MigrationReport {
  tool: MigrationTool;
  detected: boolean;
  confidence: "high" | "medium" | "none";
  sourceFiles: string[];
  mappedSettings: string[];
  warnings: string[];
  nextSteps: string[];
  comparison: MigrationComparison[];
  generatedConfig: string;
}

export type MigrationComparisonStatus = "mapped" | "review" | "unsupported";

export interface MigrationComparison {
  area: string;
  source: string;
  semverge: string;
  status: MigrationComparisonStatus;
}

const SOURCE_FILES: Record<MigrationTool, string[]> = {
  "release-please": ["release-please-config.json", ".release-please-manifest.json", "release-please-manifest.json", ".github/workflows/release-please.yml", ".github/workflows/release-please.yaml"],
  changesets: [".changeset/config.json"],
  "semantic-release": [".releaserc", ".releaserc.json", ".releaserc.yml", ".releaserc.yaml", "release.config.js", "release.config.cjs", "release.config.mjs"]
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function isMigrationTool(value: string): value is MigrationTool {
  return (MIGRATION_TOOLS as readonly string[]).includes(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => access(path, constants.F_OK, (error) => error ? reject(error) : resolve()));
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

function parseDocument(path: string, content: string, warnings: string[]): Record<string, unknown> | undefined {
  try {
    const value: unknown = path.endsWith(".json") ? JSON.parse(content) : parseYaml(content);
    return objectValue(value) ?? undefined;
  } catch (error) {
    warnings.push(`${path} could not be parsed; review its settings manually (${error instanceof Error ? error.message : String(error)}).`);
    return undefined;
  }
}

function packageDependencies(content: string, warnings: string[]): Set<string> {
  const packageJson = parseDocument("package.json", content, warnings);
  const dependencies = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const values = objectValue(packageJson?.[field]);
    for (const name of Object.keys(values ?? {})) {
      dependencies.add(name);
    }
  }
  return dependencies;
}

function generatedConfig(): Record<string, unknown> {
  return {
    release: {
      branch: "semverge/release",
      tagPrefix: "v",
      independentTagPrefix: "pkg-"
    },
    monorepo: {
      mode: "auto",
      includeRoot: true,
      unscopedChanges: "all"
    },
    publishing: {
      npm: {
        enabled: false,
        command: "npm publish",
        idempotency: "registry"
      }
    }
  };
}

function normalizedPath(value: string, directory = ""): string {
  const path = posix.normalize(posix.join(directory, value.trim())).replace(/^\.\//, "");
  return path === "." ? "" : path;
}

function inferredVersionFile(value: unknown, directory: string, warnings: string[]): VersionFileConfig | undefined {
  const descriptor = typeof value === "string" ? { path: value } : objectValue(value);
  if (!descriptor || typeof descriptor.path !== "string" || !descriptor.path.trim()) {
    warnings.push(`Release Please extra-file entry in ${directory || "the root package"} has no readable path and was not mapped.`);
    return undefined;
  }
  const rawPath = descriptor.path.trim().replace(/\\/g, "/");
  if (rawPath.startsWith("/") || /^[A-Za-z]:\//.test(rawPath) || rawPath.split("/").some((segment) => segment === "..")) {
    warnings.push(`Release Please extra-file path ${descriptor.path} is outside the repository and was not mapped.`);
    return undefined;
  }
  const path = normalizedPath(rawPath, directory);
  if (!path) {
    warnings.push(`Release Please extra-file entry in ${directory || "the root package"} resolved to an empty path and was not mapped.`);
    return undefined;
  }
  if (path === "package.json" || path.endsWith("/package.json")) {
    return undefined;
  }
  const type = typeof descriptor.type === "string" ? descriptor.type.trim().toLowerCase() : "";
  const property = typeof descriptor.jsonpath === "string" && descriptor.jsonpath.trim()
    ? descriptor.jsonpath.trim()
    : typeof descriptor.property === "string" && descriptor.property.trim()
      ? descriptor.property.trim()
      : undefined;
  const lowerPath = path.toLowerCase();
  if (type === "json" || (!type && lowerPath.endsWith(".json"))) {
    return { path, format: "json", ...(property ? { property } : {}) };
  }
  if (type === "yaml" || type === "yml" || (!type && (lowerPath.endsWith(".yaml") || lowerPath.endsWith(".yml")))) {
    return { path, format: "yaml", ...(property ? { property } : {}) };
  }
  if (type === "toml" || (!type && lowerPath.endsWith(".toml"))) {
    warnings.push(`Review the TOML property for Release Please extra file ${path}; SemVerge defaults to the root version property.`);
    return { path, format: "toml", ...(property ? { property } : {}) };
  }
  if (type === "xml" || (!type && lowerPath.endsWith(".xml"))) {
    const xpath = typeof descriptor.xpath === "string" && descriptor.xpath.trim() ? descriptor.xpath.trim() : "/project/version";
    if (!descriptor.xpath) {
      warnings.push(`Review the XML XPath for Release Please extra file ${path}; SemVerge proposed ${xpath}.`);
    }
    return { path, format: "xml", xpath };
  }
  const pattern = typeof descriptor.pattern === "string" && descriptor.pattern.includes("{{version}}")
    ? descriptor.pattern
    : "{{version}}";
  warnings.push(`Review the literal version marker for Release Please extra file ${path}; SemVerge proposed pattern ${pattern}.`);
  return { path, format: "text", pattern };
}

function appendVersionFile(output: Record<string, unknown>, spec: VersionFileConfig, packageName: string | undefined, mapped: string[]): void {
  const entries = Array.isArray(output.versionFiles) ? output.versionFiles as unknown[] : [];
  const withPackage = packageName ? { ...spec, package: packageName } : spec;
  if (entries.some((entry) => JSON.stringify(entry) === JSON.stringify(withPackage))) {
    return;
  }
  entries.push(withPackage);
  output.versionFiles = entries;
  mapped.push(`versionFiles <- Release Please extra file ${spec.path}`);
}

function releasePleaseFileSettings(config: Record<string, unknown>, output: Record<string, unknown>, directory: string, mapped: string[], warnings: string[]): void {
  const packageName = directory || undefined;
  const versionFile = config["version-file"];
  if (versionFile !== undefined) {
    const inferred = inferredVersionFile(versionFile, directory, warnings);
    if (inferred) appendVersionFile(output, inferred, packageName, mapped);
  }
  const extraFiles = config["extra-files"];
  if (Array.isArray(extraFiles)) {
    for (const item of extraFiles) {
      const inferred = inferredVersionFile(item, directory, warnings);
      if (inferred) appendVersionFile(output, inferred, packageName, mapped);
    }
  }
}

function mapReleasePlease(config: Record<string, unknown> | undefined, manifest: Record<string, unknown> | undefined, output: Record<string, unknown>, mapped: string[], warnings: string[], comparison: MigrationComparison[]): void {
  if (!config) {
    warnings.push("No readable Release Please configuration was found; generated settings are conservative defaults.");
    comparison.push({ area: "release configuration", source: "unreadable or absent", semverge: "conservative defaults", status: "review" });
    return;
  }
  if (typeof config["changelog-path"] === "string" && config["changelog-path"].trim()) {
    output.outputs = { changelog: config["changelog-path"].trim() };
    mapped.push(`outputs.changelog <- release-please changelog-path (${config["changelog-path"]})`);
    comparison.push({ area: "changelog", source: String(config["changelog-path"]), semverge: "outputs.changelog", status: "mapped" });
  }
  const packages = objectValue(config.packages);
  if (packages && Object.keys(packages).length > 0) {
    const monorepo = objectValue(output.monorepo) ?? {};
    const directories = Object.keys(packages).filter((directory) => directory !== "." && directory !== "");
    monorepo.mode = directories.length > 0 ? "independent" : "single";
    monorepo.packages = directories.map((directory) => `${directory}/package.json`);
    output.monorepo = monorepo;
    mapped.push(`monorepo.mode <- ${monorepo.mode} Release Please package configuration`);
    if (directories.length > 0) mapped.push("monorepo.packages <- Release Please package paths");
    comparison.push({ area: "workspace scope", source: `${Object.keys(packages).length} Release Please package entries`, semverge: directories.length > 0 ? "independent package paths" : "single package", status: "mapped" });
    for (const [directory, packageValue] of Object.entries(packages)) {
      const packageConfig = objectValue(packageValue);
      if (!packageConfig) {
        warnings.push(`Release Please package ${directory} has no object configuration; file settings were not inferred.`);
        continue;
      }
      releasePleaseFileSettings(packageConfig, output, directory === "." ? "" : directory, mapped, warnings);
    }
  } else {
    releasePleaseFileSettings(config, output, "", mapped, warnings);
  }
  if (typeof config["release-type"] === "string") {
    mapped.push(`release-type detected: ${config["release-type"]}`);
    comparison.push({ area: "release strategy", source: `release-type=${config["release-type"]}`, semverge: "review ecosystem adapter", status: "review" });
  }
  if (manifest && Object.keys(manifest).length > 0) {
    mapped.push(`manifest versions detected: ${Object.keys(manifest).length}`);
    comparison.push({ area: "manifest versions", source: `${Object.keys(manifest).length} entries`, semverge: "recomputed from repository history", status: "review" });
  }
  for (const setting of ["include-component-in-tag", "tag-separator", "pull-request-title-pattern", "pull-request-header", "pull-request-footer", "draft-pull-request", "separate-pull-requests"]) {
    if (config[setting] !== undefined) {
      comparison.push({ area: setting, source: String(config[setting]), semverge: "no direct equivalent; review release PR policy", status: "unsupported" });
    }
  }
  warnings.push("Review Release Please branch, component, tag, manifest, and release-PR behavior before switching workflows.");
}

function mapChangesets(config: Record<string, unknown> | undefined, mapped: string[], warnings: string[], comparison: MigrationComparison[]): void {
  if (!config) {
    warnings.push("No readable Changesets configuration was found; generated settings are conservative defaults.");
    comparison.push({ area: "release configuration", source: "unreadable or absent", semverge: "conservative defaults", status: "review" });
    return;
  }
  if (typeof config.baseBranch === "string" && config.baseBranch.trim()) {
    mapped.push(`base branch detected: ${config.baseBranch}`);
    comparison.push({ area: "base branch", source: config.baseBranch, semverge: "review release channel branch", status: "review" });
  }
  if (typeof config.updateInternalDependencies === "string") {
    mapped.push(`workspace dependency policy detected: ${config.updateInternalDependencies}`);
    comparison.push({ area: "workspace dependencies", source: config.updateInternalDependencies, semverge: "monorepo.dependencyPolicy", status: "review" });
  }
  if (config.access === "restricted") {
    warnings.push("Changesets marks packages restricted; review package visibility before enabling publication.");
  }
  warnings.push("Review Changesets' pending changeset files and workspace dependency policy before migration.");
}

function mapSemanticRelease(config: Record<string, unknown> | undefined, mapped: string[], warnings: string[], comparison: MigrationComparison[]): void {
  if (!config) {
    warnings.push("Semantic Release configuration is JavaScript or otherwise unreadable; generated settings are conservative defaults.");
    comparison.push({ area: "release configuration", source: "unreadable or absent", semverge: "conservative defaults", status: "review" });
    return;
  }
  if (config.branches !== undefined) {
    mapped.push("release branches detected; review them against release.branch and prerelease policy");
    comparison.push({ area: "release branches", source: "semantic-release branches", semverge: "release.branch/channels", status: "review" });
  }
  if (Array.isArray(config.plugins)) {
    mapped.push(`semantic-release plugins detected: ${config.plugins.length}`);
    comparison.push({ area: "plugins", source: `${config.plugins.length} semantic-release plugins`, semverge: "explicit SemVerge plugins or workflow steps", status: "unsupported" });
  }
  warnings.push("Review semantic-release plugins individually; publication remains disabled in the generated config until credentials and idempotency are confirmed.");
}

export async function inspectMigration(cwd: string, tool: MigrationTool): Promise<MigrationReport> {
  if (!isMigrationTool(tool)) {
    throw new Error(`Unsupported migration source ${tool}; choose ${MIGRATION_TOOLS.join(", ")}.`);
  }
  const sourceFiles: string[] = [];
  const contents = new Map<string, string>();
  for (const relativePath of SOURCE_FILES[tool]) {
    const content = await readOptional(join(cwd, relativePath));
    if (content !== undefined) {
      sourceFiles.push(relativePath);
      contents.set(relativePath, content);
    }
  }
  if (tool === "changesets" && await exists(join(cwd, ".changeset")) && !sourceFiles.includes(".changeset/")) {
    sourceFiles.push(".changeset/");
  }
  const packageContent = await readOptional(join(cwd, "package.json"));
  const warnings: string[] = [];
  const dependencies = packageContent ? packageDependencies(packageContent, warnings) : new Set<string>();
  const dependencyDetected = tool === "release-please"
    ? dependencies.has("release-please") || dependencies.has("release-please-action")
    : tool === "changesets"
      ? dependencies.has("@changesets/cli") || dependencies.has("@changesets/changelog-github")
      : dependencies.has("semantic-release") || [...dependencies].some((name) => name.startsWith("@semantic-release/"));
  if (dependencyDetected && !sourceFiles.includes("package.json")) {
    sourceFiles.push("package.json");
  }

  const output = generatedConfig();
  const mappedSettings: string[] = [];
  const comparison: MigrationComparison[] = [];
  const configCandidates = tool === "release-please" ? ["release-please-config.json"] : SOURCE_FILES[tool];
  const configPath = configCandidates.find((path) => contents.has(path));
  const config = configPath ? parseDocument(configPath, contents.get(configPath) ?? "", warnings) : undefined;
  const manifestPath = tool === "release-please" ? [".release-please-manifest.json", "release-please-manifest.json"].find((path) => contents.has(path)) : undefined;
  const manifest = manifestPath ? parseDocument(manifestPath, contents.get(manifestPath) ?? "", warnings) : undefined;
  if (tool === "release-please") mapReleasePlease(config, manifest, output, mappedSettings, warnings, comparison);
  if (tool === "changesets") mapChangesets(config, mappedSettings, warnings, comparison);
  if (tool === "semantic-release") mapSemanticRelease(config, mappedSettings, warnings, comparison);

  const detected = sourceFiles.length > 0 || dependencyDetected;
  if (!detected) {
    warnings.unshift(`No ${tool} configuration or package dependency was detected; no automatic migration is proposed.`);
  }
  warnings.push("Publication is disabled in the generated configuration until registry credentials, trusted publishing, and retry behavior are reviewed.");
  const nextSteps = [
    "Review the generated configuration and compare it with the existing release workflow.",
    "Run `semverge explain` and the action in dry-run mode before removing the existing release tool.",
    "Enable publication only after the registry and idempotency policy are confirmed."
  ];
  return {
    tool,
    detected,
    confidence: sourceFiles.some((path) => path !== "package.json") ? "high" : detected ? "medium" : "none",
    sourceFiles,
    mappedSettings,
    warnings,
    nextSteps,
    comparison,
    generatedConfig: stringifyYaml(output)
  };
}

export function migrationReportMarkdown(report: MigrationReport): string {
  const lines = [
    "SemVerge migration report",
    "",
    `Source: ${report.tool}`,
    `Detected: ${report.detected ? "yes" : "no"}`,
    `Confidence: ${report.confidence}`,
    `Source files: ${report.sourceFiles.length > 0 ? report.sourceFiles.join(", ") : "none"}`,
    "",
    "Mapped settings:"
  ];
  lines.push(...(report.mappedSettings.length > 0 ? report.mappedSettings.map((item) => `- ${item}`) : ["- none; review manually."]));
  lines.push("", "Compatibility comparison:");
  lines.push(...(report.comparison.length > 0
    ? report.comparison.map((item) => `- [${item.status}] ${item.area}: ${item.source} -> ${item.semverge}`)
    : ["- none; review manually."]));
  lines.push("", "Conservative generated configuration:", "```yaml", report.generatedConfig.trimEnd(), "```", "", "Warnings:");
  lines.push(...report.warnings.map((item) => `- ${item}`));
  lines.push("", "Next steps:", ...report.nextSteps.map((item) => `- ${item}`));
  return lines.join("\n");
}

export async function writeMigrationConfig(cwd: string, report: MigrationReport, force = false): Promise<string> {
  if (!report.detected) {
    throw new Error(`No ${report.tool} installation was detected; review the report before writing configuration.`);
  }
  const path = join(cwd, ".semverge.yml");
  await writeFile(path, report.generatedConfig, { encoding: "utf8", flag: force ? "w" : "wx" });
  return path;
}
