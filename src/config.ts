import { parse as parseYaml } from "yaml";
import type { ArtifactConfig, HealthWorkflow, NpmPublishConfig, OutputConfig, ReadinessCommand, ReadinessTask, ReleasePromotion, SemVergeConfig } from "./types.js";

export type ConfigValidationSeverity = "error" | "warning";

export interface ConfigValidationIssue {
  path: string;
  severity: ConfigValidationSeverity;
  message: string;
}

export const DEFAULT_CONFIG: SemVergeConfig = {
  release: {
    branch: "semverge/release",
    tagPrefix: "v",
    independentTagPrefix: "pkg-"
  },
  readiness: {
    requiredLabels: [],
    requiredFiles: [],
    commands: [],
    tasks: []
  },
  outputs: {
    changelog: "CHANGELOG.md",
    customerNotes: "RELEASE_NOTES.md",
    migrationGuide: "MIGRATION.md",
    internalSummary: ".semverge/internal-release.md",
    manifest: "release-manifest.json",
    announcement: "RELEASE_ANNOUNCEMENT.md"
  },
  artifacts: {
    paths: []
  },
  monorepo: {
    mode: "auto",
    packages: [],
    includeRoot: true,
    unscopedChanges: "all"
  },
  health: {
    enabled: true,
    workflows: [],
    expectedArtifacts: [],
    requiredLinks: []
  },
  publishing: {
    npm: {
      enabled: false,
      command: "npm publish",
      idempotency: "registry",
      provenance: false
    }
  }
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function section(root: Record<string, unknown>, key: string, issues: ConfigValidationIssue[]): Record<string, unknown> | undefined {
  const value = root[key];
  if (value === undefined) {
    return undefined;
  }
  if (!record(value)) {
    issues.push({ path: key, severity: "error", message: "must be an object" });
    return undefined;
  }
  return value;
}

function stringField(value: Record<string, unknown>, key: string, path: string, issues: ConfigValidationIssue[]): void {
  if (value[key] !== undefined && typeof value[key] !== "string") {
    issues.push({ path: `${path}.${key}`, severity: "error", message: "must be a string" });
  }
}

function booleanField(value: Record<string, unknown>, key: string, path: string, issues: ConfigValidationIssue[]): void {
  if (value[key] !== undefined && typeof value[key] !== "boolean") {
    issues.push({ path: `${path}.${key}`, severity: "error", message: "must be a boolean" });
  }
}

function stringArrayField(value: Record<string, unknown>, key: string, path: string, issues: ConfigValidationIssue[]): void {
  const field = value[key];
  if (field === undefined) {
    return;
  }
  if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
    issues.push({ path: `${path}.${key}`, severity: "error", message: "must be an array of strings" });
  }
}

function enumField(value: Record<string, unknown>, key: string, path: string, choices: string[], issues: ConfigValidationIssue[]): void {
  const field = value[key];
  if (field === undefined) {
    return;
  }
  if (typeof field !== "string" || !choices.includes(field)) {
    issues.push({ path: `${path}.${key}`, severity: "error", message: `must be one of: ${choices.join(", ")}` });
  }
}

