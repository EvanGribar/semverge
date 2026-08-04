import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildReleasePlan } from "../src/release.js";

describe("release planning", () => {
  it("selects the highest bump and generates every communication output", () => {
    const plan = buildReleasePlan({
      currentVersion: "2.4.1",
      date: "2026-08-04",
      config: DEFAULT_CONFIG,
      existingChangelog: "# Changelog\n\n## [2.4.1] - 2026-07-01\n",
      changes: [
        parseChange({ title: "fix: handle empty exports", source: "commit" }),
        parseChange({ title: "feat: add bulk export", source: "pull_request", number: 12 }),
        parseChange({ title: "chore: update tooling", source: "pull_request", labels: ["ship:internal"] })
      ],
      readinessContext: { availableLabels: ["ship:ready"], availableFiles: [] }
    });

    expect(plan.hasRelease).toBe(true);
    expect(plan.version).toBe("2.5.0");
    expect(plan.bump).toBe("minor");
    expect(plan.outputs.map((output) => output.path)).toEqual([
      "CHANGELOG.md",
      "RELEASE_NOTES.md",
      "MIGRATION.md",
      ".semverge/internal-release.md",
      "RELEASE_ANNOUNCEMENT.md",
      "release-manifest.json"
    ]);
    expect(plan.outputs[0]?.content).toContain("## [2.5.0] - 2026-08-04");
    expect(plan.customerNotes).toContain("add bulk export");
    expect(plan.internalSummary).toContain("update tooling");
  });

  it("keeps a docs-only change out of the release path", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      changes: [parseChange({ title: "docs: clarify setup", source: "commit" })]
    });
    expect(plan.hasRelease).toBe(false);
    expect(plan.version).toBe("1.0.0");
    expect(plan.outputs).toHaveLength(0);
  });

  it("reports missing product readiness work without hiding the version", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      config: {
        ...DEFAULT_CONFIG,
        readiness: { ...DEFAULT_CONFIG.readiness, requiredLabels: ["ship:ready"], requiredFiles: ["docs/migration.md"] }
      },
      changes: [parseChange({ title: "fix: correct billing copy", source: "pull_request" })],
      readinessContext: { availableLabels: [], availableFiles: [] }
    });
    expect(plan.version).toBe("1.0.1");
    expect(plan.readiness.passed).toBe(false);
    expect(plan.readiness.missingLabels).toEqual(["ship:ready"]);
    expect(plan.readiness.missingFiles).toEqual(["docs/migration.md"]);
  });

  it("turns structured readiness metadata into blocking product tasks", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      config: {
        ...DEFAULT_CONFIG,
        readiness: { ...DEFAULT_CONFIG.readiness, tasks: [{ name: "docs", file: "docs/migration.md" }] }
      },
      changes: [parseChange({ title: "feat: add import", source: "pull_request", body: "<!-- semverge\nreadiness: [docs]\n-->" })],
      readinessContext: { availableFiles: [] }
    });
    expect(plan.readiness.passed).toBe(false);
    expect(plan.readiness.missingTasks).toEqual(["docs"]);
  });

  it("uses ship:beta as a prerelease channel override", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      changes: [parseChange({ title: "feat: preview imports", source: "pull_request", labels: ["ship:beta"] })]
    });
    expect(plan.version).toBe("1.1.0-beta.0");
  });
});
