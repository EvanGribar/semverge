import {
  AiProviderError,
  createAiInputEnvelope,
  redactAiText,
  runOptionalAiFeature,
  type AiJsonRequest,
  type AiRequestContext,
  type OptionalAiFeatureOptions
} from "./ai.js";
import { bumpForChange, parseChange } from "./changes.js";
import { parseSemVergeMetadata } from "./metadata.js";
import type { AiConfig, ChangeInput, CustomerImpact, ReleaseChange, ReleaseKind, SemVergeMetadata } from "./types.js";

export type MetadataSuggestionConfidence = "high" | "medium" | "low";

export interface MetadataInferenceInput {
  title: string;
  body?: string;
  labels?: string[];
  /** File paths only; file contents and diffs are never included. */
  files?: string[];
}

export interface ReleaseMetadataSuggestion {
  metadata: {
    type: ReleaseKind;
    customer: string;
    headline: string;
    outcome: string;
    detail: string;
    impact: CustomerImpact;
    action: string;
    migration: string;
    breaking: boolean;
  };
  confidence: MetadataSuggestionConfidence;
  ambiguity: string[];
}

export type AiMetadataSuggestion = ReleaseMetadataSuggestion;

export const METADATA_INFERENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    metadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["feature", "fix", "breaking", "docs", "internal", "other"] },
        customer: { type: "string", maxLength: 2_000 },
        headline: { type: "string", maxLength: 1_000 },
        outcome: { type: "string", maxLength: 2_000 },
        detail: { type: "string", maxLength: 2_000 },
        impact: { type: "string", enum: ["new", "improved", "fixed", "changed"] },
        action: { type: "string", maxLength: 2_000 },
        migration: { type: "string", maxLength: 2_000 },
        breaking: { type: "boolean" }
      },
      required: ["type", "customer", "headline", "outcome", "detail", "impact", "action", "migration", "breaking"]
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    ambiguity: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 8 }
  },
  required: ["metadata", "confidence", "ambiguity"]
};

const METADATA_INFERENCE_FEATURE = "metadata-inference";
const SAFE_FILE_PATH = /^(?![A-Za-z]:)(?!\/)(?!\\)(?!.*(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?|id_rsa(?:\.[^/]*)?)(?:\/|$))(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*(?:^|\/)(?:node_modules|dist|build|coverage|generated|vendor)(?:\/|$))[A-Za-z0-9._/@+\\-]+$/i;
const BINARY_FILE = /\.(?:7z|avi|bmp|class|dll|dmg|gif|ico|jar|jpeg|jpg|mov|mp3|mp4|pdf|png|so|tar|wasm|webp|woff2?|zip)$/i;
const METADATA_KEYS = ["type", "customer", "headline", "outcome", "detail", "impact", "action", "migration", "breaking"] as const;

function isNoAction(value: string): boolean {
  return /^(?:no|none|not)\s+(?:customer\s+)?(?:action|migration)(?:\s+(?:is\s+)?required)?[.!]?$/i.test(value.trim()) || /^n\/a[.!]?$/i.test(value.trim());
}

function customerImpactFor(change: ReleaseChange): CustomerImpact {
  if (change.breaking || change.kind === "breaking") return "changed";
  if (change.kind === "feature") return "new";
  if (change.kind === "fix") return "fixed";
  return "improved";
}

function safeFiles(files: string[] | undefined): string[] {
  return [...new Set((files ?? [])
    .map((file) => file.trim().replace(/\\/g, "/"))
    .filter((file) => file && SAFE_FILE_PATH.test(file) && !BINARY_FILE.test(file)))]
    .slice(0, 100);
}

function safeMetadata(metadata: SemVergeMetadata): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value === "string") {
      result[key] = redactAiText(value);
    } else if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  if (metadata.audience && metadata.audience.length > 0) {
    result.audience = metadata.audience.slice(0, 12).map((item) => redactAiText(item, 200));
  }
  return result;
}

function inputChange(input: MetadataInferenceInput): ReleaseChange {
  const changeInput: ChangeInput = {
    title: input.title,
    body: input.body,
    source: "pull_request",
    labels: input.labels,
    files: safeFiles(input.files)
  };
  return parseChange(changeInput);
}

function requestContext(input: MetadataInferenceInput, change: ReleaseChange): AiRequestContext {
  const files = safeFiles(input.files);
  const categories = ["pull-request-title", "conventional-commit", "labels"];
  if (input.body?.trim()) categories.push("pull-request-body");
  if (files.length > 0) categories.push("file-paths");
  const parsedMetadata = parseSemVergeMetadata(input.body ?? "");
  const metadata = safeMetadata(parsedMetadata);
  return {
    categories,
    title: input.title,
    ...(input.body?.trim() ? { body: input.body } : {}),
    ...(input.labels && input.labels.length > 0 ? { labels: [...new Set(input.labels.map((label) => label.trim().toLowerCase()).filter(Boolean))] } : {}),
    ...(files.length > 0 ? { files } : {}),
    conventional: {
      kind: change.kind,
      ...(change.scope ? { scope: change.scope } : {}),
      description: change.description || change.title,
      breaking: change.breaking
    },
    ...(Object.keys(metadata).length > 0 ? { explicitMetadata: metadata } : {})
  };
}

