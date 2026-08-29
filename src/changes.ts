import { parseSemVergeMetadata } from "./metadata.js";
import type { BumpLevel, ChangeInput, CustomerCommunication, CustomerImpact, ReleaseChannelPolicy, ReleaseChange, ReleaseKind } from "./types.js";

const LABEL_KIND: Record<string, ReleaseKind> = {
  "ship:feature": "feature",
  "ship:fix": "fix",
  "ship:breaking": "breaking",
  "ship:internal": "internal",
  "ship:docs": "docs"
};

function isWhitespaceCharacter(value: string): boolean {
  return value !== "" && value.trim() === "";
}

function isAsciiLetter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function containsLineTerminator(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\r" || value[index] === "\n" || value[index] === "\u2028" || value[index] === "\u2029") {
      return true;
    }
  }
  return false;
}

export const PRERELEASE_CHANNEL_LABELS = {
  "ship:beta": "beta",
  "ship:rc": "rc",
  "ship:nightly": "nightly",
  "ship:canary": "canary"
} as const;

const BUILTIN_CHANNEL_POLICIES: Record<string, ReleaseChannelPolicy> = {
  beta: { label: "ship:beta", prerelease: "beta" },
  rc: { label: "ship:rc", prerelease: "rc" },
  nightly: { label: "ship:nightly", prerelease: "nightly" },
  canary: { label: "ship:canary", prerelease: "canary" }
};

export interface ReleaseChannelMatch {
  name: string;
  policy: ReleaseChannelPolicy;
}

export function releaseChannelFromLabels(labels: Iterable<string>, channels?: Record<string, ReleaseChannelPolicy>): ReleaseChannelMatch | undefined {
  const normalized = new Set([...labels].map((label) => label.trim().toLowerCase()));
  const match = Object.entries(channels ?? BUILTIN_CHANNEL_POLICIES).find(([, policy]) => normalized.has(policy.label.toLowerCase()));
  return match ? { name: match[0], policy: match[1] } : undefined;
}

export function prereleaseChannelFromLabels(labels: Iterable<string>, channels?: Record<string, ReleaseChannelPolicy>): string | undefined {
  return releaseChannelFromLabels(labels, channels)?.policy.prerelease;
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

function customerImpact(kind: ReleaseKind, breaking: boolean): CustomerImpact {
  if (breaking || kind === "breaking") {
    return "changed";
  }
  if (kind === "feature") {
    return "new";
  }
  if (kind === "fix") {
    return "fixed";
  }
  return "improved";
}

function parseTitle(title: string): { kind: ReleaseKind; scope?: string; description: string; breaking: boolean } {
  const normalizedTitle = title.trim();
  let cursor = 0;
  while (cursor < normalizedTitle.length && isAsciiLetter(normalizedTitle[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === 0) {
    return { kind: "other", description: normalizedTitle, breaking: false };
  }

  const type = normalizedTitle.slice(0, cursor);
  let scope: string | undefined;
  if (normalizedTitle[cursor] === "(") {
    const scopeStart = cursor + 1;
    const scopeEnd = normalizedTitle.indexOf(")", scopeStart);
    if (scopeEnd <= scopeStart) {
      return { kind: "other", description: normalizedTitle, breaking: false };
    }
    scope = normalizedTitle.slice(scopeStart, scopeEnd).trim();
    cursor = scopeEnd + 1;
  }

  const breaking = normalizedTitle[cursor] === "!";
  if (breaking) {
    cursor += 1;
  }
  if (normalizedTitle[cursor] !== ":") {
    return { kind: "other", description: normalizedTitle, breaking: false };
  }
  cursor += 1;
  while (cursor < normalizedTitle.length && isWhitespaceCharacter(normalizedTitle[cursor] ?? "")) {
    cursor += 1;
  }

  const description = normalizedTitle.slice(cursor);
  if (!description || containsLineTerminator(description)) {
    return { kind: "other", description: normalizedTitle, breaking: false };
  }

  const result: { kind: ReleaseKind; scope?: string; description: string; breaking: boolean } = {
    kind: kindFromConventionalType(type),
    description,
    breaking
  };
  if (scope !== undefined) {
    result.scope = scope;
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
  const customerCommunication: CustomerCommunication = {
    ...(metadata.headline ? { headline: metadata.headline } : {}),
    outcome: metadata.outcome ?? metadata.customer ?? description,
    ...(metadata.detail ? { detail: metadata.detail } : {}),
    impact: metadata.impact ?? customerImpact(kind, breaking),
    ...(metadata.action ? { actionRequired: metadata.action } : {}),
    ...(metadata.audience && metadata.audience.length > 0 ? { audience: [...metadata.audience] } : {})
  };
  const customerSummary = customerCommunication.outcome;

  const change: ReleaseChange = {
    title: input.title.trim(),
    description,
    source: input.source,
    labels,
    kind,
    breaking,
    skipped,
    customerSummary,
    customerCommunication,
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
  const customerText = change.customerCommunication?.headline ?? change.customerCommunication?.outcome ?? change.customerSummary;
  if (change.number !== undefined && change.url) {
    return `[${customerText}](${change.url}) (#${change.number})`;
  }
  if (change.number !== undefined) {
    return `${customerText} (#${change.number})`;
  }
  return customerText;
}
