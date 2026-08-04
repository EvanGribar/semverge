import { randomUUID } from "node:crypto";

export const RELEASE_TRANSACTION_SCHEMA_VERSION = 2 as const;
export const RELEASE_TRANSACTION_MARKER = "<!-- semverge-progress ";

export const RELEASE_PHASES = [
  "planned",
  "approved",
  "prepared",
  "built",
  "published",
  "verified",
  "completed"
] as const;

export type ReleasePhase = typeof RELEASE_PHASES[number];
export type ReleaseTransactionEventStatus = "completed" | "failed";

export interface ReleaseTransactionEvent {
  key: string;
  phase: ReleasePhase;
  kind: string;
  target: string;
  status: ReleaseTransactionEventStatus;
  attempt: number;
  at: string;
  detail?: string;
}

export interface ReleaseTransactionFailure {
  key?: string;
  phase: ReleasePhase;
  message: string;
  at: string;
}

export interface ReleaseTransaction {
  schemaVersion: typeof RELEASE_TRANSACTION_SCHEMA_VERSION;
  id: string;
  version: string;
  sourceCommit: string;
  phase: ReleasePhase;
  packageIds: string[];
  tagNames: string[];
  npmEnabled: boolean;
  publishedPackages: string[];
  uploadedAssets: Record<string, string[]>;
  ready: boolean;
  published: boolean;
  events: ReleaseTransactionEvent[];
  failure?: ReleaseTransactionFailure;
  updatedAt: string;
}

export interface CreateReleaseTransactionInput {
  version: string;
  sourceCommit: string;
  packageIds: string[];
  tagNames: string[];
  npmEnabled: boolean;
  id?: string;
  now?: string;
}

export interface ReleaseTransactionEventInput {
  key: string;
  kind: string;
  target: string;
  status?: ReleaseTransactionEventStatus;
  detail?: string;
  now?: string;
}

export interface ReleaseTransactionSummary {
  id: string;
  version: string;
  sourceCommit: string;
  phase: ReleasePhase;
  publishedPackages: string;
  uploadedAssets: number;
  recordedEvents: number;
  safeNextAction: string;
  failure?: string;
}

function phaseIndex(phase: ReleasePhase): number {
  return RELEASE_PHASES.indexOf(phase);
}

function timestamp(value?: string): string {
  return value ?? new Date().toISOString();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`SemVerge transaction field ${field} must be an array of strings.`);
  }
  return unique(value as string[]);
}

function phaseValue(value: unknown, field = "phase"): ReleasePhase {
  if (typeof value !== "string" || !RELEASE_PHASES.includes(value as ReleasePhase)) {
    throw new Error(`SemVerge transaction field ${field} must be a valid release phase.`);
  }
  return value as ReleasePhase;
}

function assetMap(value: unknown): Record<string, string[]> {
  const object = objectValue(value);
  if (!object) {
    throw new Error("SemVerge transaction field uploadedAssets must be an object.");
  }
  return Object.fromEntries(Object.entries(object).map(([tag, assets]) => [tag, stringArray(assets, `uploadedAssets.${tag}`)]));
}

function eventValue(value: unknown): ReleaseTransactionEvent {
  const object = objectValue(value);
  if (!object || typeof object.key !== "string" || typeof object.phase !== "string" || typeof object.kind !== "string" || typeof object.target !== "string" || (object.status !== "completed" && object.status !== "failed") || typeof object.attempt !== "number" || !Number.isInteger(object.attempt) || object.attempt < 1 || typeof object.at !== "string") {
    throw new Error("SemVerge transaction contains an invalid event.");
  }
  return {
    key: object.key,
    phase: phaseValue(object.phase, "events.phase"),
    kind: object.kind,
    target: object.target,
    status: object.status,
    attempt: object.attempt,
    at: object.at,
    ...(typeof object.detail === "string" ? { detail: object.detail } : {})
  };
}

function normalizeAssets(value: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(value).map(([tag, assets]) => [tag, unique(assets)]));
}

export function createReleaseTransaction(input: CreateReleaseTransactionInput): ReleaseTransaction {
  const now = timestamp(input.now);
  return {
    schemaVersion: RELEASE_TRANSACTION_SCHEMA_VERSION,
    id: input.id ?? `release_${randomUUID().replace(/-/g, "")}`,
    version: input.version,
    sourceCommit: input.sourceCommit,
    phase: "planned",
    packageIds: unique(input.packageIds),
    tagNames: unique(input.tagNames),
    npmEnabled: input.npmEnabled,
    publishedPackages: input.npmEnabled ? [] : unique(input.packageIds),
    uploadedAssets: Object.fromEntries(unique(input.tagNames).map((tag) => [tag, []])),
    ready: false,
    published: false,
    events: [],
    updatedAt: now
  };
}

