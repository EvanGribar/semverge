import { parseSemVergeMetadata } from "./metadata.js";
import type { BumpLevel, ChangeInput, ReleaseChange, ReleaseKind } from "./types.js";

const HEADER_PATTERN = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<description>.+)$/i;
const LABEL_KIND: Record<string, ReleaseKind> = {
  "ship:feature": "feature",
  "ship:fix": "fix",
  "ship:breaking": "breaking",
  "ship:internal": "internal",
  "ship:docs": "docs"
};

export const PRERELEASE_CHANNEL_LABELS = {
  "ship:beta": "beta",
  "ship:rc": "rc",
  "ship:nightly": "nightly",
  "ship:canary": "canary"
} as const;

export function prereleaseChannelFromLabels(labels: Iterable<string>): string | undefined {
  const normalized = new Set([...labels].map((label) => label.trim().toLowerCase()));
  return Object.entries(PRERELEASE_CHANNEL_LABELS).find(([label]) => normalized.has(label))?.[1];
}

function normalizeLabels(labels: string[] | undefined): string[] {
  return [...new Set((labels ?? []).map((label) => label.trim().toLowerCase()).filter(Boolean))];
}

function kindFromConventionalType(type: string): ReleaseKind {
  switch (type.toLowerCase()) {
    case "feat":
    case "feature":
      return "feature";
    case "fix":
    case "bugfix":
    case "perf":
      return "fix";
    case "docs":
      return "docs";
    case "chore":
    case "ci":
    case "build":
    case "refactor":
    case "revert":
    case "style":
    case "test":
      return "internal";
    default:
      return "other";
  }
}

function hasBreakingFooter(body: string): boolean {
  return /(?:^|\n)BREAKING(?:-|\s)CHANGE\s*:/im.test(body);
}

function parseTitle(title: string): { kind: ReleaseKind; scope?: string; description: string; breaking: boolean } {
  const match = HEADER_PATTERN.exec(title.trim());
  if (!match?.groups) {
    return { kind: "other", description: title.trim(), breaking: false };
  }
  const result: { kind: ReleaseKind; scope?: string; description: string; breaking: boolean } = {
    kind: kindFromConventionalType(match.groups.type ?? ""),
    description: (match.groups.description ?? title).trim(),
    breaking: Boolean(match.groups.breaking)
  };
  if (match.groups.scope) {
    result.scope = match.groups.scope.trim();
  }
  return result;
}

function labelKind(labels: string[]): ReleaseKind | undefined {
  for (const label of labels) {
    const kind = LABEL_KIND[label];
    if (kind) {
      return kind;
    }
  }
  return undefined;
}

export function bumpForKind(kind: ReleaseKind, breaking: boolean): BumpLevel {
  if (breaking || kind === "breaking") {
    return "major";
  }
  if (kind === "feature") {
    return "minor";
  }
  if (kind === "fix") {
    return "patch";
  }
  return "none";
}

export function bumpForChange(change: Pick<ReleaseChange, "kind" | "breaking" | "forcedBump">): BumpLevel {
  return change.forcedBump ?? bumpForKind(change.kind, change.breaking);
}

export function parseChange(input: ChangeInput): ReleaseChange {
  const body = input.body ?? "";
  const labels = normalizeLabels(input.labels);
  const parsed = parseTitle(input.title);
  const metadata = parseSemVergeMetadata(body);
  const overriddenKind = labelKind(labels);
  const kind = metadata.type ?? overriddenKind ?? parsed.kind;
  const breaking = metadata.breaking ?? (labels.includes("ship:breaking") || parsed.breaking || hasBreakingFooter(body) || kind === "breaking");
  const skipped = metadata.skip === true || labels.includes("ship:skip");
  const description = parsed.description || input.title.trim();
  const customerSummary = metadata.customer ?? description;

  const change: ReleaseChange = {
    title: input.title.trim(),
    description,
    source: input.source,
    labels,
    kind,
    breaking,
    skipped,
    customerSummary,
    readiness: metadata.readiness ?? []
  };
  for (const [key, value] of Object.entries({
    sha: input.sha,
    number: input.number,
    url: input.url,
    author: input.author,
    mergedAt: input.mergedAt,
    files: input.files,
    scope: parsed.scope,
    internalSummary: metadata.internal,
    migration: metadata.migration,
    announcement: metadata.announcement
  })) {
    if (value !== undefined) {
      (change as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return change;
}

export function formatChangeReference(change: ReleaseChange): string {
  if (change.number !== undefined && change.url) {
    return `[${change.customerSummary}](${change.url}) (#${change.number})`;
  }
  if (change.number !== undefined) {
    return `${change.customerSummary} (#${change.number})`;
  }
  return change.customerSummary;
}
