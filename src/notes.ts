import { formatChangeReference } from "./changes.js";
import type { ReleaseChange } from "./types.js";

function section(title: string, changes: ReleaseChange[]): string[] {
  if (changes.length === 0) {
    return [];
  }
  return [`### ${title}`, "", ...changes.map((change) => `- ${formatChangeReference(change)}`), ""];
}

function uniqueLines(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function renderChangelogSection(version: string, date: string, changes: ReleaseChange[]): string {
  const breaking = changes.filter((change) => change.breaking || change.kind === "breaking");
  const features = changes.filter((change) => !breaking.includes(change) && change.kind === "feature");
  const fixes = changes.filter((change) => !breaking.includes(change) && change.kind === "fix");
  const internal = changes.filter((change) => !breaking.includes(change) && (change.kind === "internal" || change.kind === "docs" || change.kind === "other"));
  const lines = [`## [${version}] - ${date}`, ""];
  lines.push(...section("Breaking Changes", breaking));
  lines.push(...section("Features", features));
  lines.push(...section("Bug Fixes", fixes));
  lines.push(...section("Internal Changes", internal));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function prependChangelog(existing: string, releaseSection: string): string {
  const normalized = existing.trim();
  if (!normalized) {
    return `# Changelog\n\n${releaseSection}`;
  }
  const withoutTitle = normalized.replace(/^#\s+Changelog\s*\n?/i, "").trim();
  return `# Changelog\n\n${releaseSection.trim()}\n\n${withoutTitle}\n`;
}

export function renderCustomerNotes(version: string, changes: ReleaseChange[]): string {
  const customerChanges = changes.filter((change) => !change.skipped && (change.kind === "feature" || change.kind === "fix" || change.kind === "breaking" || change.breaking));
  const breaking = customerChanges.filter((change) => change.breaking || change.kind === "breaking");
  const features = customerChanges.filter((change) => !breaking.includes(change) && change.kind === "feature");
  const fixes = customerChanges.filter((change) => !breaking.includes(change) && change.kind === "fix");
  const lines = [`# What's new in ${version}`, "", "A clear summary of the changes included in this release.", ""];
  lines.push(...section("Highlights", features));
  lines.push(...section("Improvements and Fixes", fixes));
  lines.push(...section("Breaking Changes", breaking));
  if (customerChanges.length === 0) {
    lines.push("No customer-facing changes were marked for this release.", "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function renderMigrationGuide(version: string, changes: ReleaseChange[]): string {
  const migrations = uniqueLines(changes.flatMap((change) => change.migration ? [change.migration] : []));
  const lines = [`# Migration guide for ${version}`, ""];
  if (migrations.length === 0) {
    lines.push("No migration steps are required for this release.", "");
  } else {
    lines.push("Review these steps before upgrading:", "", ...migrations.map((migration) => `- ${migration}`), "");
  }
  return lines.join("\n");
}

export function renderInternalSummary(version: string, changes: ReleaseChange[]): string {
  const internal = changes.filter((change) => change.kind === "internal" || change.kind === "docs" || change.internalSummary);
  const lines = [`# Internal release summary for ${version}`, ""];
  if (internal.length === 0) {
    lines.push("No internal-only changes were recorded.", "");
  } else {
    lines.push(...internal.map((change) => `- ${change.internalSummary ?? change.description}`), "");
  }
  return lines.join("\n");
}

export function renderAnnouncement(version: string, changes: ReleaseChange[]): string {
  const announcements = uniqueLines(changes.flatMap((change) => change.announcement ? [change.announcement] : []));
  const customerChanges = changes.filter((change) => change.kind === "feature" || change.kind === "fix" || change.kind === "breaking" || change.breaking);
  const lines = [`# ReleaseRail release announcement: ${version}`, ""];
  if (announcements.length > 0) {
    lines.push(...announcements, "");
  } else if (customerChanges.length > 0) {
    lines.push(`ReleaseRail ${version} includes:`, "", ...customerChanges.map((change) => `- ${change.customerSummary}`), "");
  } else {
    lines.push(`ReleaseRail ${version} is now available.`, "");
  }
  return lines.join("\n");
}
