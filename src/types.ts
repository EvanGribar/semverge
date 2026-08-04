export type ReleaseKind = "feature" | "fix" | "breaking" | "docs" | "internal" | "other";

export type BumpLevel = "none" | "patch" | "minor" | "major";

export interface ShipkitMetadata {
  type?: ReleaseKind;
  customer?: string;
  migration?: string;
  internal?: string;
  announcement?: string;
  breaking?: boolean;
  skip?: boolean;
  readiness?: string[];
}

export interface ChangeInput {
  title: string;
  body?: string;
  source: "commit" | "pull_request";
  sha?: string;
  number?: number;
  url?: string;
  labels?: string[];
  author?: string;
  mergedAt?: string;
}

export interface ReleaseChange {
  title: string;
  description: string;
  source: "commit" | "pull_request";
  sha?: string;
  number?: number;
  url?: string;
  author?: string;
  mergedAt?: string;
  labels: string[];
  kind: ReleaseKind;
  scope?: string;
  breaking: boolean;
  skipped: boolean;
  customerSummary: string;
  internalSummary?: string;
  migration?: string;
  announcement?: string;
  readiness: string[];
}

export interface ReadinessCommand {
  name: string;
  run: string;
}

export interface ReadinessConfig {
  requiredLabels: string[];
  requiredFiles: string[];
  commands: ReadinessCommand[];
}

export interface ReleaseConfig {
  branch: string;
  tagPrefix: string;
  prerelease?: string;
}

export interface OutputConfig {
  changelog: string;
  customerNotes: string;
  migrationGuide: string;
  internalSummary: string;
  manifest: string;
  announcement: string;
}

export interface ArtifactConfig {
  command?: string;
  paths: string[];
}

export interface ShipkitConfig {
  release: ReleaseConfig;
  readiness: ReadinessConfig;
  outputs: OutputConfig;
  artifacts: ArtifactConfig;
}

export interface ReadinessContext {
  availableLabels?: Iterable<string>;
  availableFiles?: Iterable<string>;
  commandResults?: Record<string, boolean>;
}

export interface ReadinessReport {
  passed: boolean;
  missingLabels: string[];
  missingFiles: string[];
  failedCommands: string[];
  requestedTasks: string[];
}

export interface ReleaseOutput {
  path: string;
  content: string;
}

export interface ReleasePlan {
  hasRelease: boolean;
  previousVersion: string;
  version: string;
  bump: BumpLevel;
  changes: ReleaseChange[];
  releaseChanges: ReleaseChange[];
  skippedChanges: ReleaseChange[];
  readiness: ReadinessReport;
  outputs: ReleaseOutput[];
  customerNotes: string;
  internalSummary: string;
  migrationGuide: string;
  announcement: string;
  manifest: string;
}
