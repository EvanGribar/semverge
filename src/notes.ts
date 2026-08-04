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

function listWithAnd(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function sentence(value: string): string {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function highestImpactChange(changes: ReleaseChange[]): ReleaseChange | undefined {
  return changes
    .map((change, index) => ({ change, index }))
    .sort((left, right) => {
      const impact = (change: ReleaseChange): number => change.breaking || change.kind === "breaking" ? 3 : change.kind === "feature" ? 2 : 1;
      return impact(right.change) - impact(left.change) || left.index - right.index;
    })
    .at(0)?.change;
}

function customerReleaseSummary(customerChanges: ReleaseChange[], breaking: ReleaseChange[], features: ReleaseChange[], fixes: ReleaseChange[]): string {
  if (customerChanges.length === 0) {
    return "No customer-facing changes were marked for this release.";
  }
  const counts = [
    features.length > 0 ? countLabel(features.length, "feature") : undefined,
    fixes.length > 0 ? countLabel(fixes.length, "fix") : undefined,
    breaking.length > 0 ? countLabel(breaking.length, "breaking change") : undefined
  ].filter((value): value is string => Boolean(value));
  const lead = highestImpactChange(customerChanges);
  const lines = [`This release includes ${listWithAnd(counts)}.`];
  if (lead) {
    lines.push(`Highest-impact change: ${sentence(lead.customerSummary)}`);
  }
  if (breaking.length > 0) {
    lines.push("Breaking changes require review before upgrading.");
  }
  if (customerChanges.some((change) => change.migration)) {
    lines.push("Migration guidance is included with this release.");
  }
  return lines.join(" ");
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
  const lines = [`# What's new in ${version}`, "", customerReleaseSummary(customerChanges, breaking, features, fixes), ""];
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
  const lines = [`# SemVerge release announcement: ${version}`, ""];
  if (announcements.length > 0) {
    lines.push(...announcements, "");
  } else if (customerChanges.length > 0) {
    lines.push(`SemVerge ${version} includes:`, "", ...customerChanges.map((change) => `- ${change.customerSummary}`), "");
  } else {
    lines.push(`SemVerge ${version} is now available.`, "");
  }
  return lines.join("\n");
}
