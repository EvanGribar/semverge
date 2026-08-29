import type { AiConfig, AiProviderName, BumpLevel, ReleaseKind } from "./types.js";
import { DEFAULT_AI_TIMEOUT_MS } from "./types.js";

export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY" as const;
export const OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions" as const;

export const MAX_AI_FEATURE_LENGTH = 80;
export const MAX_AI_TEXT_LENGTH = 4_000;
export const MAX_AI_CHANGE_COUNT = 100;
export const MAX_AI_CONTEXT_LABEL_COUNT = 50;
export const MAX_AI_CONTEXT_FILE_COUNT = 100;
export const MAX_AI_REQUEST_BYTES = 64_000;
const SAFE_CONTEXT_FILE_PATH = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))(?!.*(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|credentials?(?:\.[^\\/]*)?|secrets?(?:\.[^\\/]*)?|id_rsa(?:\.[^\\/]*)?)(?:[\\/]|$))(?!.*(?:^|[\\/])(?:node_modules|dist|build|coverage|generated|vendor)(?:[\\/]|$))[A-Za-z0-9._/@+\\-]+$/i;

export type AiProviderErrorKind = "configuration" | "cancelled" | "timeout" | "transport" | "provider" | "malformed-output";

export class AiProviderError extends Error {
  constructor(message: string, public readonly kind: AiProviderErrorKind) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiChangeFact {
  /** Stable source identifier used to reconcile model output with release facts. */
  id?: string;
  kind: ReleaseKind;
  title: string;
  summary: string;
  breaking: boolean;
  customerFacing?: boolean;
  impact?: "new" | "improved" | "fixed" | "changed";
  migrationRequired?: boolean;
  migration?: string;
}

export interface AiReleaseFacts {
  version: string;
  previousVersion: string;
  bump: BumpLevel;
  channel: string;
  changes: readonly AiChangeFact[];
  promotion?: boolean;
  migrationRequired?: boolean;
}

export interface AiRequestContext {
  categories: string[];
  title?: string;
  body?: string;
  labels?: string[];
  files?: string[];
  conventional?: {
    kind: ReleaseKind;
    scope?: string;
    description: string;
    breaking: boolean;
  };
  explicitMetadata?: Record<string, unknown>;
}

export interface AiInputEnvelope {
  schemaVersion: 1;
  feature: string;
  release: {
    version: string;
    previousVersion: string;
    bump: BumpLevel;
    channel: string;
    changes: AiChangeFact[];
    promotion?: boolean;
    migrationRequired?: boolean;
  };
  context?: AiRequestContext;
}

export interface AiJsonSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface AiJsonRequest {
  feature: string;
  input: AiInputEnvelope;
  instructions: string;
  schema: AiJsonSchema;
}

export interface AiRequestOptions {
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly name: AiProviderName;
  generateJson<T>(request: AiJsonRequest, options?: AiRequestOptions): Promise<T>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface AiProviderFactoryOptions {
  fetchImpl?: FetchLike;
  endpoint?: string;
}

export interface OptionalAiFeatureOptions<T> extends AiRequestOptions, AiProviderFactoryOptions {
  env?: NodeJS.ProcessEnv;
  fallback?: (error: AiProviderError) => T | null | Promise<T | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function configurationError(message: string): AiProviderError {
  return new AiProviderError(message, "configuration");
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw configurationError(`AI ${field} must be a non-empty string.`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw configurationError(`AI ${field} must be ${maxLength} characters or fewer.`);
  }
  return result;
}

function exactKeys(value: Record<string, unknown>, expected: string[], optional: string[] = []): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...expected, ...optional]);
  return expected.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

function releaseKind(value: unknown): value is ReleaseKind {
  return value === "feature" || value === "fix" || value === "breaking" || value === "docs" || value === "internal" || value === "other";
}

function bumpLevel(value: unknown): value is BumpLevel {
  return value === "none" || value === "patch" || value === "minor" || value === "major";
}

function customerImpact(value: unknown): value is "new" | "improved" | "fixed" | "changed" {
  return value === "new" || value === "improved" || value === "fixed" || value === "changed";
}

function boundedText(value: unknown, field: string, maxLength = MAX_AI_TEXT_LENGTH): string {
  if (typeof value !== "string" || !value.trim()) {
    throw configurationError(`AI ${field} must be a non-empty string.`);
  }
  const result = redactAiText(value, maxLength);
  if (!result) {
    throw configurationError(`AI ${field} must be a non-empty string.`);
  }
  return result;
}

const PRIVATE_KEY_BEGIN_MARKER = "-----begin";
const PRIVATE_KEY_END_MARKER = "-----end";
const PRIVATE_KEY_LABEL_SUFFIX = " private key";

function findNextPrivateKeyMarker(value: string, fromIndex: number): { start: number; marker: string; isBegin: boolean } | undefined {
  for (let index = Math.max(0, fromIndex); index < value.length; index += 1) {
    if (value.slice(index, index + PRIVATE_KEY_BEGIN_MARKER.length).toLowerCase() === PRIVATE_KEY_BEGIN_MARKER) {
      return { start: index, marker: PRIVATE_KEY_BEGIN_MARKER, isBegin: true };
    }
    if (value.slice(index, index + PRIVATE_KEY_END_MARKER.length).toLowerCase() === PRIVATE_KEY_END_MARKER) {
      return { start: index, marker: PRIVATE_KEY_END_MARKER, isBegin: false };
    }
  }
  return undefined;
}

function privateKeyMarkerEnd(value: string, start: number, marker: string): number | undefined {
  if (value.slice(start, start + marker.length).toLowerCase() !== marker) return undefined;

  const delimiter = value.indexOf("-----", start + marker.length);
  if (delimiter < 0) return undefined;

  const labelStart = start + marker.length;
  const suffixStart = delimiter - PRIVATE_KEY_LABEL_SUFFIX.length;
  if (suffixStart < labelStart || value.slice(suffixStart, delimiter).toLowerCase() !== PRIVATE_KEY_LABEL_SUFFIX) {
    return undefined;
  }

  const qualifierLength = suffixStart - labelStart;
  if (qualifierLength > 0) {
    if (value[labelStart] !== " ") return undefined;
    for (let index = labelStart + 1; index < suffixStart; index += 1) {
      if (value[index] === "-") return undefined;
    }
  }

  return delimiter + "-----".length;
}

/** Scan PEM markers in one forward pass so untrusted text cannot trigger regex backtracking. */
function redactPrivateKeyBlocks(value: string): string {
  const pieces: string[] = [];
  let copyFrom = 0;
  let openStart: number | undefined;
  let cursor = 0;

  while (cursor < value.length) {
    const nextMarker = findNextPrivateKeyMarker(value, cursor);
    if (!nextMarker) break;

    const markerEnd = privateKeyMarkerEnd(value, nextMarker.start, nextMarker.marker);
    if (markerEnd === undefined) {
      cursor = nextMarker.start + nextMarker.marker.length;
      continue;
    }

    if (nextMarker.isBegin) {
      if (openStart === undefined) openStart = nextMarker.start;
    } else if (openStart !== undefined) {
      pieces.push(value.slice(copyFrom, openStart), "[REDACTED PRIVATE KEY]");
      copyFrom = markerEnd;
      openStart = undefined;
    }
    cursor = markerEnd;
  }

  pieces.push(value.slice(copyFrom));
  return pieces.join("");
}

/**
 * Remove common credential-shaped values before any user-controlled text is
 * placed in a provider request. This deliberately redacts by key and token
 * shape rather than attempting to identify every possible secret format.
 */
export function redactAiText(value: string, maxLength = MAX_AI_TEXT_LENGTH): string {
  const redacted = redactPrivateKeyBlocks(value)
    .replace(/\b(?:bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|ghp|gho|ghu|ghs|github_pat|xoxb|xoxp)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{12,}\b/g, "[REDACTED ACCESS KEY]")
    .replace(/(["']?\b(?:authorization|password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|npm[_-]?token|pypi[_-]?token|github[_-]?token|openai[_-]?api[_-]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n,;}\]]+))/gi, (match) => `${match.slice(0, match.search(/[:=]/))}: [REDACTED]`)
    .replace(/\b(?:OPENAI_API_KEY|GITHUB_TOKEN|NPM_TOKEN|PYPI_TOKEN)\b/gi, "[REDACTED ENVIRONMENT SECRET]");
  return redacted.trim().slice(0, maxLength);
}

function assertContext(context: unknown): asserts context is AiRequestContext {
  if (!isRecord(context) || !exactKeys(context, ["categories"], ["title", "body", "labels", "files", "conventional", "explicitMetadata"])) {
    throw configurationError("AI request context contains unsupported fields.");
  }
  if (!Array.isArray(context.categories) || context.categories.length === 0 || context.categories.length > 12 || context.categories.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_AI_FEATURE_LENGTH)) {
    throw configurationError("AI request context categories must be a bounded list of non-empty strings.");
  }
  if (context.title !== undefined) boundedText(context.title, "context.title");
  if (context.body !== undefined) boundedText(context.body, "context.body");
  if (context.labels !== undefined && (!Array.isArray(context.labels) || context.labels.length > MAX_AI_CONTEXT_LABEL_COUNT || context.labels.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_AI_FEATURE_LENGTH))) {
    throw configurationError("AI request context labels must be a bounded list of non-empty strings.");
  }
  if (context.files !== undefined && (!Array.isArray(context.files) || context.files.length > MAX_AI_CONTEXT_FILE_COUNT || context.files.some((item) => typeof item !== "string" || !item.trim() || item.length > MAX_AI_TEXT_LENGTH || /[\r\n\0]/.test(item) || !SAFE_CONTEXT_FILE_PATH.test(item)))) {
    throw configurationError("AI request context files must be a bounded list of safe paths.");
  }
  if (context.conventional !== undefined) {
    if (!isRecord(context.conventional) || !exactKeys(context.conventional, ["kind", "description", "breaking"], ["scope"]) || !releaseKind(context.conventional.kind) || typeof context.conventional.breaking !== "boolean") {
      throw configurationError("AI request context conventional metadata is invalid.");
    }
    boundedText(context.conventional.description, "context.conventional.description");
    if (context.conventional.scope !== undefined) boundedText(context.conventional.scope, "context.conventional.scope", MAX_AI_FEATURE_LENGTH);
  }
  if (context.explicitMetadata !== undefined) {
    if (!isRecord(context.explicitMetadata) || Object.keys(context.explicitMetadata).some((key) => !["type", "customer", "headline", "outcome", "detail", "impact", "action", "audience", "migration", "internal", "announcement", "breaking", "skip", "readiness"].includes(key))) {
      throw configurationError("AI request context explicit metadata contains unsupported fields.");
    }
    for (const [key, value] of Object.entries(context.explicitMetadata)) {
      if (typeof value === "string") {
        boundedText(value, `context.explicitMetadata.${key}`);
      } else if (typeof value === "boolean") {
        continue;
      } else if (Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= MAX_AI_TEXT_LENGTH)) {
        continue;
      } else {
        throw configurationError(`AI request context explicit metadata field ${key} is invalid.`);
      }
    }
  }
}

/**
 * Validate the intentionally narrow envelope sent to an AI provider.
 * Callers cannot accidentally pass source files, configuration, or credentials
 * through this layer without changing this contract first.
 */
export function assertAiInputEnvelope(value: unknown): asserts value is AiInputEnvelope {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "feature", "release"], ["context"]) || value.schemaVersion !== 1) {
    throw configurationError("AI input must be a schemaVersion 1 release-facts envelope.");
  }
  requiredText(value.feature, "feature", MAX_AI_FEATURE_LENGTH);

  if (!isRecord(value.release) || !exactKeys(value.release, ["version", "previousVersion", "bump", "channel", "changes"], ["promotion", "migrationRequired"])) {
    throw configurationError("AI input release facts contain unsupported fields.");
  }
  requiredText(value.release.version, "release.version", MAX_AI_TEXT_LENGTH);
  requiredText(value.release.previousVersion, "release.previousVersion", MAX_AI_TEXT_LENGTH);
  if (!bumpLevel(value.release.bump)) {
    throw configurationError("AI input release.bump must be none, patch, minor, or major.");
  }
  requiredText(value.release.channel, "release.channel", MAX_AI_TEXT_LENGTH);
  if (value.release.promotion !== undefined && typeof value.release.promotion !== "boolean") {
    throw configurationError("AI input release.promotion must be a boolean when provided.");
  }
  if (value.release.migrationRequired !== undefined && typeof value.release.migrationRequired !== "boolean") {
    throw configurationError("AI input release.migrationRequired must be a boolean when provided.");
  }
  if (!Array.isArray(value.release.changes) || value.release.changes.length > MAX_AI_CHANGE_COUNT) {
    throw configurationError(`AI input release.changes must contain at most ${MAX_AI_CHANGE_COUNT} items.`);
  }
  for (const [index, change] of value.release.changes.entries()) {
    if (!isRecord(change) || !exactKeys(change, ["kind", "title", "summary", "breaking"], ["id", "customerFacing", "impact", "migrationRequired", "migration"]) || !releaseKind(change.kind) || typeof change.breaking !== "boolean") {
      throw configurationError(`AI input release.changes[${index}] is not a supported release fact.`);
    }
    if (change.id !== undefined) requiredText(change.id, `release.changes[${index}].id`, MAX_AI_TEXT_LENGTH);
    requiredText(change.title, `release.changes[${index}].title`, MAX_AI_TEXT_LENGTH);
    requiredText(change.summary, `release.changes[${index}].summary`, MAX_AI_TEXT_LENGTH);
    if (change.customerFacing !== undefined && typeof change.customerFacing !== "boolean") {
      throw configurationError(`AI input release.changes[${index}].customerFacing must be a boolean when provided.`);
    }
    if (change.impact !== undefined && !customerImpact(change.impact)) {
      throw configurationError(`AI input release.changes[${index}].impact is invalid.`);
    }
    if (change.migrationRequired !== undefined && typeof change.migrationRequired !== "boolean") {
      throw configurationError(`AI input release.changes[${index}].migrationRequired must be a boolean when provided.`);
    }
    if (change.migration !== undefined) requiredText(change.migration, `release.changes[${index}].migration`, MAX_AI_TEXT_LENGTH);
  }
  if (value.context !== undefined) {
    assertContext(value.context);
  }
}

