import { bumpForChange, prereleaseChannelFromLabels } from "./changes.js";
import { DEFAULT_CONFIG } from "./config.js";
import { evaluateReadiness } from "./readiness.js";
import { bumpVersion, highestBump, parseVersion, promoteVersion } from "./semver.js";
import { renderAnnouncement, renderChangelogSection, renderCustomerNotes, renderInternalSummary, renderMigrationGuide, prependChangelog } from "./notes.js";
import { communicationQualityBlocks, lintCommunicationArtifacts } from "./communication-quality.js";
import type { ReadinessContext, ReleaseChange, ReleasePlan, SemVergeConfig } from "./types.js";

export interface BuildReleasePlanInput {
  currentVersion: string;
  changes: ReleaseChange[];
  config?: SemVergeConfig;
  existingChangelog?: string;
  date?: string;
  readinessContext?: ReadinessContext;
  registry?: import("./plugin-sdk.js").ReleasePluginRegistry;
}

function manifestFor(plan: Omit<ReleasePlan, "manifest" | "outputs">): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    version: plan.version,
    previousVersion: plan.previousVersion,
    bump: plan.bump,
    channel: plan.channel,
    promotion: plan.promotion,
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

import { createPluginRegistryFromConfigSync, runReleasePluginHookSync, type ReleasePluginInvocation } from "./plugin-sdk.js";

export function buildReleasePlan(input: BuildReleasePlanInput): ReleasePlan {
  const config = input.config ?? DEFAULT_CONFIG;
  const releaseChanges = input.changes.filter((change) => !change.skipped);
  const skippedChanges = input.changes.filter((change) => change.skipped);
  const bump = highestBump(releaseChanges.map((change) => bumpForChange(change)));
  const labelPrerelease = prereleaseChannelFromLabels(releaseChanges.flatMap((change) => change.labels), config.release.channels);
  const stableRequested = config.release.promotion === "stable" || releaseChanges.some((change) => change.labels.includes("ship:stable"));
  const currentVersion = parseVersion(input.currentVersion);
  const promotion = stableRequested && Boolean(currentVersion?.prerelease.length);
  const hasRelease = bump !== "none" || promotion;
  const channel = stableRequested ? "stable" : config.release.prerelease ?? labelPrerelease ?? "stable";
  const version = hasRelease
    ? stableRequested
      ? promotion ? promoteVersion(input.currentVersion) : bumpVersion(input.currentVersion, bump)
      : bumpVersion(input.currentVersion, bump, config.release.prerelease ?? labelPrerelease)
    : input.currentVersion;
  const readiness = evaluateReadiness(config.readiness, releaseChanges, input.readinessContext);

  const registry = input.registry ?? createPluginRegistryFromConfigSync(config);
  const pluginContext = {
    sourceCommit: "HEAD",
    version,
    packages: [],
    changes: releaseChanges.map((c) => ({
      title: c.title,
      source: c.source,
      files: c.files ?? [],
      labels: c.labels,
      kind: c.kind,
      scope: c.scope,
      breaking: c.breaking,
      customerSummary: c.customerSummary
    })),
    config
  };
  const analyzeInvocations = runReleasePluginHookSync(registry, "analyze", pluginContext);
  const planInvocations = runReleasePluginHookSync(registry, "plan", pluginContext);
  const pluginInvocations: ReleasePluginInvocation[] = [...analyzeInvocations, ...planInvocations];
  for (const inv of pluginInvocations) {
    if (inv.result.blocked) {
      readiness.passed = false;
      readiness.missingTasks.push(`Plugin ${inv.plugin} blocked release: ${inv.result.summary ?? "blocked"}`);
    }
  }

  if (!hasRelease) {
    return {
      hasRelease: false,
      previousVersion: input.currentVersion,
      version,
      bump,
      channel,
      promotion,
      changes: input.changes,
      releaseChanges,
      skippedChanges,
      readiness,
      outputs: [],
      customerNotes: "",
      internalSummary: "",
      migrationGuide: "",
      announcement: "",
      manifest: "",
      pluginInvocations,
      communicationQuality: []
    };
  }

  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const changelogSection = renderChangelogSection(version, date, releaseChanges);
  const customerNotes = renderCustomerNotes(version, releaseChanges);
  const internalSummary = renderInternalSummary(version, releaseChanges);
  const migrationGuide = renderMigrationGuide(version, releaseChanges);
  const announcement = renderAnnouncement(version, releaseChanges);
  const communicationQuality = lintCommunicationArtifacts([
    { artifact: "customer-notes", content: customerNotes },
    { artifact: "announcement", content: announcement }
  ], config.communication?.customerQuality);
  if (communicationQualityBlocks(communicationQuality)) {
    readiness.passed = false;
    readiness.missingTasks.push("Customer communication quality checks found blocking issues; review the communication quality report.");
  }
  const basePlan = {
    hasRelease,
    previousVersion: input.currentVersion,
    version,
    bump,
    channel,
    promotion,
    changes: input.changes,
    releaseChanges,
    skippedChanges,
    readiness,
    customerNotes,
    internalSummary,
    migrationGuide,
    announcement,
    communicationQuality
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

  return { ...basePlan, outputs, manifest, pluginInvocations };
}