export function recordReleaseTransactionEvent(state: ReleaseTransaction, input: ReleaseTransactionEventInput): ReleaseTransaction {
  const status = input.status ?? "completed";
  if (status === "completed" && state.events.some((event) => event.key === input.key && event.status === "completed")) {
    return state;
  }
  const attempt = Math.max(0, ...state.events.filter((event) => event.key === input.key).map((event) => event.attempt)) + 1;
  const at = timestamp(input.now);
  const event: ReleaseTransactionEvent = {
    key: input.key,
    phase: state.phase,
    kind: input.kind,
    target: input.target,
    status,
    attempt,
    at,
    ...(input.detail ? { detail: input.detail } : {})
  };
  return {
    ...state,
    events: [...state.events, event],
    ...(status === "failed"
      ? { failure: { key: input.key, phase: state.phase, message: input.detail ?? "The transaction step failed.", at } }
      : state.failure?.key === input.key ? { failure: undefined } : {}),
    updatedAt: at
  };
}

export function advanceReleaseTransaction(state: ReleaseTransaction, phase: ReleasePhase, input: ReleaseTransactionEventInput): ReleaseTransaction {
  if (phaseIndex(phase) < phaseIndex(state.phase)) {
    throw new Error(`SemVerge cannot move a release transaction from ${state.phase} back to ${phase}.`);
  }
  const next = { ...state, phase };
  return recordReleaseTransactionEvent(next, { ...input, now: input.now });
}

export function mergeReleaseTransactions(states: Array<ReleaseTransaction | null>, expected: ReleaseTransaction): ReleaseTransaction {
  const present = states.filter((state): state is ReleaseTransaction => state !== null);
  if (present.length === 0) {
    return expected;
  }
  if (new Set(present.map((state) => state.id)).size > 1) {
    throw new Error("SemVerge found multiple release transaction IDs for the same release; verify the draft releases before retrying.");
  }
  let merged: ReleaseTransaction = {
    ...expected,
    id: present[0]?.id ?? expected.id,
    sourceCommit: present.find((state) => state.sourceCommit !== "unknown")?.sourceCommit ?? expected.sourceCommit,
    packageIds: [...expected.packageIds],
    tagNames: [...expected.tagNames],
    publishedPackages: [...expected.publishedPackages],
    uploadedAssets: normalizeAssets(expected.uploadedAssets),
    events: [...expected.events],
    ready: false,
    published: false
  };
  for (const state of present) {
    if (state.version !== expected.version || state.npmEnabled !== expected.npmEnabled || (state.sourceCommit !== "unknown" && expected.sourceCommit !== "unknown" && state.sourceCommit !== expected.sourceCommit) || !sameValues(state.packageIds, expected.packageIds) || !sameValues(state.tagNames, expected.tagNames)) {
      throw new Error("SemVerge found release transaction state for a different release or publishing configuration; verify the draft releases before retrying.");
    }
    if (phaseIndex(state.phase) > phaseIndex(merged.phase)) {
      merged.phase = state.phase;
    }
    merged.publishedPackages = unique([...merged.publishedPackages, ...state.publishedPackages]);
    merged.ready ||= state.ready;
    merged.published ||= state.published;
    for (const tag of expected.tagNames) {
      merged.uploadedAssets[tag] = unique([...(merged.uploadedAssets[tag] ?? []), ...(state.uploadedAssets[tag] ?? [])]);
    }
    const events = new Map(merged.events.map((event) => [`${event.key}:${event.status}:${event.attempt}`, event]));
    for (const event of state.events) {
      events.set(`${event.key}:${event.status}:${event.attempt}`, event);
    }
    merged.events = [...events.values()].sort((left, right) => left.at.localeCompare(right.at));
    if (state.failure && (!merged.failure || state.failure.at > merged.failure.at)) {
      merged.failure = state.failure;
    }
    if (state.updatedAt > merged.updatedAt) {
      merged.updatedAt = state.updatedAt;
    }
  }
  return merged;
}

function upgradeLegacyTransaction(record: Record<string, unknown>): ReleaseTransaction {
  if (typeof record.version !== "string" || typeof record.npmEnabled !== "boolean") {
    throw new Error("SemVerge found an invalid legacy release transaction marker.");
  }
  const packageIds = stringArray(record.packageIds, "packageIds");
  const tagNames = stringArray(record.tagNames, "tagNames");
  const uploadedAssets = assetMap(record.uploadedAssets);
  const publishedPackages = stringArray(record.publishedPackages, "publishedPackages");
  if (typeof record.ready !== "boolean" || typeof record.published !== "boolean") {
    throw new Error("SemVerge found an invalid legacy release transaction marker.");
  }
  const phase: ReleasePhase = record.published ? "published" : record.ready ? "built" : "prepared";
  return {
    ...createReleaseTransaction({
      id: `release_legacy_${record.version.replace(/[^0-9A-Za-z.-]/g, "-")}`,
      version: record.version,
      sourceCommit: "unknown",
      packageIds,
      tagNames,
      npmEnabled: record.npmEnabled,
      now: typeof record.updatedAt === "string" ? record.updatedAt : undefined
    }),
    phase,
    publishedPackages,
    uploadedAssets,
    ready: record.ready,
    published: record.published
  };
}