export function createAiInputEnvelope(feature: string, facts: AiReleaseFacts, context?: AiRequestContext): AiInputEnvelope {
  const envelope: AiInputEnvelope = {
    schemaVersion: 1,
    feature: boundedText(feature, "feature", MAX_AI_FEATURE_LENGTH),
    release: {
      version: boundedText(facts.version, "release.version"),
      previousVersion: boundedText(facts.previousVersion, "release.previousVersion"),
      bump: facts.bump,
      channel: boundedText(facts.channel, "release.channel"),
      changes: facts.changes.map((change) => ({
        ...(change.id !== undefined ? { id: boundedText(change.id, "release.change.id") } : {}),
        kind: change.kind,
        title: boundedText(change.title, "release.change.title"),
        summary: boundedText(change.summary, "release.change.summary"),
        breaking: change.breaking,
        ...(change.customerFacing !== undefined ? { customerFacing: change.customerFacing } : {}),
        ...(change.impact !== undefined ? { impact: change.impact } : {}),
        ...(change.migrationRequired !== undefined ? { migrationRequired: change.migrationRequired } : {}),
        ...(change.migration !== undefined ? { migration: boundedText(change.migration, "release.change.migration") } : {})
      }))
    }
  };
  if (facts.promotion !== undefined) envelope.release.promotion = facts.promotion;
  if (facts.migrationRequired !== undefined) envelope.release.migrationRequired = facts.migrationRequired;
  if (context !== undefined) {
    envelope.context = {
      categories: context.categories.map((category) => boundedText(category, "context.category", MAX_AI_FEATURE_LENGTH)),
      ...(context.title !== undefined ? { title: boundedText(context.title, "context.title") } : {}),
      ...(context.body !== undefined ? { body: boundedText(context.body, "context.body") } : {}),
      ...(context.labels !== undefined ? { labels: context.labels.map((label) => boundedText(label, "context.label", MAX_AI_FEATURE_LENGTH)) } : {}),
      ...(context.files !== undefined ? { files: context.files.map((file) => boundedText(file, "context.file")) } : {}),
      ...(context.conventional !== undefined ? {
        conventional: {
          kind: context.conventional.kind,
          ...(context.conventional.scope !== undefined ? { scope: boundedText(context.conventional.scope, "context.conventional.scope", MAX_AI_FEATURE_LENGTH) } : {}),
          description: boundedText(context.conventional.description, "context.conventional.description"),
          breaking: context.conventional.breaking
        }
      } : {}),
      ...(context.explicitMetadata !== undefined ? { explicitMetadata: context.explicitMetadata } : {})
    };
  }
  assertAiInputEnvelope(envelope);
  return envelope;
}

