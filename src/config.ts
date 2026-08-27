import { parse as parseYaml } from "yaml";
import { parseOciImageRepository } from "./registries.js";
import { DEFAULT_AI_TIMEOUT_MS } from "./types.js";
import type { AiConfig, ArtifactConfig, BumpLevel, CommunicationConfig, CustomerQualityConfig, HealthMonitoringConfig, HealthWorkflow, NpmPublishConfig, OciPublishConfig, OutputConfig, ReadinessCommand, ReadinessTask, RegistryPublishConfig, ReleaseChannelPolicy, ReleasePromotion, SemVergeConfig } from "./types.js";

export type ConfigValidationSeverity = "error" | "warning";

export interface ConfigValidationIssue {
  path: string;
  severity: ConfigValidationSeverity;
  message: string;
}

const DEFAULT_CHANNEL_POLICIES: Record<string, ReleaseChannelPolicy> = {
  beta: { label: "ship:beta", prerelease: "beta" },
  rc: { label: "ship:rc", prerelease: "rc" },
  nightly: { label: "ship:nightly", prerelease: "nightly" },
  canary: { label: "ship:canary", prerelease: "canary" }
};

const DEFAULT_PYTHON_PUBLISH_COMMAND = "python -m twine upload dist/*";
const DEFAULT_RUST_PUBLISH_COMMAND = "cargo publish --locked";
const DEFAULT_OCI_PUBLISH_COMMAND = "docker push {image}:{version}";

