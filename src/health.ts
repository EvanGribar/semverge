import { parseVersion } from "./semver.js";
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

export interface PostReleaseVerificationObservation {
  tag: string;
  assets: string[];
  workflows: HealthWorkflowObservation[];
  links: HealthLinkObservation[];
  /** @deprecated Kept for callers that used the former health observation shape. */
  version?: string;
  /** @deprecated Rollback signals are no longer inferred from an immediate release event. */
  rollbackDetected?: boolean;
  /** @deprecated Hotfix signals require delayed monitoring and are no longer inferred here. */
  hotfixDetected?: boolean;
}

export interface HealthCheck {
  name: string;
  status: HealthCheckStatus;
  detail: string;
}

export interface PostReleaseVerificationReport {
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

function workflowCheck(config: HealthConfig, observation: PostReleaseVerificationObservation): HealthCheck[] {
  return config.workflows.map((expected) => {
    const matches = observation.workflows.filter((run) => run.name.toLowerCase() === expected.name.toLowerCase());
    const workflowName = `${expected.purpose} workflow: ${expected.name}`;
    if (matches.length === 0) {
      return { name: workflowName, status: "warn", detail: "No workflow run was found yet; rerun post-release verification after it completes." };
    }
    const latest = matches[0];
    if (latest?.conclusion === "success") {
      return { name: workflowName, status: "pass", detail: "Workflow completed successfully." };
    }
    if (latest?.status !== "completed") {
      return { name: workflowName, status: "warn", detail: `Workflow is ${latest?.status ?? "pending"}.` };
    }
    return { name: workflowName, status: expected.required ? "fail" : "warn", detail: `Workflow concluded ${latest?.conclusion ?? "without a conclusion"}.` };
  });
}

export function evaluatePostReleaseVerification(config: HealthConfig, observation: PostReleaseVerificationObservation): PostReleaseVerificationReport {
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
  if (checks.length === 0) {
    checks.push({ name: "configured post-release verification", status: "pass", detail: "No additional verification checks were configured." });
  }
  const status = checks.some((check) => check.status === "fail") ? "failed" : checks.some((check) => check.status === "warn") ? "degraded" : "healthy";
  return { schemaVersion: 1, status, tag: observation.tag, checks, generatedAt: new Date().toISOString() };
}

export function postReleaseVerificationMarkdown(report: PostReleaseVerificationReport): string {
  const icon = report.status === "healthy" ? "\u2705" : report.status === "degraded" ? "\u26a0\ufe0f" : report.status === "failed" ? "\u274c" : "\u2139\ufe0f";
  return [
    `## SemVerge post-release verification: ${icon} ${report.status}`,
    "",
    ...report.checks.map((check) => `${check.status === "pass" ? "\u2705" : check.status === "warn" ? "\u26a0\ufe0f" : "\u274c"} **${check.name}** — ${check.detail}`),
    ""
  ].join("\n");
}

/** @deprecated Use PostReleaseVerificationObservation. */
export type ReleaseHealthObservation = PostReleaseVerificationObservation;

/** @deprecated Use PostReleaseVerificationReport. */
export type ReleaseHealthReport = PostReleaseVerificationReport;

/** @deprecated Use evaluatePostReleaseVerification. */
export function evaluateReleaseHealth(config: HealthConfig, observation: ReleaseHealthObservation): ReleaseHealthReport {
  return evaluatePostReleaseVerification(config, observation);
}

/** @deprecated Use postReleaseVerificationMarkdown. */
export function healthMarkdown(report: ReleaseHealthReport): string {
  return postReleaseVerificationMarkdown(report);
}
