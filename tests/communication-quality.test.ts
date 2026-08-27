import { describe, expect, it } from "vitest";
import { communicationQualityBlocks, communicationQualityMarkdown, lintCommunicationArtifact, lintCommunicationArtifacts } from "../src/communication-quality.js";
import { parseChange } from "../src/changes.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildReleasePlan } from "../src/release.js";

describe("customer communication quality", () => {
  it("keeps ordinary customer copy clean and checks artifacts independently", () => {
    const reports = lintCommunicationArtifacts([
      { artifact: "customer-notes", content: "# What's new\n\nAPI responses are easier to understand.\n" },
      { artifact: "announcement", content: "# A clearer export experience\n\nTeams can finish exports in fewer steps.\n" }
    ]);

    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.findings.length === 0)).toBe(true);
    expect(reports.map((report) => report.artifact)).toEqual(["customer-notes", "announcement"]);
  });

  it("reports audience-inappropriate implementation language with rule, line, and excerpt", () => {
    const report = lintCommunicationArtifact(
      "# What's new\n\n- feat: add export\n- See PR #42 and src/export.ts\n- version bump: patch\n",
      "customer-notes"
    );

    expect(report.mode).toBe("warn");
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "conventional-commit-prefix", line: 3, excerpt: expect.stringContaining("feat:") }),
      expect.objectContaining({ rule: "pull-request-reference", line: 4, excerpt: expect.stringContaining("PR #42") }),
      expect.objectContaining({ rule: "source-reference", line: 4, excerpt: expect.stringContaining("src/export.ts") }),
      expect.objectContaining({ rule: "versioning-language", line: 5, excerpt: expect.stringContaining("version bump") })
    ]));
  });

  it("supports warn, blocking error, disabled modes, and scoped allow terms", () => {
    const content = "- registry replication is faster.\n- feat: add exports\n";
    const warn = lintCommunicationArtifact(content, "announcement", { mode: "warn", allowTerms: [] });
    const error = lintCommunicationArtifact(content, "announcement", { mode: "error", allowTerms: [] });
    const allowed = lintCommunicationArtifact(content, "announcement", { mode: "error", allowTerms: ["registry"] });
    const off = lintCommunicationArtifact(content, "announcement", { mode: "off", allowTerms: [] });

    expect(warn.findings.length).toBeGreaterThan(0);
    expect(warn.passed).toBe(true);
    expect(error.passed).toBe(false);
    expect(communicationQualityBlocks([error])).toBe(true);
    expect(allowed.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "conventional-commit-prefix" })]));
    expect(allowed.findings).not.toEqual(expect.arrayContaining([expect.objectContaining({ rule: "release-engine-language" })]));
    expect(off).toEqual({ artifact: "announcement", mode: "off", passed: true, findings: [] });
  });

  it("makes blocking findings part of the release readiness evidence without changing the version", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      config: {
        ...DEFAULT_CONFIG,
        communication: { customerQuality: { mode: "error", allowTerms: [] } }
      },
      changes: [parseChange({
        title: "feat: add export",
        source: "pull_request",
        body: "<!-- semverge\ncustomer: feat: add export\n-->"
      })]
    });

    expect(plan.version).toBe("1.1.0");
    expect(plan.readiness.passed).toBe(false);
    expect(plan.communicationQuality?.some((report) => report.findings.length > 0)).toBe(true);
    expect(plan.readiness.missingTasks).toContain("Customer communication quality checks found blocking issues; review the communication quality report.");
  });

  it("renders findings into the release PR report", () => {
    const report = lintCommunicationArtifact("- PR #42\n", "customer-notes", { mode: "warn", allowTerms: [] });
    expect(communicationQualityMarkdown([report]).join("\n")).toContain("pull-request-reference on line 1");
    expect(communicationQualityMarkdown([report]).join("\n")).toContain("PR #42");
  });
});