export const DEFAULT_CONFIG: SemVergeConfig = {
  release: {
    branch: "semverge/release",
    tagPrefix: "v",
    independentTagPrefix: "pkg-",
    channels: DEFAULT_CHANNEL_POLICIES
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
  communication: {
    customerQuality: {
      mode: "warn",
      allowTerms: []
    }
  },
  artifacts: {
    paths: []
  },
  monorepo: {
    mode: "auto",
    packages: [],
    includeRoot: true,
    unscopedChanges: "all",
    dependencyPolicy: {
      dependencies: "patch",
      devDependencies: "none",
      peerDependencies: "patch",
      optionalDependencies: "patch"
    }
  },
  health: {
    enabled: true,
    workflows: [],
    expectedArtifacts: [],
    requiredLinks: [],
    monitoring: {
      enabled: false,
      windowHours: 24,
      comment: true,
      checkRun: false
    }
  },
  ai: {
    enabled: false,
    provider: "openai",
    model: "",
    timeoutMs: DEFAULT_AI_TIMEOUT_MS
  },
  publishing: {
    npm: {
      enabled: false,
      command: "npm publish",
      idempotency: "registry",
      provenance: false
    },
    python: {
      enabled: false,
      command: DEFAULT_PYTHON_PUBLISH_COMMAND,
      idempotency: "registry"
    },
    rust: {
      enabled: false,
      command: DEFAULT_RUST_PUBLISH_COMMAND,
      idempotency: "registry"
    },
    oci: {
      enabled: false,
      images: [],
      command: DEFAULT_OCI_PUBLISH_COMMAND,
      idempotency: "registry"
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

function numberField(value: Record<string, unknown>, key: string, path: string, issues: ConfigValidationIssue[]): void {
  if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
    issues.push({ path: `${path}.${key}`, severity: "error", message: "must be a finite number" });
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

function validateRegistryPublishingSection(
  publishing: Record<string, unknown>,
  name: "python" | "rust",
  defaultCommand: string,
  issues: ConfigValidationIssue[]
): void {
  const registry = section(publishing, name, issues);
  if (!registry) {
    return;
  }
  const path = `publishing.${name}`;
  booleanField(registry, "enabled", path, issues);
  stringField(registry, "command", path, issues);
  enumField(registry, "idempotency", path, ["registry", "declared"], issues);
  const command = typeof registry.command === "string" ? registry.command.trim() : "";
  if (registry.enabled === true && command && command !== defaultCommand && registry.idempotency === undefined) {
    issues.push({ path: `${path}.idempotency`, severity: "error", message: `is required for custom ${name} commands; choose registry or declared` });
  }
}

function validateOciPublishingSection(publishing: Record<string, unknown>, issues: ConfigValidationIssue[]): void {
  const oci = section(publishing, "oci", issues);
  if (!oci) {
    return;
  }
  const path = "publishing.oci";
  booleanField(oci, "enabled", path, issues);
  stringArrayField(oci, "images", path, issues);
  stringField(oci, "command", path, issues);
  enumField(oci, "idempotency", path, ["registry", "declared"], issues);
  const images = oci.images;
  if (oci.enabled === true && Array.isArray(images) && images.length === 0) {
    issues.push({ path: `${path}.images`, severity: "error", message: "must contain at least one repository when OCI publishing is enabled" });
  }
  if (Array.isArray(images)) {
    images.forEach((image, index) => {
      if (typeof image !== "string" || !image.trim()) {
        return;
      }
      try {
        parseOciImageRepository(image);
      } catch (error) {
        issues.push({ path: `${path}.images[${index}]`, severity: "error", message: error instanceof Error ? error.message : String(error) });
      }
    });
  }
  const command = typeof oci.command === "string" ? oci.command.trim() : "";
  if (oci.enabled === true && command && command !== DEFAULT_OCI_PUBLISH_COMMAND && oci.idempotency === undefined) {
    issues.push({ path: `${path}.idempotency`, severity: "error", message: "is required for custom OCI commands; choose registry or declared" });
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
    const channels = section(release, "channels", issues);
    if (channels) {
      for (const [name, value] of Object.entries(channels)) {
        if (!record(value)) {
          issues.push({ path: `release.channels.${name}`, severity: "error", message: "must be an object with label and prerelease strings" });
          continue;
        }
        if (typeof value.label !== "string" || !value.label.trim()) {
          issues.push({ path: `release.channels.${name}.label`, severity: "error", message: "must be a non-empty string" });
        }
        if (typeof value.prerelease !== "string" || !value.prerelease.trim()) {
          issues.push({ path: `release.channels.${name}.prerelease`, severity: "error", message: "must be a non-empty string" });
        }
        if (value.branch !== undefined && (typeof value.branch !== "string" || !value.branch.trim())) {
          issues.push({ path: `release.channels.${name}.branch`, severity: "error", message: "must be a non-empty string when provided" });
        }
        if (value.baseBranch !== undefined && (typeof value.baseBranch !== "string" || !value.baseBranch.trim())) {
          issues.push({ path: `release.channels.${name}.baseBranch`, severity: "error", message: "must be a non-empty string when provided" });
        }
        if (value.releaseBranch !== undefined && (typeof value.releaseBranch !== "string" || !value.releaseBranch.trim())) {
          issues.push({ path: `release.channels.${name}.releaseBranch`, severity: "error", message: "must be a non-empty string when provided" });
        }
        if (value.tagPrefix !== undefined && typeof value.tagPrefix !== "string") {
          issues.push({ path: `release.channels.${name}.tagPrefix`, severity: "error", message: "must be a string when provided" });
        }
      }
    }
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
  const communication = section(raw, "communication", issues);
  if (communication) {
    const customerQuality = section(communication, "customerQuality", issues);
    if (customerQuality) {
      enumField(customerQuality, "mode", "communication.customerQuality", ["off", "warn", "error"], issues);
      stringArrayField(customerQuality, "allowTerms", "communication.customerQuality", issues);
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
    const dependencyPolicy = section(monorepo, "dependencyPolicy", issues);
    if (dependencyPolicy) {
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        enumField(dependencyPolicy, field, "monorepo.dependencyPolicy", ["none", "patch", "minor", "major"], issues);
      }
    }
  }
  const health = section(raw, "health", issues);
  if (health) {
    booleanField(health, "enabled", "health", issues);
    stringArrayField(health, "expectedArtifacts", "health", issues);
    stringArrayField(health, "requiredLinks", "health", issues);
    const monitoring = section(health, "monitoring", issues);
    if (monitoring) {
      booleanField(monitoring, "enabled", "health.monitoring", issues);
      numberField(monitoring, "windowHours", "health.monitoring", issues);
      booleanField(monitoring, "comment", "health.monitoring", issues);
      booleanField(monitoring, "checkRun", "health.monitoring", issues);
      if (typeof monitoring.windowHours === "number" && Number.isFinite(monitoring.windowHours) && monitoring.windowHours <= 0) {
        issues.push({ path: "health.monitoring.windowHours", severity: "error", message: "must be greater than zero" });
      }
    }
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
  const ai = section(raw, "ai", issues);
  if (ai) {
    booleanField(ai, "enabled", "ai", issues);
    enumField(ai, "provider", "ai", ["openai"], issues);
    stringField(ai, "model", "ai", issues);
    numberField(ai, "timeoutMs", "ai", issues);
    if (typeof ai.timeoutMs === "number" && Number.isFinite(ai.timeoutMs) && (!Number.isInteger(ai.timeoutMs) || ai.timeoutMs <= 0)) {
      issues.push({ path: "ai.timeoutMs", severity: "error", message: "must be a positive integer" });
    }
    if (ai.enabled === true && (ai.model === undefined || (typeof ai.model === "string" && !ai.model.trim()))) {
      issues.push({ path: "ai.model", severity: "error", message: "must be a non-empty string when AI is enabled" });
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
    validateRegistryPublishingSection(publishing, "python", DEFAULT_PYTHON_PUBLISH_COMMAND, issues);
    validateRegistryPublishingSection(publishing, "rust", DEFAULT_RUST_PUBLISH_COMMAND, issues);
    validateOciPublishingSection(publishing, issues);
  }
  if (raw.plugins !== undefined) {
    if (!Array.isArray(raw.plugins)) {
      issues.push({ path: "plugins", severity: "error", message: "must be an array of plugin descriptors" });
    } else {
      raw.plugins.forEach((plugin, index) => {
        if (typeof plugin !== "string" && (!record(plugin) || (typeof plugin.package !== "string" && typeof plugin.module !== "string"))) {
          issues.push({ path: `plugins[${index}]`, severity: "error", message: "must be a string or an object specifying package or module" });
        }
      });
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
  if (config.ai) {
    if (config.ai.enabled && !config.ai.model.trim()) {
      issues.push({ path: "ai.model", severity: "error", message: "must be a non-empty string when AI is enabled" });
    }
    if (config.ai.provider !== "openai") {
      issues.push({ path: "ai.provider", severity: "error", message: "must be one of: openai" });
    }
    if (!Number.isInteger(config.ai.timeoutMs) || config.ai.timeoutMs <= 0) {
      issues.push({ path: "ai.timeoutMs", severity: "error", message: "must be a positive integer" });
    }
  }
  if (config.communication) {
    if (!(["off", "warn", "error"] as const).includes(config.communication.customerQuality.mode)) {
      issues.push({ path: "communication.customerQuality.mode", severity: "error", message: "must be one of: off, warn, error" });
    }
    if (config.communication.customerQuality.allowTerms.some((term) => !term.trim())) {
      issues.push({ path: "communication.customerQuality.allowTerms", severity: "error", message: "must contain only non-empty strings" });
    }
  }
  for (const [name, policy] of Object.entries(config.release.channels)) {
    if (!policy.label.trim()) {
      issues.push({ path: `release.channels.${name}.label`, severity: "error", message: "must be a non-empty string" });
    }
    if (!policy.prerelease.trim()) {
      issues.push({ path: `release.channels.${name}.prerelease`, severity: "error", message: "must be a non-empty string" });
    }
    if (policy.branch !== undefined && !policy.branch.trim()) {
      issues.push({ path: `release.channels.${name}.branch`, severity: "error", message: "must be a non-empty string when provided" });
    }
    if (policy.baseBranch !== undefined && !policy.baseBranch.trim()) {
      issues.push({ path: `release.channels.${name}.baseBranch`, severity: "error", message: "must be a non-empty string when provided" });
    }
    if (policy.releaseBranch !== undefined && !policy.releaseBranch.trim()) {
      issues.push({ path: `release.channels.${name}.releaseBranch`, severity: "error", message: "must be a non-empty string when provided" });
    }
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
  for (const name of ["python", "rust"] as const) {
    const registry = config.publishing[name];
    if (registry.enabled && !registry.idempotency) {
      issues.push({ path: `publishing.${name}.idempotency`, severity: "error", message: `is required for custom ${name} commands; choose registry or declared` });
    }
  }
  if (config.publishing.oci.enabled && config.publishing.oci.images.length === 0) {
    issues.push({ path: "publishing.oci.images", severity: "error", message: "must contain at least one repository when OCI publishing is enabled" });
  }
  if (config.publishing.oci.enabled && !config.publishing.oci.idempotency) {
    issues.push({ path: "publishing.oci.idempotency", severity: "error", message: "is required for custom OCI commands; choose registry or declared" });
  }
  const monitoring = config.health.monitoring;
  if (monitoring && (!Number.isFinite(monitoring.windowHours) || monitoring.windowHours <= 0)) {
    issues.push({ path: "health.monitoring.windowHours", severity: "error", message: "must be greater than zero" });
  }
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    if (!["none", "patch", "minor", "major"].includes(config.monorepo.dependencyPolicy[field])) {
      issues.push({ path: `monorepo.dependencyPolicy.${field}`, severity: "error", message: "must be one of: none, patch, minor, major" });
    }
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

function bumpLevel(value: unknown, fallback: BumpLevel): BumpLevel {
  return value === "none" || value === "patch" || value === "minor" || value === "major" ? value : fallback;
}

function registryPublishConfig(value: unknown, fallback: RegistryPublishConfig): RegistryPublishConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const command = typeof object.command === "string" && object.command.trim() ? object.command.trim() : fallback.command;
  const idempotency: RegistryPublishConfig["idempotency"] = object.idempotency === "registry" || object.idempotency === "declared"
    ? object.idempotency
    : command === fallback.command ? "registry" : undefined;
  return {
    enabled: booleanValue(object.enabled, fallback.enabled),
    command,
    idempotency
  };
}

function ociPublishConfig(value: unknown, fallback: OciPublishConfig): OciPublishConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const command = typeof object.command === "string" && object.command.trim() ? object.command.trim() : fallback.command;
  const idempotency: OciPublishConfig["idempotency"] = object.idempotency === "registry" || object.idempotency === "declared"
    ? object.idempotency
    : command === fallback.command ? "registry" : undefined;
  return {
    enabled: booleanValue(object.enabled, fallback.enabled),
    images: strings(object.images),
    command,
    idempotency
  };
}

function healthMonitoring(value: unknown, fallback: HealthMonitoringConfig): HealthMonitoringConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    enabled: booleanValue(object.enabled, fallback.enabled),
    windowHours: typeof object.windowHours === "number" && Number.isFinite(object.windowHours) && object.windowHours > 0 ? object.windowHours : fallback.windowHours,
    comment: booleanValue(object.comment, fallback.comment),
    checkRun: booleanValue(object.checkRun, fallback.checkRun)
  };
}

function aiSettings(value: unknown, fallback: AiConfig): AiConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    enabled: booleanValue(object.enabled, fallback.enabled),
    provider: object.provider === "openai" ? "openai" : fallback.provider,
    model: typeof object.model === "string" ? object.model.trim() : fallback.model,
    timeoutMs: typeof object.timeoutMs === "number" && Number.isInteger(object.timeoutMs) && object.timeoutMs > 0 ? object.timeoutMs : fallback.timeoutMs
  };
}

function customerQualitySettings(value: unknown, fallback: CustomerQualityConfig): CustomerQualityConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    mode: object.mode === "off" || object.mode === "warn" || object.mode === "error" ? object.mode : fallback.mode,
    allowTerms: strings(object.allowTerms)
  };
}

function communicationSettings(value: unknown, fallback: CommunicationConfig): CommunicationConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    customerQuality: customerQualitySettings(object.customerQuality, fallback.customerQuality)
  };
}

function channelPolicies(value: unknown): Record<string, ReleaseChannelPolicy> {
  const result: Record<string, ReleaseChannelPolicy> = Object.fromEntries(Object.entries(DEFAULT_CHANNEL_POLICIES).map(([name, policy]) => [name, { ...policy }]));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }
  for (const [name, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.label !== "string" || !record.label.trim() || typeof record.prerelease !== "string" || !record.prerelease.trim()) {
      continue;
    }
    const policy: ReleaseChannelPolicy = { label: record.label.trim(), prerelease: record.prerelease.trim() };
    if (typeof record.branch === "string" && record.branch.trim()) {
      policy.branch = record.branch.trim();
    }
    if (typeof record.baseBranch === "string" && record.baseBranch.trim()) {
      policy.baseBranch = record.baseBranch.trim();
    }
    if (typeof record.releaseBranch === "string" && record.releaseBranch.trim()) {
      policy.releaseBranch = record.releaseBranch.trim();
    }
    if (typeof record.tagPrefix === "string") {
      policy.tagPrefix = record.tagPrefix;
    }
    result[name.trim()] = policy;
  }
  return result;
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
  const dependencyPolicy = monorepo.dependencyPolicy && typeof monorepo.dependencyPolicy === "object" ? monorepo.dependencyPolicy as Record<string, unknown> : {};
  const health = object.health && typeof object.health === "object" ? object.health as Record<string, unknown> : {};
  const healthMonitoringValue = health.monitoring;
  const communication = object.communication && typeof object.communication === "object" ? object.communication as Record<string, unknown> : {};
  const ai = object.ai && typeof object.ai === "object" ? object.ai as Record<string, unknown> : {};
  const publishing = object.publishing && typeof object.publishing === "object" ? object.publishing as Record<string, unknown> : {};
  const npm = publishing.npm && typeof publishing.npm === "object" ? publishing.npm as Record<string, unknown> : {};
  const python = publishing.python;
  const rust = publishing.rust;
  const oci = publishing.oci;
  const npmCommand = typeof npm.command === "string" && npm.command.trim() ? npm.command.trim() : DEFAULT_CONFIG.publishing.npm.command;
  const npmIdempotency: NpmPublishConfig["idempotency"] = npm.idempotency === "registry" || npm.idempotency === "declared"
    ? npm.idempotency
    : npmCommand === DEFAULT_CONFIG.publishing.npm.command ? "registry" : undefined;

  const result: SemVergeConfig = {
    release: {
      branch: typeof release.branch === "string" && release.branch.trim() ? release.branch.trim() : DEFAULT_CONFIG.release.branch,
      tagPrefix: typeof release.tagPrefix === "string" ? release.tagPrefix : DEFAULT_CONFIG.release.tagPrefix,
      independentTagPrefix: typeof release.independentTagPrefix === "string" ? release.independentTagPrefix : DEFAULT_CONFIG.release.independentTagPrefix,
      channels: channelPolicies(release.channels)
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
      unscopedChanges: monorepo.unscopedChanges === "root" ? "root" : "all",
      dependencyPolicy: {
        dependencies: bumpLevel(dependencyPolicy.dependencies, DEFAULT_CONFIG.monorepo.dependencyPolicy.dependencies),
        devDependencies: bumpLevel(dependencyPolicy.devDependencies, DEFAULT_CONFIG.monorepo.dependencyPolicy.devDependencies),
        peerDependencies: bumpLevel(dependencyPolicy.peerDependencies, DEFAULT_CONFIG.monorepo.dependencyPolicy.peerDependencies),
        optionalDependencies: bumpLevel(dependencyPolicy.optionalDependencies, DEFAULT_CONFIG.monorepo.dependencyPolicy.optionalDependencies)
      }
    },
    health: {
      enabled: booleanValue(health.enabled, DEFAULT_CONFIG.health.enabled),
      workflows: healthWorkflows(health.workflows),
      expectedArtifacts: strings(health.expectedArtifacts),
      requiredLinks: strings(health.requiredLinks),
      monitoring: healthMonitoring(healthMonitoringValue, DEFAULT_CONFIG.health.monitoring as HealthMonitoringConfig)
    },
    communication: communicationSettings(communication, DEFAULT_CONFIG.communication as CommunicationConfig),
    ai: aiSettings(ai, DEFAULT_CONFIG.ai as AiConfig),
    publishing: {
      npm: {
        enabled: booleanValue(npm.enabled, DEFAULT_CONFIG.publishing.npm.enabled),
        command: npmCommand,
        idempotency: npmIdempotency,
        provenance: booleanValue(npm.provenance, DEFAULT_CONFIG.publishing.npm.provenance)
      },
      python: registryPublishConfig(python, DEFAULT_CONFIG.publishing.python),
      rust: registryPublishConfig(rust, DEFAULT_CONFIG.publishing.rust),
      oci: ociPublishConfig(oci, DEFAULT_CONFIG.publishing.oci)
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
  if (Array.isArray(object.plugins)) {
    result.plugins = object.plugins;
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
    release: { ...config.release, channels: Object.fromEntries(Object.entries(config.release.channels).map(([name, policy]) => [name, { ...policy }])) },
    readiness: { ...config.readiness, requiredLabels: [...config.readiness.requiredLabels], requiredFiles: [...config.readiness.requiredFiles], commands: [...config.readiness.commands], tasks: [...config.readiness.tasks] },
    outputs: { ...config.outputs },
    artifacts: { ...config.artifacts, paths: [...config.artifacts.paths] },
    monorepo: { ...config.monorepo, packages: [...config.monorepo.packages], dependencyPolicy: { ...config.monorepo.dependencyPolicy } },
    health: { ...config.health, workflows: [...config.health.workflows], expectedArtifacts: [...config.health.expectedArtifacts], requiredLinks: [...config.health.requiredLinks], ...(config.health.monitoring ? { monitoring: { ...config.health.monitoring } } : {}) },
    publishing: { ...config.publishing, npm: { ...config.publishing.npm }, python: { ...config.publishing.python }, rust: { ...config.publishing.rust }, oci: { ...config.publishing.oci, images: [...config.publishing.oci.images] } },
    ...(config.communication ? { communication: { ...config.communication, customerQuality: { ...config.communication.customerQuality, allowTerms: [...config.communication.customerQuality.allowTerms] } } } : {}),
    ...(config.ai ? { ai: { ...config.ai } } : {}),
    ...(config.plugins ? { plugins: [...config.plugins] } : {})
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

export function channelPolicy(config: SemVergeConfig, channel: string): { name: string; policy: ReleaseChannelPolicy } | undefined {
  const normalized = channel.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const match = Object.entries(config.release.channels).find(([name, policy]) => name.toLowerCase() === normalized || policy.prerelease.toLowerCase() === normalized);
  return match ? { name: match[0], policy: match[1] } : undefined;
}

export function withChannelPolicy(config: SemVergeConfig, channel?: string): SemVergeConfig {
  const result = withOverrides(config, {});
  if (!channel?.trim()) {
    return result;
  }
  const match = channelPolicy(config, channel);
  if (!match) {
    throw new Error(`Unknown SemVerge release channel: ${channel}`);
  }
  delete result.release.promotion;
  result.release.prerelease = match.policy.prerelease;
  if (match.policy.releaseBranch) {
    result.release.branch = match.policy.releaseBranch;
  }
  if (match.policy.tagPrefix !== undefined) {
    result.release.tagPrefix = match.policy.tagPrefix;
  }
  return result;
}

export function channelBaseBranch(config: SemVergeConfig, channel: string | undefined, defaultBranch: string): string {
  const policy = channel ? channelPolicy(config, channel)?.policy : undefined;
  return (policy?.baseBranch ?? policy?.branch ?? defaultBranch).replace(/^refs\/heads\//, "");
}
