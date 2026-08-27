import { formatChangeReference } from "./changes.js";
import type { CustomerCommunication, CustomerImpact, ReleaseChange } from "./types.js";

function section(title: string, changes: ReleaseChange[]): string[] {
  if (changes.length === 0) {
    return [];
  }
  return [`### ${title}`, "", ...changes.map((change) => `- ${formatChangeReference(change)}`), ""];
}

function uniqueLines(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

function inferredImpact(change: ReleaseChange): CustomerImpact {
  if (change.breaking || change.kind === "breaking") {
    return "changed";
  }
  if (change.kind === "feature") {
    return "new";
  }
  if (change.kind === "fix") {
    return "fixed";
  }
  return "improved";
}

function customerCommunication(change: ReleaseChange): CustomerCommunication {
  const communication = change.customerCommunication ?? {
    outcome: change.customerSummary,
    impact: inferredImpact(change)
  };
  return change.breaking || change.kind === "breaking"
    ? { ...communication, impact: "changed" }
    : communication;
}

function customerReleaseSummary(customerChanges: ReleaseChange[]): string {
  if (customerChanges.length === 0) {
    return "No customer-facing updates are included in this release.";
  }
  const lead = highestImpactChange(customerChanges);
  const lines = [sentence(customerCommunication(lead!).outcome)];
  const breaking = customerChanges.some((change) => change.breaking || change.kind === "breaking");
  if (breaking) {
    lines.push("Existing behavior changes in this release; review the required action before upgrading.");
  }
  return lines.join(" ");
}

function customerSection(title: string, changes: ReleaseChange[]): string[] {
  if (changes.length === 0) {
    return [];
  }
  const lines = [`## ${title}`, ""];
  for (const change of changes) {
    const communication = customerCommunication(change);
    const copy = [communication.outcome, communication.detail].filter((value): value is string => Boolean(value?.trim())).map(sentence);
    if (communication.headline) {
      lines.push(`### ${communication.headline}`, "", ...copy, "");
    } else {
      lines.push(...copy.map((value) => `- ${value}`), "");
    }
  }
  return lines;
}

function isNoAction(value: string): boolean {
  return /^(?:no|none|not)\s+(?:customer\s+)?(?:action|migration)(?:\s+(?:is\s+)?required)?[.!]?$/i.test(value.trim()) || /^n\/a[.!]?$/i.test(value.trim());
}

function actionRequired(changes: ReleaseChange[]): string[] {
  const actions = uniqueLines(changes.flatMap((change) => {
    const communication = customerCommunication(change);
    return [communication.actionRequired, change.migration].filter((value): value is string => Boolean(value?.trim()));
  }).filter((value) => !isNoAction(value)));
  if (actions.length > 0) {
    return actions;
  }
  return changes
    .filter((change) => change.breaking || change.kind === "breaking")
    .map((change) => `Review the changed behavior before upgrading: ${customerCommunication(change).outcome}`);
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
  const lines = [`# What's new in ${version}`, "", customerReleaseSummary(customerChanges), ""];
  for (const [title, impact] of [["New", "new"], ["Improved", "improved"], ["Fixed", "fixed"], ["Changed", "changed"]] as const) {
    lines.push(...customerSection(title, customerChanges.filter((change) => customerCommunication(change).impact === impact)));
  }
  const actions = actionRequired(customerChanges);
  if (actions.length > 0) {
    lines.push("## Action required", "", ...actions.map((action) => `- ${sentence(action)}`), "");
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

export interface AnnouncementView {
  headline: string;
  summary: string;
  highlights: string[];
  actionRequired: string[];
  callToAction?: string;
  authoredCopy?: string[];
}

function announcementActions(changes: ReleaseChange[]): string[] {
  const actions = uniqueLines(changes.flatMap((change) => {
    const communication = customerCommunication(change);
    return [communication.actionRequired, change.migration].filter((value): value is string => Boolean(value?.trim()));
  }).filter((value) => !isNoAction(value)));
  if (actions.length > 0) {
    return actions;
  }
  return changes
    .filter((change) => change.breaking || change.kind === "breaking")
    .map((change) => `Review the changed behavior before upgrading: ${customerCommunication(change).outcome}`);
}

function announcementHeadline(change: ReleaseChange): string {
  const value = customerCommunication(change).headline ?? customerCommunication(change).outcome;
  return value.trim().replace(/^[a-z]/, (character) => character.toUpperCase());
}

function announcementHighlights(changes: ReleaseChange[]): string[] {
  return changes.map((change) => {
    const communication = customerCommunication(change);
    const outcome = sentence(communication.outcome);
    return communication.headline ? `${communication.headline}: ${outcome}` : outcome;
  });
}

export function buildAnnouncementView(version: string, changes: ReleaseChange[]): AnnouncementView {
  const announcements = uniqueLines(changes.flatMap((change) => change.announcement ? [change.announcement] : []));
  const customerChanges = changes.filter((change) => change.kind === "feature" || change.kind === "fix" || change.kind === "breaking" || change.breaking);
  if (announcements.length > 0) {
    return {
      headline: `SemVerge release announcement: ${version}`,
      summary: "",
      highlights: [],
      actionRequired: [],
      authoredCopy: announcements
    };
  }
  if (customerChanges.length === 0) {
    return {
      headline: `SemVerge ${version}`,
      summary: "No customer-facing update is announced for this release.",
      highlights: [],
      actionRequired: []
    };
  }
  const lead = highestImpactChange(customerChanges);
  if (!lead) {
    return {
      headline: `SemVerge ${version}`,
      summary: "No customer-facing update is announced for this release.",
      highlights: [],
      actionRequired: []
    };
  }
  const actionRequired = announcementActions(customerChanges);
  const summaryLines = [sentence(customerCommunication(lead).outcome)];
  if (customerChanges.some((change) => change.breaking || change.kind === "breaking")) {
    summaryLines.push("Existing behavior changes in this release; review the required action before upgrading.");
  }
  return {
    headline: announcementHeadline(lead),
    summary: summaryLines.join(" "),
    highlights: announcementHighlights(customerChanges),
    actionRequired,
    callToAction: `SemVerge ${version} is available now.`
  };
}

export function renderAnnouncementView(view: AnnouncementView): string {
  const lines = [`# ${view.headline}`, ""];
  if (view.authoredCopy) {
    lines.push(...view.authoredCopy, "");
    return lines.join("\n");
  }
  lines.push(view.summary, "");
  if (view.highlights.length > 0) {
    lines.push("## Highlights", "", ...view.highlights.map((highlight) => `- ${highlight}`), "");
  }
  if (view.actionRequired.length > 0) {
    lines.push("## Action required", "", ...view.actionRequired.map((action) => `- ${sentence(action)}`), "");
  }
  if (view.callToAction) {
    lines.push(view.callToAction, "");
  }
  return lines.join("\n");
}

export function renderAnnouncement(version: string, changes: ReleaseChange[]): string {
  return renderAnnouncementView(buildAnnouncementView(version, changes));
}
