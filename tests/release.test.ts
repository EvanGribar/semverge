import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { renderCustomerNotes } from "../src/notes.js";
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
    expect(plan.customerNotes).toContain("This release includes 1 feature and 1 fix.");
    expect(plan.customerNotes).toContain("Highest-impact change: add bulk export.");
    expect(plan.customerNotes).not.toContain("A clear summary of the changes included in this release.");
    expect(plan.internalSummary).toContain("update tooling");
  });

  it("uses breaking, migration, and announcement metadata in deterministic release communication", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      changes: [
        parseChange({ title: "fix: handle empty exports", source: "commit" }),
        parseChange({ title: "feat: add bulk export", source: "pull_request" }),
        parseChange({
          title: "feat!: normalize export responses",
          source: "pull_request",
          body: "<!-- semverge\nmigration: Update clients to read data.items.\nannouncement: Export responses now use the normalized shape.\n-->"
        })
      ]
    });

    expect(plan.customerNotes).toContain("This release includes 1 feature, 1 fix, and 1 breaking change.");
    expect(plan.customerNotes).toContain("Highest-impact change: normalize export responses.");
    expect(plan.customerNotes).toContain("Breaking changes require review before upgrading.");
    expect(plan.customerNotes).toContain("Migration guidance is included with this release.");
    expect(plan.migrationGuide).toContain("Update clients to read data.items.");
    expect(plan.announcement).toContain("Export responses now use the normalized shape.");
  });

  it("renders authored customer communication instead of raw commit descriptions", () => {
    const change = parseChange({
      title: "feat: internal-export-implementation-name",
      source: "pull_request",
      body: `<!-- semverge
headline: Bulk project exports
outcome: Teams can download multiple projects in one step.
-->`
    });

    const notes = renderCustomerNotes("1.1.0", [change]);
    expect(notes).toContain("Bulk project exports");
    expect(notes).toContain("Teams can download multiple projects in one step.");
    expect(notes).not.toContain("internal-export-implementation-name");
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

  it("promotes a prerelease with the stable label even when beta is configured", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.1.0-beta.2",
      config: { ...DEFAULT_CONFIG, release: { ...DEFAULT_CONFIG.release, prerelease: "beta" } },
      changes: [parseChange({ title: "fix: stabilize preview imports", source: "pull_request", labels: ["ship:stable"] })]
    });

    expect(plan).toMatchObject({ hasRelease: true, version: "1.1.0", channel: "stable", promotion: true });
    expect(JSON.parse(plan.manifest)).toMatchObject({ channel: "stable", promotion: true });
  });

  it("allows a configured stable promotion with no new release-worthy changes", () => {
    const plan = buildReleasePlan({
      currentVersion: "2.0.0-rc.3",
      config: { ...DEFAULT_CONFIG, release: { ...DEFAULT_CONFIG.release, promotion: "stable" } },
      changes: []
    });

    expect(plan).toMatchObject({ hasRelease: true, version: "2.0.0", bump: "none", channel: "stable", promotion: true });
  });

  it("keeps a configured prerelease channel unless stable promotion is requested", () => {
    const plan = buildReleasePlan({
      currentVersion: "2.0.0",
      config: { ...DEFAULT_CONFIG, release: { ...DEFAULT_CONFIG.release, prerelease: "rc" } },
      changes: [parseChange({ title: "feat: add release candidates", source: "commit" })]
    });

    expect(plan).toMatchObject({ version: "2.1.0-rc.0", channel: "rc", promotion: false });
  });

  it("uses named channel labels when no channel is configured", () => {
    const plan = buildReleasePlan({
      currentVersion: "2.0.0",
      changes: [parseChange({ title: "feat: add release candidates", source: "pull_request", labels: ["ship:rc"] })]
    });

    expect(plan).toMatchObject({ version: "2.1.0-rc.0", channel: "rc", promotion: false });
  });

  it("uses configured channel policies for custom prerelease labels", () => {
    const plan = buildReleasePlan({
      currentVersion: "2.0.0",
      config: {
        ...DEFAULT_CONFIG,
        release: {
          ...DEFAULT_CONFIG.release,
          channels: {
            ...DEFAULT_CONFIG.release.channels,
            preview: { label: "ship:preview", prerelease: "preview" }
          }
        }
      },
      changes: [parseChange({ title: "feat: add preview imports", source: "pull_request", labels: ["ship:preview"] })]
    });

    expect(plan).toMatchObject({ version: "2.1.0-preview.0", channel: "preview", promotion: false });
  });
});
