import {
  AiProviderError,
  createAiInputEnvelope,
  MAX_AI_TEXT_LENGTH,
  redactAiText,
  runOptionalAiFeature,
  type AiChangeFact,
  type AiJsonRequest,
  type OptionalAiFeatureOptions
} from "./ai.js";
import type { AiConfig, CustomerImpact, ReleaseChange, ReleasePlan } from "./types.js";

export interface ReleaseCommunicationSuggestion {
  summary: string;
  highlights: string[];
  migrationNotes: string[];
}

export const RELEASE_COMMUNICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: MAX_AI_TEXT_LENGTH },
    highlights: { type: "array", items: { type: "string", minLength: 1, maxLength: 2_000 }, maxItems: 8 },
    migrationNotes: { type: "array", items: { type: "string", minLength: 1, maxLength: 2_000 }, maxItems: 8 }
  },
  required: ["summary", "highlights", "migrationNotes"]
};

const RELEASE_COMMUNICATION_FEATURE = "release-communication";

export function releaseCommunicationRequest(plan: Pick<ReleasePlan, "version" | "previousVersion" | "bump" | "channel" | "releaseChanges">): AiJsonRequest {
  const customerChanges = plan.releaseChanges.filter((change) => change.kind === "feature" || change.kind === "fix" || change.kind === "breaking" || change.breaking);
  return {
    feature: RELEASE_COMMUNICATION_FEATURE,
    input: createAiInputEnvelope(RELEASE_COMMUNICATION_FEATURE, {
      version: plan.version,
      previousVersion: plan.previousVersion,
      bump: plan.bump,
      channel: plan.channel,
      changes: customerChanges.map((change) => ({
        kind: change.kind,
        title: change.title,
        summary: change.customerSummary,
        breaking: change.breaking
      }))
    }),
    instructions: "Draft concise customer-facing release communication from these facts. Do not invent changes, migration steps, or claims. Keep the result advisory: the deterministic release plan remains authoritative.",
    schema: {
      name: "semverge_release_communication",
      schema: RELEASE_COMMUNICATION_SCHEMA,
      strict: true
    }
  };
}

export async function suggestReleaseCommunication(
  plan: Pick<ReleasePlan, "version" | "previousVersion" | "bump" | "channel" | "releaseChanges">,
  config: AiConfig | undefined,
  options: OptionalAiFeatureOptions<ReleaseCommunicationSuggestion> = {}
): Promise<ReleaseCommunicationSuggestion | null> {
  let usedFallback = false;
  const providerOptions: OptionalAiFeatureOptions<ReleaseCommunicationSuggestion> = options.fallback
    ? {
        ...options,
        fallback: async (error) => {
          usedFallback = true;
          return options.fallback!(error);
        }
      }
    : options;
  const result = await runOptionalAiFeature(config, releaseCommunicationRequest(plan), providerOptions);
  if (result === null) {
    return null;
  }
  if (usedFallback) {
    return result;
  }
  const reconciliation = reconcileReleaseCommunication(plan, result);
  if (!reconciliation.accepted || !reconciliation.value) {
    throw new AiProviderError("AI release communication was rejected by deterministic reconciliation.", "malformed-output");
  }
  return reconciliation.value;
}