function validateJsonRequest(request: AiJsonRequest): void {
  if (!isRecord(request)) {
    throw configurationError("AI request must be an object.");
  }
  const feature = requiredText(request.feature, "feature", MAX_AI_FEATURE_LENGTH);
  assertAiInputEnvelope(request.input);
  if (request.input.feature !== feature) {
    throw configurationError("AI request feature must match the input envelope feature.");
  }
  requiredText(request.instructions, "instructions", MAX_AI_TEXT_LENGTH);
  if (!isRecord(request.schema) || !/^[A-Za-z0-9_-]{1,64}$/.test(request.schema.name) || !isRecord(request.schema.schema)) {
    throw configurationError("AI request schema must have a safe name and an object schema.");
  }
}

function assertRequestSize(body: string): void {
  if (Buffer.byteLength(body, "utf8") > MAX_AI_REQUEST_BYTES) {
    throw configurationError(`AI request exceeds the ${MAX_AI_REQUEST_BYTES}-byte safety limit.`);
  }
}

function providerErrorDetail(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== "string") {
    return "The provider returned an error.";
  }
  return redactAiText(value.error.message.replace(/\s+/g, " "), 240) || "The provider returned an error.";
}

function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function responseContent(payload: unknown, feature: string): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new AiProviderError(`OpenAI returned no JSON content for feature "${feature}".`, "malformed-output");
  }
  const choice = payload.choices[0];
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
  if (message && typeof message.refusal === "string" && message.refusal.trim()) {
    throw new AiProviderError(`OpenAI refused the optional AI feature "${feature}".`, "provider");
  }
  if (!message) {
    throw new AiProviderError(`OpenAI returned no message for feature "${feature}".`, "malformed-output");
  }
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    const content = message.content
      .flatMap((part) => isRecord(part) && typeof part.text === "string" ? [part.text] : [])
      .join("")
      .trim();
    if (content) {
      return content;
    }
  }
  throw new AiProviderError(`OpenAI returned empty content for feature "${feature}".`, "malformed-output");
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return false;
}

