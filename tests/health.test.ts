import { describe, expect, it } from "vitest";
import { detectRapidHotfix, evaluateReleaseHealth, healthMarkdown } from "../src/health.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("release health", () => {
  it("reports missing assets, failed workflows, and broken docs links", () => {
    const config = {
      ...DEFAULT_CONFIG.health,
      expectedArtifacts: ["releaserail.tgz"],
      requiredLinks: ["https://docs.example.com/release"],
      workflows: [
        { name: "publish", purpose: "package" as const, required: true },
        { name: "deploy", purpose: "deployment" as const, required: true }
      ]
    };
    const report = evaluateReleaseHealth(config, {
      tag: "v1.2.0",
      assets: [],
      links: [{ url: "https://docs.example.com/release", status: 404 }],
      workflows: [{ name: "publish", status: "completed", conclusion: "failure" }],
      rollbackDetected: false,
      hotfixDetected: false
    });
    expect(report.status).toBe("failed");
    expect(report.checks.some((check) => check.name.startsWith("artifact:") && check.status === "fail")).toBe(true);
    expect(healthMarkdown(report)).toContain("ReleaseRail release health");
  });

  it("treats a patch release shortly afterward as a warning signal", () => {
    expect(detectRapidHotfix("1.2.0", "2026-08-01T00:00:00Z", [{ tag: "v1.2.1", publishedAt: "2026-08-01T12:00:00Z" }], "v", 24)).toBe(true);
    expect(detectRapidHotfix("1.2.0", "2026-08-01T00:00:00Z", [{ tag: "pkg-demo@1.2.1", publishedAt: "2026-08-01T12:00:00Z" }], "v", 24)).toBe(true);
    expect(detectRapidHotfix("1.2.0", "2026-08-01T00:00:00Z", [{ tag: "v1.3.0", publishedAt: "2026-08-01T12:00:00Z" }], "v", 24)).toBe(false);
  });
});