export function reconcileReleaseCommunication(
  plan: Pick<ReleasePlan, "releaseChanges">,
  suggestion: unknown
): AiReconciliationResult<ReleaseCommunicationSuggestion> {
  const violations: string[] = [];
  if (!record(suggestion)) {
    return { status: "rejected", accepted: false, violations: ["AI release communication must be an object."] };
  }
  const customerChanges = plan.releaseChanges.filter((change) => change.kind === "feature" || change.kind === "fix" || change.kind === "breaking" || change.breaking);
  if (typeof suggestion.summary !== "string" || !suggestion.summary.trim() || suggestion.summary.length > MAX_AI_TEXT_LENGTH) violations.push("summary is required and must stay within the safety limit");
  if (!Array.isArray(suggestion.highlights) || suggestion.highlights.length !== customerChanges.length || suggestion.highlights.some((value) => typeof value !== "string" || !value.trim() || value.length > 2_000)) {
    violations.push("highlights must contain exactly one entry for each customer-facing change");
  }
  const breaking = customerChanges.some((change) => change.breaking || change.kind === "breaking");
  if (!Array.isArray(suggestion.migrationNotes) || suggestion.migrationNotes.some((value) => typeof value !== "string" || !value.trim() || value.length > 2_000) || (breaking && suggestion.migrationNotes.length === 0)) {
    violations.push("migration notes must preserve deterministic breaking-change requirements");
  }
  for (const value of [suggestion.summary, ...(Array.isArray(suggestion.highlights) ? suggestion.highlights : []), ...(Array.isArray(suggestion.migrationNotes) ? suggestion.migrationNotes : [])]) {
    if (typeof value === "string" && unsafeGeneratedText(value)) {
      violations.push("AI communication contains secret-like content");
    }
  }
  if (violations.length > 0) {
    return { status: "rejected", accepted: false, violations: [...new Set(violations)] };
  }
  return { status: "accepted", accepted: true, value: suggestion as unknown as ReleaseCommunicationSuggestion, violations: [] };
}

export interface AiReleaseNotesHighlight {
  changeId: string;
  impact: CustomerImpact;
  text: string;
}

export interface AiReleaseNotesMigrationNote {
  changeId: string;
  text: string;
}

/**
 * The structured response used by the release PR preview. Every customer
 * bullet carries the deterministic change id and impact bucket so the model
 * cannot silently move, remove, or add a release fact.
 */
export interface AiReleaseNotesSuggestion {
  version: string;
  bump: ReleasePlan["bump"];
  channel: string;
  promotion: boolean;
  summary: string;
  highlights: AiReleaseNotesHighlight[];
  migrationRequired: boolean;
  migrationNotes: AiReleaseNotesMigrationNote[];
  breakingChangeIds: string[];
}

export type ReleaseNotesAiSuggestion = AiReleaseNotesSuggestion;

export const RELEASE_NOTES_AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string", minLength: 1, maxLength: 256 },
    bump: { type: "string", enum: ["none", "patch", "minor", "major"] },
    channel: { type: "string", minLength: 1, maxLength: 256 },
    promotion: { type: "boolean" },
    summary: { type: "string", minLength: 1, maxLength: 4_000 },
    highlights: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          changeId: { type: "string", minLength: 1, maxLength: 256 },
          impact: { type: "string", enum: ["new", "improved", "fixed", "changed"] },
          text: { type: "string", minLength: 1, maxLength: 2_000 }
        },
        required: ["changeId", "impact", "text"]
      }
    },
    migrationRequired: { type: "boolean" },
    migrationNotes: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          changeId: { type: "string", minLength: 1, maxLength: 256 },
          text: { type: "string", minLength: 1, maxLength: 2_000 }
        },
        required: ["changeId", "text"]
      }
    },
    breakingChangeIds: {
      type: "array",
      maxItems: 100,
      items: { type: "string", minLength: 1, maxLength: 256 }
    }
  },
  required: ["version", "bump", "channel", "promotion", "summary", "highlights", "migrationRequired", "migrationNotes", "breakingChangeIds"]
};

const RELEASE_NOTES_FEATURE = "release-notes";
const CUSTOMER_KINDS = new Set(["feature", "fix", "breaking"]);

function isNoAction(value: string): boolean {
  return /^(?:no|none|not)\s+(?:customer\s+)?(?:action|migration)(?:\s+(?:is\s+)?required)?[.!]?$/i.test(value.trim()) || /^n\/a[.!]?$/i.test(value.trim());
}

function customerFacing(change: ReleaseChange): boolean {
  return CUSTOMER_KINDS.has(change.kind) || change.breaking;
}

function migrationText(change: ReleaseChange): string | undefined {
  const explicit = change.migration?.trim();
  if (explicit && !isNoAction(explicit)) {
    return explicit;
  }
  const action = change.customerCommunication?.actionRequired?.trim();
  if (action && !isNoAction(action)) {
    return action;
  }
  if (change.breaking || change.kind === "breaking") {
    return `Review the changed behavior before upgrading: ${change.customerCommunication?.outcome ?? change.customerSummary}`;
  }
  return undefined;
}