/** Validate the subset of JSON Schema used for provider response contracts. */
export function matchesAiJsonSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => sameJsonValue(candidate, value))) {
    return false;
  }
  if ("const" in schema && !sameJsonValue(schema.const, value)) {
    return false;
  }
  if (typeof schema.type === "string" && !schemaTypeMatches(value, schema.type)) {
    return false;
  }
  if (Array.isArray(schema.type) && !schema.type.some((type) => typeof type === "string" && schemaTypeMatches(value, type))) {
    return false;
  }
  if (typeof schema.minLength === "number" && typeof value === "string" && value.length < schema.minLength) {
    return false;
  }
  if (typeof schema.maxLength === "number" && typeof value === "string" && value.length > schema.maxLength) {
    return false;
  }
  if (typeof schema.minItems === "number" && Array.isArray(value) && value.length < schema.minItems) {
    return false;
  }
  if (typeof schema.maxItems === "number" && Array.isArray(value) && value.length > schema.maxItems) {
    return false;
  }
  if (Array.isArray(value)) {
    if (isRecord(schema.items) && !value.every((item) => matchesAiJsonSchema(item, schema.items as Record<string, unknown>))) {
      return false;
    }
    return true;
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required) && schema.required.some((key) => typeof key !== "string" || !(key in value))) {
      return false;
    }
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !(key in properties))) {
      return false;
    }
    return Object.entries(properties).every(([key, propertySchema]) => !(key in value) || (isRecord(propertySchema) && matchesAiJsonSchema(value[key], propertySchema)));
  }
  return true;
}