export function validateConfigContent(content: string, fileName = ".semverge.yml"): ConfigValidationIssue[] {
  if (!content.trim()) {
    return [];
  }
  let raw: unknown;
  try {
    raw = fileName.toLowerCase().endsWith(".json") ? JSON.parse(content) : parseYaml(content);
  } catch (error) {
    return [{ path: fileName, severity: "error", message: `could not parse: ${error instanceof Error ? error.message : String(error)}` }];
  }
  if (!record(raw)) {
    return [{ path: fileName, severity: "error", message: "must contain a configuration object" }];
  }

  const issues: ConfigValidationIssue[] = [];
  const release = section(raw, "release", issues);
  if (release) {
    stringField(release, "branch", "release", issues);
    stringField(release, "tagPrefix", "release", issues);
    stringField(release, "independentTagPrefix", "release", issues);
    stringField(release, "prerelease", "release", issues);
    enumField(release, "promotion", "release", ["stable"], issues);
  }
  const readiness = section(raw, "readiness", issues);
  if (readiness) {
    stringArrayField(readiness, "requiredLabels", "readiness", issues);
    stringArrayField(readiness, "requiredFiles", "readiness", issues);
    if (readiness.commands !== undefined && (!Array.isArray(readiness.commands) || readiness.commands.some((item) => !record(item) || typeof item.name !== "string" || typeof item.run !== "string"))) {
      issues.push({ path: "readiness.commands", severity: "error", message: "must be an array of objects with name and run strings" });
    }
    if (readiness.tasks !== undefined && (!Array.isArray(readiness.tasks) || readiness.tasks.some((item) => !record(item) || typeof item.name !== "string"))) {
      issues.push({ path: "readiness.tasks", severity: "error", message: "must be an array of objects with a name string" });
    }
  }
  const outputs = section(raw, "outputs", issues);
  if (outputs) {
    for (const key of ["changelog", "customerNotes", "migrationGuide", "internalSummary", "manifest", "announcement"]) {
      stringField(outputs, key, "outputs", issues);
    }
  }
  const artifacts = section(raw, "artifacts", issues);
  if (artifacts) {
    stringField(artifacts, "command", "artifacts", issues);
    stringArrayField(artifacts, "paths", "artifacts", issues);
  }
  const monorepo = section(raw, "monorepo", issues);
  if (monorepo) {
    enumField(monorepo, "mode", "monorepo", ["auto", "single", "fixed", "independent"], issues);
    stringArrayField(monorepo, "packages", "monorepo", issues);
    booleanField(monorepo, "includeRoot", "monorepo", issues);
    enumField(monorepo, "unscopedChanges", "monorepo", ["all", "root"], issues);
  }
  const health = section(raw, "health", issues);
  if (health) {
    booleanField(health, "enabled", "health", issues);
    stringArrayField(health, "expectedArtifacts", "health", issues);
    stringArrayField(health, "requiredLinks", "health", issues);
    if (health.workflows !== undefined && (!Array.isArray(health.workflows) || health.workflows.some((item) => !record(item) || typeof item.name !== "string" || (item.purpose !== undefined && !["package", "deployment", "custom", "rollback"].includes(String(item.purpose))) || (item.required !== undefined && typeof item.required !== "boolean")))) {
      issues.push({ path: "health.workflows", severity: "error", message: "must be an array of workflow objects with valid name, purpose, and required fields" });
    }
    if (health.workflows && Array.isArray(health.workflows)) {
      health.workflows.forEach((item, index) => {
        if (record(item) && item.purpose === "rollback") {
          issues.push({ path: `health.workflows[${index}].purpose`, severity: "warning", message: "rollback is deprecated and is treated as a custom verification workflow" });
        }
      });
    }
    if (health.hotfixWindowHours !== undefined) {
      issues.push({ path: "health.hotfixWindowHours", severity: "warning", message: "hotfix detection is no longer performed during immediate post-release verification" });
    }
  }
  const publishing = section(raw, "publishing", issues);
  if (publishing) {
    const npm = section(publishing, "npm", issues);
    if (npm) {
      booleanField(npm, "enabled", "publishing.npm", issues);
      stringField(npm, "command", "publishing.npm", issues);
      enumField(npm, "idempotency", "publishing.npm", ["registry", "declared"], issues);
      booleanField(npm, "provenance", "publishing.npm", issues);
      const command = typeof npm.command === "string" ? npm.command.trim() : "";
      if (npm.enabled === true && command && command !== DEFAULT_CONFIG.publishing.npm.command && npm.idempotency === undefined) {
        issues.push({ path: "publishing.npm.idempotency", severity: "error", message: "is required for custom npm commands; choose registry or declared" });
      }
      if (npm.provenance === true && npm.enabled !== true) {
        issues.push({ path: "publishing.npm.provenance", severity: "error", message: "requires publishing.npm.enabled: true" });
      }
      if (npm.provenance === true && command && command !== DEFAULT_CONFIG.publishing.npm.command) {
        issues.push({ path: "publishing.npm.provenance", severity: "error", message: "requires the default npm publish command; custom commands must own their provenance flags" });
      }
    }
  }
  return issues;
}