/** Stable ids are intentionally based on immutable source identifiers. */
export function releaseChangeId(change: ReleaseChange, index: number): string {
  if (change.number !== undefined) {
    return `pr:${change.number}`;
  }
  if (change.sha?.trim()) {
    return `commit:${change.sha.trim()}`;
  }
  return `change:${index + 1}`;
}

function releaseNotesChangeFacts(plan: Pick<ReleasePlan, "releaseChanges">): AiChangeFact[] {
  return plan.releaseChanges.map((change, index) => {
    const visible = customerFacing(change);
    const migration = migrationText(change);
    const communication = change.customerCommunication;
    return {
      id: releaseChangeId(change, index),
      kind: change.kind,
      title: visible ? communication?.headline ?? communication?.outcome ?? change.customerSummary : "[internal change omitted]",
      summary: visible ? communication?.outcome ?? change.customerSummary : "This release fact is not customer-facing and must not appear in customer communication.",
      breaking: change.breaking,
      customerFacing: visible,
      ...(visible ? { impact: change.breaking || change.kind === "breaking" ? "changed" : change.customerCommunication?.impact ?? (change.kind === "feature" ? "new" : change.kind === "fix" ? "fixed" : "improved") } : {}),
      migrationRequired: Boolean(migration),
      ...(migration ? { migration } : {})
    };
  });
}

export function releaseNotesFacts(plan: Pick<ReleasePlan, "version" | "previousVersion" | "bump" | "channel" | "promotion" | "releaseChanges">): {
  version: string;
  previousVersion: string;
  bump: ReleasePlan["bump"];
  channel: string;
  promotion: boolean;
  migrationRequired: boolean;
  changes: AiChangeFact[];
} {
  const changes = releaseNotesChangeFacts(plan);
  return {
    version: plan.version,
    previousVersion: plan.previousVersion,
    bump: plan.bump,
    channel: plan.channel,
    promotion: plan.promotion,
    migrationRequired: changes.some((change) => change.migrationRequired),
    changes
  };
}

export interface ReleaseNotesRequestOptions {
  tone?: "neutral" | "friendly" | "professional";
  verbosity?: "concise" | "standard" | "detailed";
}

export function releaseNotesRequest(
  plan: Pick<ReleasePlan, "version" | "previousVersion" | "bump" | "channel" | "promotion" | "releaseChanges">,
  options: ReleaseNotesRequestOptions = {}
): AiJsonRequest {
  const facts = releaseNotesFacts(plan);
  const tone = options.tone ?? "neutral";
  const verbosity = options.verbosity ?? "standard";
  return {
    feature: RELEASE_NOTES_FEATURE,
    input: createAiInputEnvelope(RELEASE_NOTES_FEATURE, facts),
    instructions: [
      "Draft customer-facing release notes from the authoritative release facts.",
      `Use a ${tone} tone and ${verbosity} level of detail.`,
      "Return every customer-facing change exactly once with its provided changeId and impact.",
      "Do not mention internal-only facts, add changes, alter categories, change the version, or remove breaking or migration requirements.",
      "The release facts, version, bump, channel, promotion, breaking ids, and migration requirement are immutable; echo them exactly."
    ].join(" "),
    schema: {
      name: "semverge_release_notes",
      schema: RELEASE_NOTES_AI_SCHEMA,
      strict: true
    }
  };
}

