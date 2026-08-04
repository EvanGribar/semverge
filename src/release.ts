import { bumpForKind } from "./changes.js";
import { DEFAULT_CONFIG } from "./config.js";
import { evaluateReadiness } from "./readiness.js";
import { bumpVersion, highestBump } from "./semver.js";
import { renderAnnouncement, renderChangelogSection, renderCustomerNotes, renderInternalSummary, renderMigrationGuide, prependChangelog } from "./notes.js";
import type { ReadinessContext, ReleaseChange, ReleasePlan, ShipkitConfig } from "./types.js";

export interface BuildReleasePlanInput {
  currentVersion: string;
  changes: ReleaseChange[];
  config?: ShipkitConfig;
  existingChangelog?: string;
  date?: string;
  readinessContext?: ReadinessContext;
}

function manifestFor(plan: Omit<ReleasePlan, "manifest" | "outputs">): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    version: plan.version,
    previousVersion: plan.previousVersion,
    bump: plan.bump,
    generatedAt: new Date().toISOString(),
    changes: plan.releaseChanges.map((change) => ({
      kind: change.kind,
      breaking: change.breaking,
      title: change.title,
      summary: change.customerSummary,
      ...(change.number !== undefined ? { number: change.number } : {}),
      ...(change.url !== undefined ? { url: change.url } : {})
    })),
    readiness: plan.readiness
  }, null, 2)}\n`;
}

export function buildReleasePlan(input: BuildReleasePlanInput): ReleasePlan {
  const config = input.config ?? DEFAULT_CONFIG;
  const releaseChanges = input.changes.filter((change) => !change.skipped);
  const skippedChanges = input.changes.filter((change) => change.skipped);
  const bump = highestBump(releaseChanges.map((change) => bumpForKind(change.kind, change.breaking)));
  const hasRelease = bump !== "none";
  const version = hasRelease ? bumpVersion(input.currentVersion, bump, config.release.prerelease) : input.currentVersion;
  const readiness = evaluateReadiness(config.readiness, releaseChanges, input.readinessContext);
  if (!hasRelease) {
    return {
      hasRelease: false,
      previousVersion: input.currentVersion,
      version,
      bump,
      changes: input.changes,
      releaseChanges,
      skippedChanges,
      readiness,
      outputs: [],
      customerNotes: "",
      internalSummary: "",
      migrationGuide: "",
      announcement: "",
      manifest: ""
    };
  }

  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const changelogSection = renderChangelogSection(version, date, releaseChanges);
  const customerNotes = renderCustomerNotes(version, releaseChanges);
  const internalSummary = renderInternalSummary(version, releaseChanges);
  const migrationGuide = renderMigrationGuide(version, releaseChanges);
  const announcement = renderAnnouncement(version, releaseChanges);
  const basePlan = {
    hasRelease,
    previousVersion: input.currentVersion,
    version,
    bump,
    changes: input.changes,
    releaseChanges,
    skippedChanges,
    readiness,
    customerNotes,
    internalSummary,
    migrationGuide,
    announcement
  } satisfies Omit<ReleasePlan, "manifest" | "outputs">;
  const manifest = manifestFor(basePlan);
  const outputs = [
    { path: config.outputs.changelog, content: prependChangelog(input.existingChangelog ?? "", changelogSection) },
    { path: config.outputs.customerNotes, content: customerNotes },
    { path: config.outputs.migrationGuide, content: migrationGuide },
    { path: config.outputs.internalSummary, content: internalSummary },
    { path: config.outputs.announcement, content: announcement },
    { path: config.outputs.manifest, content: manifest }
  ];

  return { ...basePlan, outputs, manifest };
}