export function parseReleaseTransaction(value: unknown): ReleaseTransaction {
  const record = objectValue(value);
  if (!record) {
    throw new Error("SemVerge found an invalid release transaction marker.");
  }
  if (record.schemaVersion === 1) {
    return upgradeLegacyTransaction(record);
  }
  if (record.schemaVersion !== RELEASE_TRANSACTION_SCHEMA_VERSION || typeof record.id !== "string" || typeof record.version !== "string" || typeof record.sourceCommit !== "string" || typeof record.npmEnabled !== "boolean" || typeof record.ready !== "boolean" || typeof record.published !== "boolean" || typeof record.updatedAt !== "string" || !Array.isArray(record.events)) {
    throw new Error("SemVerge found an invalid release transaction marker.");
  }
  const failure = record.failure === undefined ? undefined : objectValue(record.failure);
  if (failure && (typeof failure.phase !== "string" || typeof failure.message !== "string" || typeof failure.at !== "string")) {
    throw new Error("SemVerge found an invalid release transaction failure.");
  }
  const normalizedFailure = failure ? { ...(typeof failure.key === "string" ? { key: failure.key } : {}), phase: phaseValue(failure.phase, "failure.phase"), message: failure.message as string, at: failure.at as string } : undefined;
  return {
    schemaVersion: RELEASE_TRANSACTION_SCHEMA_VERSION,
    id: record.id,
    version: record.version,
    sourceCommit: record.sourceCommit,
    phase: phaseValue(record.phase),
    packageIds: stringArray(record.packageIds, "packageIds"),
    tagNames: stringArray(record.tagNames, "tagNames"),
    npmEnabled: record.npmEnabled,
    publishedPackages: stringArray(record.publishedPackages, "publishedPackages"),
    uploadedAssets: normalizeAssets(assetMap(record.uploadedAssets)),
    ready: record.ready,
    published: record.published,
    events: record.events.map(eventValue),
    ...(normalizedFailure ? { failure: normalizedFailure } : {}),
    updatedAt: record.updatedAt
  };
}

export function parseReleaseTransactionBody(body: string | null | undefined): ReleaseTransaction | null {
  const match = body?.match(/<!-- semverge-progress ([\s\S]*?) -->/);
  if (!match) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(match[1] ?? "");
  } catch (error) {
    throw new Error(`SemVerge found an invalid release transaction marker: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseReleaseTransaction(value);
}

export function releaseTransactionMarker(state: ReleaseTransaction): string {
  return `${RELEASE_TRANSACTION_MARKER}${JSON.stringify(state)} -->`;
}

export function releaseTransactionBody(customerNotes: string, state: ReleaseTransaction): string {
  return `${releaseTransactionMarker(state)}\n\n${customerNotes.trim()}\n\n${releaseTransactionSummaryMarkdown(state)}\n`;
}

export function updateReleaseTransactionBody(body: string, state: ReleaseTransaction): string {
  const marker = releaseTransactionMarker(state);
  const markerMatch = body.match(/<!-- semverge-progress [\s\S]*? -->/);
  if (!markerMatch || markerMatch.index === undefined) {
    return `${marker}\n\n${body.trim()}\n\n${releaseTransactionSummaryMarkdown(state)}\n`;
  }
  const afterMarker = body.slice(markerMatch.index + markerMatch[0].length).replace(/\n*### SemVerge transaction[\s\S]*$/, "").trimEnd();
  return `${body.slice(0, markerMatch.index)}${marker}${afterMarker}\n\n${releaseTransactionSummaryMarkdown(state)}\n`;
}

export function summarizeReleaseTransaction(state: ReleaseTransaction): ReleaseTransactionSummary {
  const uploadedAssets = Object.values(state.uploadedAssets).reduce((total, assets) => total + assets.length, 0);
  let safeNextAction: string;
  if (state.failure) {
    safeNextAction = `Resolve the recorded failure, then rerun the release workflow for ${state.id}.`;
  } else if (state.phase === "completed") {
    safeNextAction = "No action required; the release transaction is complete.";
  } else if (state.phase === "verified") {
    safeNextAction = `Finalize ${state.id} after verification completes.`;
  } else {
    safeNextAction = `Resume ${state.id}; completed side effects will be skipped safely.`;
  }
  return {
    id: state.id,
    version: state.version,
    sourceCommit: state.sourceCommit,
    phase: state.phase,
    publishedPackages: `${state.publishedPackages.length}/${state.packageIds.length}`,
    uploadedAssets,
    recordedEvents: state.events.length,
    safeNextAction,
    ...(state.failure ? { failure: state.failure.message } : {})
  };
}

export function releaseTransactionSummaryMarkdown(state: ReleaseTransaction): string {
  const summary = summarizeReleaseTransaction(state);
  return [
    "### SemVerge transaction",
    `- ID: \`${summary.id}\``,
    `- Version: \`${summary.version}\``,
    `- Source commit: \`${summary.sourceCommit}\``,
    `- State: **${summary.phase}**`,
    `- Packages published: **${summary.publishedPackages}**`,
    `- Uploaded assets recorded: **${summary.uploadedAssets}**`,
    `- Recorded side effects: **${summary.recordedEvents}**`,
    ...(summary.failure ? [`- Recorded failure: ${summary.failure}`] : []),
    `- Safe next action: ${summary.safeNextAction}`
  ].join("\n");
}