async function runWithTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw new AiProviderError("AI request was cancelled before it started.", "cancelled");
  }
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const workPromise = Promise.resolve().then(() => work(controller.signal));
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new AiProviderError(`AI request timed out after ${timeoutMs}ms.`, "timeout"));
    }, timeoutMs);
  });
  const racers: Array<Promise<T>> = [workPromise, timeoutPromise];
  if (signal) {
    const cancellationPromise = new Promise<T>((_, reject) => {
      onAbort = () => {
        controller.abort(signal.reason);
        reject(new AiProviderError("AI request was cancelled.", "cancelled"));
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
    racers.push(cancellationPromise);
  }
  try {
    return await Promise.race(racers);
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    const message = error instanceof Error && error.message ? `: ${error.message}` : "";
    throw new AiProviderError(`OpenAI request failed${message}.`, "transport");
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  endpoint?: string;
}

export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly endpoint: string;

  constructor(options: OpenAiProviderOptions) {
    if (typeof options.apiKey !== "string" || !options.apiKey.trim()) {
      throw configurationError(`OpenAI requires ${OPENAI_API_KEY_ENV} to be set.`);
    }
    if (typeof options.model !== "string" || !options.model.trim()) {
      throw configurationError("OpenAI requires ai.model when AI is enabled.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw configurationError("AI timeoutMs must be a positive integer.");
    }
    this.apiKey = options.apiKey.trim();
    this.model = options.model.trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.endpoint = options.endpoint ?? OPENAI_CHAT_COMPLETIONS_ENDPOINT;
  }

  async generateJson<T>(request: AiJsonRequest, options: AiRequestOptions = {}): Promise<T> {
    validateJsonRequest(request);
    const body = JSON.stringify({
      model: this.model,
      messages: [
        {
          role: "system",
          content: [
            "You provide optional advisory communication for SemVerge.",
            "Use only the release facts in the input envelope.",
            "Your response is communication guidance only and must not change version, readiness, publication, transaction, artifact-integrity, or registry decisions.",
            request.instructions
          ].join("\n")
        },
        { role: "user", content: JSON.stringify(request.input) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: request.schema.name,
          strict: request.schema.strict ?? true,
          schema: request.schema.schema
        }
      }
    });
    assertRequestSize(body);
    const { response, text } = await runWithTimeout(async (signal) => {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body,
        signal
      });
      return { response, text: await response.text() };
    }, this.timeoutMs, options.signal);
    const payload = parsePayload(text);
    if (!response.ok) {
      throw new AiProviderError(`OpenAI request failed with HTTP ${response.status}: ${providerErrorDetail(payload)}`, "provider");
    }
    const content = responseContent(payload, request.feature);
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      throw new AiProviderError(`OpenAI returned malformed JSON for feature "${request.feature}".`, "malformed-output");
    }
    if (!matchesAiJsonSchema(value, request.schema.schema)) {
      throw new AiProviderError(`OpenAI returned JSON that does not match the schema for feature "${request.feature}".`, "malformed-output");
    }
    return value as T;
  }
}