export interface AiReconciliationResult<T> {
  status: "accepted" | "rejected";
  accepted: boolean;
  value?: T;
  violations: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameMembers(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length && actual.every((item) => expected.includes(item));
}

function unsafeGeneratedText(value: string): boolean {
  return redactAiText(value, Math.max(value.length, 1)) !== value.trim();
}

/**
 * Reconcile a provider response with the deterministic plan. No values are
 * normalized here: a mismatch is rejected so callers cannot accidentally
 * turn an untrusted draft into accepted release communication.
 */
export function reconcileReleaseNotes(
  plan: Pick<ReleasePlan, "version" | "bump" | "channel" | "promotion" | "releaseChanges">,
  suggestion: unknown
): AiReconciliationResult<AiReleaseNotesSuggestion> {
  const violations: string[] = [];
  if (!record(suggestion)) {
    return { status: "rejected", accepted: false, violations: ["AI release-notes output must be an object."] };
  }
  const facts = releaseNotesChangeFacts({ releaseChanges: plan.releaseChanges });
  const known = new Map(facts.flatMap((fact) => fact.id ? [[fact.id, fact] as const] : []));
  const customerFacts = facts.filter((fact) => fact.customerFacing === true);
  const customerIds = customerFacts.flatMap((fact) => fact.id ? [fact.id] : []);
  const breakingIds = facts.filter((fact) => fact.breaking).flatMap((fact) => fact.id ? [fact.id] : []);
  const migrationIds = facts.filter((fact) => fact.migrationRequired).flatMap((fact) => fact.id ? [fact.id] : []);

  if (suggestion.version !== plan.version) violations.push("version does not match the deterministic release plan");
  if (suggestion.bump !== plan.bump) violations.push("bump does not match the deterministic release plan");
  if (suggestion.channel !== plan.channel) violations.push("channel does not match the deterministic release plan");
  if (suggestion.promotion !== plan.promotion) violations.push("promotion does not match the deterministic release plan");
  if (suggestion.migrationRequired !== (migrationIds.length > 0)) violations.push("migrationRequired does not match the deterministic release plan");
  if (typeof suggestion.summary !== "string" || !suggestion.summary.trim() || suggestion.summary.length > 4_000) violations.push("summary is empty or exceeds the safety limit");
  if (typeof suggestion.summary === "string" && unsafeGeneratedText(suggestion.summary)) violations.push("summary contains secret-like content");

  const highlights = Array.isArray(suggestion.highlights) ? suggestion.highlights : [];
  const highlightIds: string[] = [];
  for (const item of highlights) {
    if (!record(item) || typeof item.changeId !== "string" || typeof item.impact !== "string" || typeof item.text !== "string") {
      violations.push("highlight is not a valid structured change entry");
      continue;
    }
    highlightIds.push(item.changeId);
    const fact = known.get(item.changeId);
    if (!fact) violations.push(`highlight references unknown change ${item.changeId}`);
    else if (fact.customerFacing !== true) violations.push(`highlight exposes non-customer change ${item.changeId}`);
    else if (item.impact !== fact.impact) violations.push(`highlight changes the deterministic impact for ${item.changeId}`);
    if (!item.text.trim() || item.text.length > 2_000) violations.push(`highlight text for ${item.changeId} is empty or exceeds the safety limit`);
    if (unsafeGeneratedText(item.text)) violations.push(`highlight text for ${item.changeId} contains secret-like content`);
  }
  if (!sameMembers(highlightIds, customerIds)) violations.push("highlights do not contain exactly the deterministic customer-facing changes");

  const breakingOutput = Array.isArray(suggestion.breakingChangeIds) && suggestion.breakingChangeIds.every((item): item is string => typeof item === "string") ? suggestion.breakingChangeIds : [];
  if (!sameMembers(breakingOutput, breakingIds)) violations.push("breaking-change ids do not preserve the deterministic breaking classification");

  const migrationNotes = Array.isArray(suggestion.migrationNotes) ? suggestion.migrationNotes : [];
  const migrationOutputIds: string[] = [];
  for (const item of migrationNotes) {
    if (!record(item) || typeof item.changeId !== "string" || typeof item.text !== "string") {
      violations.push("migration note is not a valid structured entry");
      continue;
    }
    migrationOutputIds.push(item.changeId);
    const fact = known.get(item.changeId);
    if (!fact) violations.push(`migration note references unknown change ${item.changeId}`);
    else if (fact.migrationRequired !== true) violations.push(`migration note invents a requirement for ${item.changeId}`);
    if (!item.text.trim() || item.text.length > 2_000) violations.push(`migration note for ${item.changeId} is empty or exceeds the safety limit`);
    if (unsafeGeneratedText(item.text)) violations.push(`migration note for ${item.changeId} contains secret-like content`);
  }
  if (!sameMembers(migrationOutputIds, migrationIds)) violations.push("migration notes do not preserve the deterministic requirements");

  if (violations.length > 0) {
    return { status: "rejected", accepted: false, violations: [...new Set(violations)] };
  }
  return { status: "accepted", accepted: true, value: suggestion as unknown as AiReleaseNotesSuggestion, violations: [] };
}

export async function suggestAiReleaseNotes(
  plan: Pick<ReleasePlan, "version" | "previousVersion" | "bump" | "channel" | "promotion" | "releaseChanges">,
  config: AiConfig | undefined,
  options: OptionalAiFeatureOptions<AiReleaseNotesSuggestion> & ReleaseNotesRequestOptions = {}
): Promise<AiReleaseNotesSuggestion | null> {
  const { tone, verbosity, ...providerOptions } = options;
  let usedFallback = false;
  const requestOptions: OptionalAiFeatureOptions<AiReleaseNotesSuggestion> = providerOptions.fallback
    ? {
        ...providerOptions,
        fallback: async (error) => {
          usedFallback = true;
          return providerOptions.fallback!(error);
        }
      }
    : providerOptions;
  const result = await runOptionalAiFeature(config, releaseNotesRequest(plan, { tone, verbosity }), requestOptions);
  if (result === null) {
    return null;
  }
  if (usedFallback) {
    return result;
  }
  const reconciliation = reconcileReleaseNotes(plan, result);
  if (!reconciliation.accepted || !reconciliation.value) {
    throw new AiProviderError("AI release-notes output was rejected by deterministic reconciliation.", "malformed-output");
  }
  return reconciliation.value;
}

export type AiReleaseNotesPreviewStatus = "disabled" | "not-applicable" | "generated" | "unavailable";

export interface AiReleaseNotesPreview {
  status: AiReleaseNotesPreviewStatus;
  deterministic: string;
  suggestion?: AiReleaseNotesSuggestion;
  rendered?: string;
  reason?: "configuration" | "cancelled" | "timeout" | "transport" | "provider" | "malformed-output";
}

export function renderAiReleaseNotes(
  suggestion: AiReleaseNotesSuggestion,
  plan: Pick<ReleasePlan, "version" | "releaseChanges">
): string {
  const facts = releaseNotesChangeFacts({ releaseChanges: plan.releaseChanges });
  const byId = new Map(facts.flatMap((fact) => fact.id ? [[fact.id, fact] as const] : []));
  const lines = [`# What's new in ${plan.version}`, "", suggestion.summary.trim(), ""];
  for (const [title, impact] of [["New", "new"], ["Improved", "improved"], ["Fixed", "fixed"], ["Changed", "changed"]] as const) {
    const entries = suggestion.highlights.filter((highlight) => highlight.impact === impact);
    if (entries.length === 0) continue;
    lines.push(`## ${title}`, "", ...entries.map((highlight) => `- ${highlight.text.trim()}`), "");
  }
  if (facts.some((fact) => fact.breaking)) {
    lines.push("## Important upgrade note", "", "Existing behavior changes in this release; review the required action before upgrading.", "");
  }
  if (suggestion.migrationRequired) {
    lines.push("## Action required", "", ...suggestion.migrationNotes.map((note) => {
      const deterministic = byId.get(note.changeId)?.migration;
      return `- ${(deterministic ?? note.text).trim()}`;
    }), "");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export async function buildAiReleaseNotesPreview(
  plan: Pick<ReleasePlan, "version" | "previousVersion" | "bump" | "channel" | "promotion" | "releaseChanges" | "customerNotes">,
  config: AiConfig | undefined,
  options: OptionalAiFeatureOptions<AiReleaseNotesSuggestion> & ReleaseNotesRequestOptions = {}
): Promise<AiReleaseNotesPreview> {
  const deterministic = plan.customerNotes;
  if (!config?.enabled || config.releaseNotes !== true) {
    return { status: "disabled", deterministic };
  }
  if (!plan.releaseChanges.some(customerFacing)) {
    return { status: "not-applicable", deterministic };
  }
  try {
    const suggestion = await suggestAiReleaseNotes(plan, config, {
      ...options,
      tone: options.tone ?? config.tone,
      verbosity: options.verbosity ?? config.verbosity
    });
    if (!suggestion) {
      return { status: "unavailable", deterministic, reason: "provider" };
    }
    return { status: "generated", deterministic, suggestion, rendered: renderAiReleaseNotes(suggestion, plan) };
  } catch (error) {
    const reason = error instanceof AiProviderError ? error.kind : "transport";
    return { status: "unavailable", deterministic, reason };
  }
}