export function validateConfig(config: SemVergeConfig): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  if (!config.release.branch.trim()) {
    issues.push({ path: "release.branch", severity: "error", message: "must not be empty" });
  }
  if (!config.release.tagPrefix) {
    issues.push({ path: "release.tagPrefix", severity: "warning", message: "is empty; generated release tags will not have a prefix" });
  }
  if (config.publishing.npm.enabled && !config.publishing.npm.idempotency) {
    issues.push({ path: "publishing.npm.idempotency", severity: "error", message: "is required for custom npm commands; choose registry or declared" });
  }
  if (config.publishing.npm.provenance && !config.publishing.npm.enabled) {
    issues.push({ path: "publishing.npm.provenance", severity: "error", message: "requires publishing.npm.enabled: true" });
  }
  if (config.publishing.npm.provenance && config.publishing.npm.command !== DEFAULT_CONFIG.publishing.npm.command) {
    issues.push({ path: "publishing.npm.provenance", severity: "error", message: "requires the default npm publish command; custom commands must own their provenance flags" });
  }
  const workflowNames = new Set<string>();
  for (const workflow of config.health.workflows) {
    const key = workflow.name.toLowerCase();
    if (workflowNames.has(key)) {
      issues.push({ path: "health.workflows", severity: "warning", message: `workflow ${workflow.name} is configured more than once` });
    }
    workflowNames.add(key);
  }
  return issues;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function commands(value: unknown): ReadinessCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ReadinessCommand[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.run !== "string" || !record.name.trim() || !record.run.trim()) {
      return [];
    }
    return [{ name: record.name.trim(), run: record.run.trim() }];
  });
}

function readinessTasks(value: unknown): ReadinessTask[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): ReadinessTask[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) {
      return [];
    }
    const task: ReadinessTask = { name: record.name.trim() };
    if (typeof record.label === "string" && record.label.trim()) task.label = record.label.trim();
    if (typeof record.file === "string" && record.file.trim()) task.file = record.file.trim();
    return [task];
  });
}