export function createAiProvider(config: AiConfig | undefined, env: NodeJS.ProcessEnv = process.env, options: AiProviderFactoryOptions = {}): AiProvider | null {
  if (!config?.enabled) {
    return null;
  }
  if (config.provider !== "openai") {
    throw configurationError(`Unsupported AI provider "${String(config.provider)}".`);
  }
  const apiKey = env[OPENAI_API_KEY_ENV]?.trim();
  if (!apiKey) {
    throw configurationError(`AI is enabled, but ${OPENAI_API_KEY_ENV} is not set. Store the key in the environment or GitHub Actions secrets; never put it in .semverge.yml.`);
  }
  return new OpenAiProvider({
    apiKey,
    model: config.model,
    timeoutMs: config.timeoutMs,
    fetchImpl: options.fetchImpl,
    endpoint: options.endpoint
  });
}

export async function runOptionalAiFeature<T>(config: AiConfig | undefined, request: AiJsonRequest, options: OptionalAiFeatureOptions<T> = {}): Promise<T | null> {
  if (!config?.enabled) {
    return null;
  }
  try {
    const provider = createAiProvider(config, options.env, options);
    if (!provider) {
      return null;
    }
    return await provider.generateJson<T>(request, { signal: options.signal });
  } catch (error) {
    const failure = error instanceof AiProviderError
      ? error
      : new AiProviderError(error instanceof Error ? error.message : String(error), "transport");
    if (options.fallback) {
      return await options.fallback(failure);
    }
    throw failure;
  }
}
