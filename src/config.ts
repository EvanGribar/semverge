import { parse as parseYaml } from "yaml";
import type { ArtifactConfig, HealthWorkflow, OutputConfig, ReadinessCommand, ReadinessTask, ShipkitConfig } from "./types.js";

export const DEFAULT_CONFIG: ShipkitConfig = {
  release: {
    branch: "shipkit/release",
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
    internalSummary: ".shipkit/internal-release.md",
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
    requiredLinks: [],
    hotfixWindowHours: 48
  },
  publishing: {
    npm: {
      enabled: false,
      command: "npm publish"
    }
  }
};

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
    const purpose = record.purpose === "package" || record.purpose === "deployment" || record.purpose === "rollback" || record.purpose === "custom" ? record.purpose : "custom";
    return [{ name: record.name.trim(), purpose, required: record.required !== false }];
  });
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function mergeConfig(raw: unknown): ShipkitConfig {
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

  const result: ShipkitConfig = {
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
      requiredLinks: strings(health.requiredLinks),
      hotfixWindowHours: positiveNumber(health.hotfixWindowHours, DEFAULT_CONFIG.health.hotfixWindowHours)
    },
    publishing: {
      npm: {
        enabled: booleanValue(npm.enabled, DEFAULT_CONFIG.publishing.npm.enabled),
        command: typeof npm.command === "string" && npm.command.trim() ? npm.command.trim() : DEFAULT_CONFIG.publishing.npm.command
      }
    }
  };

  if (typeof release.prerelease === "string" && release.prerelease.trim()) {
    result.release.prerelease = release.prerelease.trim();
  }
  if (typeof artifacts.command === "string" && artifacts.command.trim()) {
    result.artifacts.command = artifacts.command.trim();
  }
  return result;
}

export function parseConfig(content: string, fileName = ".shipkit.yml"): ShipkitConfig {
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

export function withOverrides(config: ShipkitConfig, overrides: { prerelease?: string; artifactCommand?: string }): ShipkitConfig {
  const result: ShipkitConfig = {
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
