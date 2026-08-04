import { describe, expect, it } from "vitest";
import { evaluatePostReleaseVerification, postReleaseVerificationMarkdown } from "../src/health.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("post-release verification", () => {
  it("reports missing assets, failed workflows, and broken docs links", () => {
    const config = {
      ...DEFAULT_CONFIG.health,
      expectedArtifacts: ["semverge.tgz"],
      requiredLinks: ["https://docs.example.com/release"],
      workflows: [
        { name: "publish", purpose: "package" as const, required: true },
        { name: "deploy", purpose: "deployment" as const, required: true }
      ]
    };
    const report = evaluatePostReleaseVerification(config, {
      tag: "v1.2.0",
      assets: [],
      links: [{ url: "https://docs.example.com/release", status: 404 }],
      workflows: [{ name: "publish", status: "completed", conclusion: "failure" }]
    });
    expect(report.status).toBe("failed");
    expect(report.checks.some((check) => check.name.startsWith("artifact:") && check.status === "fail")).toBe(true);
    expect(postReleaseVerificationMarkdown(report)).toContain("SemVerge post-release verification");
  });

  it("treats a missing workflow as a pending warning", () => {
    const report = evaluatePostReleaseVerification({
      ...DEFAULT_CONFIG.health,
      workflows: [{ name: "publish", purpose: "package" as const, required: true }]
    }, {
      tag: "v1.2.0",
      assets: [],
      links: [],
      workflows: []
    });
    expect(report.status).toBe("degraded");
    expect(report.checks).toContainEqual({
      name: "package workflow: publish",
      status: "warn",
      detail: "No workflow run was found yet; rerun post-release verification after it completes."
    });
    expect(postReleaseVerificationMarkdown(report)).not.toMatch(/rollback|hotfix/i);
  });
});