function metadataFacts(change: ReleaseChange) {
  const visible = change.kind === "feature" || change.kind === "fix" || change.kind === "breaking" || change.breaking;
  const migrationValue = change.migration?.trim() || change.customerCommunication?.actionRequired?.trim();
  const migration = migrationValue && !isNoAction(migrationValue) ? migrationValue : undefined;
  return {
    version: "not-calculated",
    previousVersion: "not-calculated",
    bump: bumpForChange(change),
    channel: "advisory",
    promotion: false,
    migrationRequired: Boolean(migration) || change.breaking,
    changes: [{
      id: "input",
      kind: change.kind,
      title: visible ? change.title : "[non-customer change]",
      summary: visible ? change.customerSummary : "The change is not customer-facing.",
      breaking: change.breaking,
      customerFacing: visible,
      impact: customerImpactFor(change),
      migrationRequired: Boolean(migration) || change.breaking,
      ...(migration ? { migration } : {})
    }]
  };
}

/** Build the exact bounded request context shown by `semverge infer`. */
export function metadataInferenceRequest(input: MetadataInferenceInput): AiJsonRequest {
  if (!input.title.trim()) {
    throw new AiProviderError("Metadata inference requires a pull-request title.", "configuration");
  }
  const change = inputChange(input);
  const context = requestContext(input, change);
  return {
    feature: METADATA_INFERENCE_FEATURE,
    input: createAiInputEnvelope(METADATA_INFERENCE_FEATURE, metadataFacts(change), context),
    instructions: [
      "Suggest SemVerge pull-request metadata from the bounded context.",
      "The suggestion is advisory and will not change release state until a human explicitly applies it.",
      "Preserve any explicit metadata and deterministic labels or conventional-commit classification; do not invent facts.",
      "Use low confidence and explain ambiguity when the context does not support a clear classification.",
      "Do not return secrets, credentials, source contents, diffs, or generated-file details."
    ].join(" "),
    schema: {
      name: "semverge_metadata_suggestion",
      schema: METADATA_INFERENCE_SCHEMA,
      strict: true
    }
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function metadataValue(value: unknown): ReleaseMetadataSuggestion["metadata"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (typeof object.type !== "string" || !["feature", "fix", "breaking", "docs", "internal", "other"].includes(object.type)) return undefined;
  if (typeof object.impact !== "string" || !["new", "improved", "fixed", "changed"].includes(object.impact)) return undefined;
  if (typeof object.breaking !== "boolean") return undefined;
  return {
    type: object.type as ReleaseKind,
    customer: stringValue(object.customer) ?? "",
    headline: stringValue(object.headline) ?? "",
    outcome: stringValue(object.outcome) ?? "",
    detail: stringValue(object.detail) ?? "",
    impact: object.impact as CustomerImpact,
    action: stringValue(object.action) ?? "",
    migration: stringValue(object.migration) ?? "",
    breaking: object.breaking
  };
}

function explicitMetadataFor(input: MetadataInferenceInput): SemVergeMetadata {
  return parseSemVergeMetadata(input.body ?? "");
}

export interface MetadataInferenceReconciliation {
  status: "accepted" | "rejected";
  accepted: boolean;
  metadata?: ReleaseMetadataSuggestion["metadata"];
  violations: string[];
}

/**
 * Check an advisory metadata result against deterministic precedence rules.
 * A result may be displayed only when it is structurally safe and does not
 * contradict explicit metadata or a non-ambiguous classification.
 */
export function reconcileMetadataSuggestion(
  input: MetadataInferenceInput,
  suggestion: unknown
): MetadataInferenceReconciliation {
  const violations: string[] = [];
  if (!suggestion || typeof suggestion !== "object" || Array.isArray(suggestion)) {
    return { status: "rejected", accepted: false, violations: ["AI metadata suggestion must be an object."] };
  }
  const candidate = suggestion as Record<string, unknown>;
  const metadata = metadataValue(candidate.metadata);
  if (!metadata) {
    violations.push("AI metadata suggestion has an invalid metadata object");
  }
  if (candidate.confidence !== "high" && candidate.confidence !== "medium" && candidate.confidence !== "low") {
    violations.push("AI metadata suggestion has an invalid confidence value");
  }
  if (!Array.isArray(candidate.ambiguity) || candidate.ambiguity.some((item) => typeof item !== "string" || item.length > 500) || candidate.ambiguity.length > 8) {
    violations.push("AI metadata suggestion has invalid ambiguity details");
  }
  if (!metadata) return { status: "rejected", accepted: false, violations: [...new Set(violations)] };

  const change = inputChange(input);
  const explicit = explicitMetadataFor(input);
  const deterministicKindLocked = change.kind !== "other" || explicit.type !== undefined;
  const deterministicBreakingLocked = change.kind !== "other" || explicit.breaking !== undefined || change.breaking;
  const expectedImpact = customerImpactFor(change);
  const compareExplicit = (key: keyof typeof metadata, expected: unknown): void => {
    const value = explicit[key as keyof SemVergeMetadata];
    if (value !== undefined && expected !== value) {
      violations.push(`AI metadata conflicts with explicit ${key} metadata`);
    }
  };
  compareExplicit("type", metadata.type);
  compareExplicit("customer", metadata.customer);
  compareExplicit("headline", metadata.headline);
  compareExplicit("outcome", metadata.outcome);
  compareExplicit("detail", metadata.detail);
  compareExplicit("impact", metadata.impact);
  compareExplicit("action", metadata.action);
  compareExplicit("migration", metadata.migration);
  compareExplicit("breaking", metadata.breaking);

  if (deterministicKindLocked && metadata.type !== change.kind) {
    violations.push("AI metadata cannot override the deterministic change type");
  }
  if (deterministicBreakingLocked && metadata.breaking !== change.breaking) {
    violations.push("AI metadata cannot override the deterministic breaking classification");
  }
  if (deterministicKindLocked && metadata.impact !== expectedImpact) {
    violations.push("AI metadata cannot override the deterministic customer impact");
  }
  if (metadata.type === "breaking" && !metadata.breaking) {
    violations.push("breaking metadata must set breaking to true");
  }
  if (metadata.breaking && !change.breaking && explicit.breaking !== true) {
    violations.push("AI metadata cannot invent a breaking classification");
  }
  for (const key of ["customer", "headline", "outcome", "detail", "action", "migration"] as const) {
    if (metadata[key].length > 2_000 || (metadata[key] && redactAiText(metadata[key], 2_000) !== metadata[key])) {
      violations.push(`AI metadata field ${key} exceeds the safe text contract`);
    }
  }

  if (violations.length > 0) {
    return { status: "rejected", accepted: false, violations: [...new Set(violations)] };
  }
  const merged = {
    ...metadata,
    ...(explicit.type !== undefined ? { type: explicit.type } : {}),
    ...(explicit.customer !== undefined ? { customer: explicit.customer } : {}),
    ...(explicit.headline !== undefined ? { headline: explicit.headline } : {}),
    ...(explicit.outcome !== undefined ? { outcome: explicit.outcome } : {}),
    ...(explicit.detail !== undefined ? { detail: explicit.detail } : {}),
    ...(explicit.impact !== undefined ? { impact: explicit.impact } : {}),
    ...(explicit.action !== undefined ? { action: explicit.action } : {}),
    ...(explicit.migration !== undefined ? { migration: explicit.migration } : {}),
    ...(explicit.breaking !== undefined ? { breaking: explicit.breaking } : {})
  };
  return { status: "accepted", accepted: true, metadata: merged, violations: [] };
}

export async function suggestReleaseMetadata(
  input: MetadataInferenceInput,
  config: AiConfig | undefined,
  options: OptionalAiFeatureOptions<ReleaseMetadataSuggestion> = {}
): Promise<ReleaseMetadataSuggestion | null> {
  if (!config?.enabled || config.infer === false) return null;
  const result = await runOptionalAiFeature(config, metadataInferenceRequest(input), options);
  if (result === null) return null;
  const reconciliation = reconcileMetadataSuggestion(input, result);
  if (!reconciliation.accepted || !reconciliation.metadata) {
    throw new AiProviderError("AI metadata suggestion was rejected by deterministic reconciliation.", "malformed-output");
  }
  return { ...(result as ReleaseMetadataSuggestion), metadata: reconciliation.metadata };
}

function metadataLine(key: string, value: string | boolean): string {
  if (typeof value === "boolean") return `${key}: ${value}`;
  return `${key}: ${redactAiText(value, 2_000).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").replace(/\s+#/g, " #").trim()}`;
}

export function renderMetadataBlock(metadata: ReleaseMetadataSuggestion["metadata"]): string {
  const lines = ["<!-- semverge"];
  for (const key of METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value === "boolean") {
      if (value) lines.push(metadataLine(key, value));
    } else if (value.trim()) {
      lines.push(metadataLine(key, value));
    }
  }
  lines.push("-->");
  return lines.join("\n");
}

export function applyMetadataBlock(body: string, metadata: ReleaseMetadataSuggestion["metadata"]): string {
  const block = renderMetadataBlock(metadata);
  const existing = /<!--\s*semverge(?:\s+release)?\s*[\s\S]*?-->/i;
  if (existing.test(body)) {
    return body.replace(existing, block);
  }
  const normalized = body.trim();
  return normalized ? `${block}\n\n${normalized}\n` : `${block}\n`;
}
