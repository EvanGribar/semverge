import { access, constants } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

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
  generatedConfig: string;
}

const SOURCE_FILES: Record<MigrationTool, string[]> = {
  "release-please": ["release-please-config.json", ".release-please-manifest.json"],
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

function mapReleasePlease(config: Record<string, unknown> | undefined, output: Record<string, unknown>, mapped: string[], warnings: string[]): void {
  if (!config) {
    warnings.push("No readable Release Please configuration was found; generated settings are conservative defaults.");
    return;
  }
  if (typeof config["changelog-path"] === "string" && config["changelog-path"].trim()) {
    output.outputs = { changelog: config["changelog-path"].trim() };
    mapped.push(`outputs.changelog <- release-please changelog-path (${config["changelog-path"]})`);
  }
  const packages = objectValue(config.packages);
  if (packages && Object.keys(packages).length > 0) {
    const monorepo = objectValue(output.monorepo) ?? {};
    monorepo.mode = "independent";
    monorepo.packages = Object.keys(packages).map((directory) => `${directory}/package.json`);
    output.monorepo = monorepo;
    mapped.push("monorepo.mode <- independent Release Please package configuration");
    mapped.push("monorepo.packages <- Release Please package paths");
  }
  if (typeof config["release-type"] === "string") {
    mapped.push(`release-type detected: ${config["release-type"]}`);
  }
  warnings.push("Review Release Please branch, component, and manifest behavior before switching workflows.");
}

function mapChangesets(config: Record<string, unknown> | undefined, mapped: string[], warnings: string[]): void {
  if (!config) {
    warnings.push("No readable Changesets configuration was found; generated settings are conservative defaults.");
    return;
  }
  if (typeof config.baseBranch === "string" && config.baseBranch.trim()) {
    mapped.push(`base branch detected: ${config.baseBranch}`);
  }
  if (typeof config.updateInternalDependencies === "string") {
    mapped.push(`workspace dependency policy detected: ${config.updateInternalDependencies}`);
  }
  if (config.access === "restricted") {
    warnings.push("Changesets marks packages restricted; review package visibility before enabling publication.");
  }
  warnings.push("Review Changesets' pending changeset files and workspace dependency policy before migration.");
}

function mapSemanticRelease(config: Record<string, unknown> | undefined, mapped: string[], warnings: string[]): void {
  if (!config) {
    warnings.push("Semantic Release configuration is JavaScript or otherwise unreadable; generated settings are conservative defaults.");
    return;
  }
  if (config.branches !== undefined) {
    mapped.push("release branches detected; review them against release.branch and prerelease policy");
  }
  if (Array.isArray(config.plugins)) {
    mapped.push(`semantic-release plugins detected: ${config.plugins.length}`);
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
  const configCandidates = tool === "release-please" ? ["release-please-config.json"] : SOURCE_FILES[tool];
  const configPath = configCandidates.find((path) => contents.has(path));
  const config = configPath ? parseDocument(configPath, contents.get(configPath) ?? "", warnings) : undefined;
  if (tool === "release-please") mapReleasePlease(config, output, mappedSettings, warnings);
  if (tool === "changesets") mapChangesets(config, mappedSettings, warnings);
  if (tool === "semantic-release") mapSemanticRelease(config, mappedSettings, warnings);

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
