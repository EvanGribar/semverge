import { compareVersions, parseVersion } from "./semver.js";
import type { HealthConfig } from "./types.js";

export type HealthCheckStatus = "pass" | "warn" | "fail";

export interface HealthWorkflowObservation {
  name: string;
  status: string;
  conclusion: string | null;
  url?: string;
}

export interface HealthLinkObservation {
  url: string;
  status: number | null;
}

export interface ReleaseHealthObservation {
  tag: string;
  version?: string;
  assets: string[];
  workflows: HealthWorkflowObservation[];
  links: HealthLinkObservation[];
  rollbackDetected: boolean;
  hotfixDetected: boolean;
}

export interface HealthCheck {
  name: string;
  status: HealthCheckStatus;
  detail: string;
}

export interface ReleaseHealthReport {
  schemaVersion: 1;
  status: "healthy" | "degraded" | "failed" | "disabled";
  tag: string;
  checks: HealthCheck[];
  generatedAt: string;
}

export function versionFromReleaseTag(tag: string, tagPrefix: string): string | undefined {
  const direct = tag.startsWith(tagPrefix) ? tag.slice(tagPrefix.length) : tag;
  if (parseVersion(direct)) {
    return direct;
  }
  const suffix = /@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1];
  return suffix && parseVersion(suffix) ? suffix : undefined;
}

function workflowCheck(config: HealthConfig, observation: ReleaseHealthObservation): HealthCheck[] {
  return config.workflows.map((expected) => {
    const matches = observation.workflows.filter((run) => run.name.toLowerCase() === expected.name.toLowerCase());
    if (matches.length === 0) {
      return { name: `${expected.purpose} workflow: ${expected.name}`, status: expected.required ? "fail" : "warn", detail: "No workflow run was found for the released commit." };
    }
    const latest = matches[0];
    if (latest?.conclusion === "success") {
      return { name: `${expected.purpose} workflow: ${expected.name}`, status: "pass", detail: "Workflow completed successfully." };
    }
    if (latest?.status !== "completed") {
      return { name: `${expected.purpose} workflow: ${expected.name}`, status: "warn", detail: `Workflow is ${latest?.status ?? "pending"}.` };
    }
    return { name: `${expected.purpose} workflow: ${expected.name}`, status: expected.required ? "fail" : "warn", detail: `Workflow concluded ${latest?.conclusion ?? "without a conclusion"}.` };
  });
}

export function evaluateReleaseHealth(config: HealthConfig, observation: ReleaseHealthObservation): ReleaseHealthReport {
  if (!config.enabled) {
    return { schemaVersion: 1, status: "disabled", tag: observation.tag, checks: [], generatedAt: new Date().toISOString() };
  }
  const checks: HealthCheck[] = [];
  for (const expected of config.expectedArtifacts) {
    checks.push({
      name: `artifact: ${expected}`,
      status: observation.assets.includes(expected) ? "pass" : "fail",
      detail: observation.assets.includes(expected) ? "Expected release asset is attached." : "Expected release asset is missing."
    });
  }
  for (const link of observation.links) {
    checks.push({
      name: `documentation link: ${link.url}`,
      status: link.status !== null && link.status >= 200 && link.status < 400 ? "pass" : "fail",
      detail: link.status === null ? "The link could not be reached." : `The link returned HTTP ${link.status}.`
    });
  }
  checks.push(...workflowCheck(config, observation));
  if (observation.rollbackDetected) {
    checks.push({ name: "rollback signal", status: "fail", detail: "A configured rollback workflow completed for this release." });
  }
  if (observation.hotfixDetected) {
    checks.push({ name: "rapid hotfix signal", status: "warn", detail: `A patch release followed this release within ${config.hotfixWindowHours} hours.` });
  }
  if (checks.length === 0) {
    checks.push({ name: "configured health checks", status: "pass", detail: "No additional health checks were configured." });
  }
  const status = checks.some((check) => check.status === "fail") ? "failed" : checks.some((check) => check.status === "warn") ? "degraded" : "healthy";
  return { schemaVersion: 1, status, tag: observation.tag, checks, generatedAt: new Date().toISOString() };
}

export function detectRapidHotfix(releaseVersion: string | undefined, publishedAt: string | undefined, laterReleases: Array<{ tag: string; publishedAt?: string | null }>, tagPrefix: string, windowHours: number): boolean {
  if (!releaseVersion || !publishedAt) {
    return false;
  }
  const current = parseVersion(releaseVersion);
  const releasedAt = Date.parse(publishedAt);
  if (!current || !Number.isFinite(releasedAt)) {
    return false;
  }
  return laterReleases.some((release) => {
    if (!release.publishedAt) {
      return false;
    }
    const laterAt = Date.parse(release.publishedAt);
    const laterVersion = versionFromReleaseTag(release.tag, tagPrefix);
    const parsedLater = laterVersion ? parseVersion(laterVersion) : null;
    if (!parsedLater || laterAt <= releasedAt || laterAt - releasedAt > windowHours * 60 * 60 * 1000) {
      return false;
    }
    return parsedLater.major === current.major && parsedLater.minor === current.minor && parsedLater.patch > current.patch && compareVersions(parsedLater, current) > 0;
  });
}

export function healthMarkdown(report: ReleaseHealthReport): string {
  const icon = report.status === "healthy" ? "âœ…" : report.status === "degraded" ? "âš ï¸" : report.status === "failed" ? "âŒ" : "â„¹ï¸";
  return [
    `## SemVerge release health: ${icon} ${report.status}`,
    "",
    ...report.checks.map((check) => `${check.status === "pass" ? "âœ…" : check.status === "warn" ? "âš ï¸" : "âŒ"} **${check.name}** â€” ${check.detail}`),
    ""
  ].join("\n");
}