function healthWorkflows(value: unknown): HealthWorkflow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): HealthWorkflow[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) {
      return [];
    }
    const purpose = record.purpose === "package" || record.purpose === "deployment" || record.purpose === "custom" ? record.purpose : "custom";
    return [{ name: record.name.trim(), purpose, required: record.required !== false }];
  });
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function mergeConfig(raw: unknown): SemVergeConfig {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_CONFIG;
  }
  const object = raw as Record<string, unknown>;
  const release = object.release && typeof object.release === "object" ? object.release as Record<string, unknown> : {};
  const readiness = object.readiness && typeof object.readiness === "object" ? object.readiness as Record<string, unknown> : {};
  const outputs = object.outputs && typeof object.outputs === "object" ? object.outputs as Record<string, unknown> : {};
  const artifacts = object.artifacts && typeof object.artifacts === "object" ? object.artifacts as Record<string, unknown> : {};
  const monorepo = object.monorepo && typeof object.monorepo === "object" ? object.monorepo as Record<string, unknown> : {};
  const health = object.health && typeof object.health === "object" ? object.health as Record<string, unknown> : {};
  const publishing = object.publishing && typeof object.publishing === "object" ? object.publishing as Record<string, unknown> : {};
  const npm = publishing.npm && typeof publishing.npm === "object" ? publishing.npm as Record<string, unknown> : {};
  const npmCommand = typeof npm.command === "string" && npm.command.trim() ? npm.command.trim() : DEFAULT_CONFIG.publishing.npm.command;
  const npmIdempotency: NpmPublishConfig["idempotency"] = npm.idempotency === "registry" || npm.idempotency === "declared"
    ? npm.idempotency
    : npmCommand === DEFAULT_CONFIG.publishing.npm.command ? "registry" : undefined;

  const result: SemVergeConfig = {
    release: {
      branch: typeof release.branch === "string" && release.branch.trim() ? release.branch.trim() : DEFAULT_CONFIG.release.branch,
      tagPrefix: typeof release.tagPrefix === "string" ? release.tagPrefix : DEFAULT_CONFIG.release.tagPrefix,
      independentTagPrefix: typeof release.independentTagPrefix === "string" ? release.independentTagPrefix : DEFAULT_CONFIG.release.independentTagPrefix
    },
    readiness: {
      requiredLabels: strings(readiness.requiredLabels),
      requiredFiles: strings(readiness.requiredFiles),
      commands: commands(readiness.commands),
      tasks: readinessTasks(readiness.tasks)
    },
    outputs: {
      changelog: typeof outputs.changelog === "string" && outputs.changelog.trim() ? outputs.changelog.trim() : DEFAULT_CONFIG.outputs.changelog,
      customerNotes: typeof outputs.customerNotes === "string" && outputs.customerNotes.trim() ? outputs.customerNotes.trim() : DEFAULT_CONFIG.outputs.customerNotes,
      migrationGuide: typeof outputs.migrationGuide === "string" && outputs.migrationGuide.trim() ? outputs.migrationGuide.trim() : DEFAULT_CONFIG.outputs.migrationGuide,
      internalSummary: typeof outputs.internalSummary === "string" && outputs.internalSummary.trim() ? outputs.internalSummary.trim() : DEFAULT_CONFIG.outputs.internalSummary,
      manifest: typeof outputs.manifest === "string" && outputs.manifest.trim() ? outputs.manifest.trim() : DEFAULT_CONFIG.outputs.manifest,
      announcement: typeof outputs.announcement === "string" && outputs.announcement.trim() ? outputs.announcement.trim() : DEFAULT_CONFIG.outputs.announcement
    },
    artifacts: {
      paths: strings(artifacts.paths)
    },
    monorepo: {
      mode: monorepo.mode === "single" || monorepo.mode === "fixed" || monorepo.mode === "independent" ? monorepo.mode : "auto",
      packages: strings(monorepo.packages),
      includeRoot: booleanValue(monorepo.includeRoot, DEFAULT_CONFIG.monorepo.includeRoot),
      unscopedChanges: monorepo.unscopedChanges === "root" ? "root" : "all"
    },
    health: {
      enabled: booleanValue(health.enabled, DEFAULT_CONFIG.health.enabled),
      workflows: healthWorkflows(health.workflows),
      expectedArtifacts: strings(health.expectedArtifacts),
      requiredLinks: strings(health.requiredLinks)
    },
    publishing: {
      npm: {
        enabled: booleanValue(npm.enabled, DEFAULT_CONFIG.publishing.npm.enabled),
        command: npmCommand,
        idempotency: npmIdempotency,
        provenance: booleanValue(npm.provenance, DEFAULT_CONFIG.publishing.npm.provenance)
      }
    }
  };

  if (typeof release.prerelease === "string" && release.prerelease.trim()) {
    result.release.prerelease = release.prerelease.trim();
  }
  if (release.promotion === "stable") {
    const promotion: ReleasePromotion = "stable";
    result.release.promotion = promotion;
  }
  if (typeof artifacts.command === "string" && artifacts.command.trim()) {
    result.artifacts.command = artifacts.command.trim();
  }
  return result;
}

export function parseConfig(content: string, fileName = ".semverge.yml"): SemVergeConfig {
  if (!content.trim()) {
    return DEFAULT_CONFIG;
  }
  let raw: unknown;
  try {
    raw = fileName.toLowerCase().endsWith(".json") ? JSON.parse(content) : parseYaml(content);
  } catch (error) {
    throw new Error(`Could not parse ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return mergeConfig(raw);
}

export function withOverrides(config: SemVergeConfig, overrides: { prerelease?: string; artifactCommand?: string }): SemVergeConfig {
  const result: SemVergeConfig = {
    release: { ...config.release },
    readiness: { ...config.readiness, requiredLabels: [...config.readiness.requiredLabels], requiredFiles: [...config.readiness.requiredFiles], commands: [...config.readiness.commands], tasks: [...config.readiness.tasks] },
    outputs: { ...config.outputs },
    artifacts: { ...config.artifacts, paths: [...config.artifacts.paths] },
    monorepo: { ...config.monorepo, packages: [...config.monorepo.packages] },
    health: { ...config.health, workflows: [...config.health.workflows], expectedArtifacts: [...config.health.expectedArtifacts], requiredLinks: [...config.health.requiredLinks] },
    publishing: { ...config.publishing, npm: { ...config.publishing.npm } }
  };
  const prerelease = overrides.prerelease?.trim();
  if (prerelease) {
    result.release.prerelease = prerelease;
  }
  const artifactCommand = overrides.artifactCommand?.trim();
  if (artifactCommand) {
    result.artifacts.command = artifactCommand;
  }
  return result;
}
