import { parse as parseYaml } from "yaml";
import type { ArtifactConfig, OutputConfig, ReadinessCommand, ShipkitConfig } from "./types.js";

export const DEFAULT_CONFIG: ShipkitConfig = {
  release: {
    branch: "shipkit/release",
    tagPrefix: "v"
  },
  readiness: {
    requiredLabels: [],
    requiredFiles: [],
    commands: []
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

function mergeConfig(raw: unknown): ShipkitConfig {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_CONFIG;
  }
  const object = raw as Record<string, unknown>;
  const release = object.release && typeof object.release === "object" ? object.release as Record<string, unknown> : {};
  const readiness = object.readiness && typeof object.readiness === "object" ? object.readiness as Record<string, unknown> : {};
  const outputs = object.outputs && typeof object.outputs === "object" ? object.outputs as Record<string, unknown> : {};
  const artifacts = object.artifacts && typeof object.artifacts === "object" ? object.artifacts as Record<string, unknown> : {};

  const result: ShipkitConfig = {
    release: {
      branch: typeof release.branch === "string" && release.branch.trim() ? release.branch.trim() : DEFAULT_CONFIG.release.branch,
      tagPrefix: typeof release.tagPrefix === "string" ? release.tagPrefix : DEFAULT_CONFIG.release.tagPrefix
    },
    readiness: {
      requiredLabels: strings(readiness.requiredLabels),
      requiredFiles: strings(readiness.requiredFiles),
      commands: commands(readiness.commands)
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
    readiness: { ...config.readiness, requiredLabels: [...config.readiness.requiredLabels], requiredFiles: [...config.readiness.requiredFiles], commands: [...config.readiness.commands] },
    outputs: { ...config.outputs },
    artifacts: { ...config.artifacts, paths: [...config.artifacts.paths] }
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
