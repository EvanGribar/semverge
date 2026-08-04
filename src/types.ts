export type ReleaseKind = "feature" | "fix" | "breaking" | "docs" | "internal" | "other";

export type BumpLevel = "none" | "patch" | "minor" | "major";

export type Ecosystem = "node" | "python" | "rust";

export type MonorepoMode = "auto" | "single" | "fixed" | "independent";

export interface SemVergeMetadata {
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
  files?: string[];
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
  files?: string[];
  labels: string[];
  kind: ReleaseKind;
  scope?: string;
  breaking: boolean;
  skipped: boolean;
  forcedBump?: BumpLevel;
  dependencyUpdate?: boolean;
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

export interface ReadinessTask {
  name: string;
  label?: string;
  file?: string;
}

export interface ReadinessConfig {
  requiredLabels: string[];
  requiredFiles: string[];
  commands: ReadinessCommand[];
  tasks: ReadinessTask[];
}

export interface ReleaseConfig {
  branch: string;
  tagPrefix: string;
  independentTagPrefix: string;
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

export interface MonorepoConfig {
  mode: MonorepoMode;
  packages: string[];
  includeRoot: boolean;
  unscopedChanges: "all" | "root";
}

export type HealthWorkflowPurpose = "package" | "deployment" | "custom";

export interface HealthWorkflow {
  name: string;
  purpose: HealthWorkflowPurpose;
  required: boolean;
}

export interface HealthConfig {
  enabled: boolean;
  workflows: HealthWorkflow[];
  expectedArtifacts: string[];
  requiredLinks: string[];
}

export interface NpmPublishConfig {
  enabled: boolean;
  command: string;
}

export interface PublishingConfig {
  npm: NpmPublishConfig;
}

export interface SemVergeConfig {
  release: ReleaseConfig;
  readiness: ReadinessConfig;
  outputs: OutputConfig;
  artifacts: ArtifactConfig;
  monorepo: MonorepoConfig;
  health: HealthConfig;
  publishing: PublishingConfig;
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
  missingTasks: string[];
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
