import type { CustomerImpact, ReleaseKind, SemVergeMetadata } from "./types.js";

const METADATA_BLOCK = /<!--\s*semverge(?:\s+release)?\s*([\s\S]*?)-->/i;
const ALLOWED_TYPES = new Set<ReleaseKind>(["feature", "fix", "breaking", "docs", "internal", "other"]);
const ALLOWED_IMPACTS = new Set<CustomerImpact>(["new", "improved", "fixed", "changed"]);

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseBoolean(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function parseValue(value: string): string | string[] | boolean | undefined {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  const booleanValue = parseBoolean(trimmed);
  if (booleanValue !== undefined) {
    return booleanValue;
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return trimmed || undefined;
}

function parseJsonMetadata(value: string): SemVergeMetadata | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const object = parsed as Record<string, unknown>;
    const result: SemVergeMetadata = {};
    if (typeof object.type === "string" && ALLOWED_TYPES.has(object.type as ReleaseKind)) {
      result.type = object.type as ReleaseKind;
    }
    for (const key of ["customer", "headline", "outcome", "detail", "migration", "internal", "announcement"] as const) {
      if (nonEmptyString(object[key])) {
        result[key] = object[key].trim();
      }
    }
    if (typeof object.impact === "string" && ALLOWED_IMPACTS.has(object.impact as CustomerImpact)) {
      result.impact = object.impact as CustomerImpact;
    }
    if (nonEmptyString(object.action)) {
      result.action = object.action.trim();
    }
    if (Array.isArray(object.audience)) {
      result.audience = object.audience.filter(nonEmptyString).map((item) => item.trim());
    }
    if (typeof object.breaking === "boolean") {
      result.breaking = object.breaking;
    }
    if (typeof object.skip === "boolean") {
      result.skip = object.skip;
    }
    if (Array.isArray(object.readiness)) {
      result.readiness = object.readiness.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
    }
    return result;
  } catch {
    return null;
  }
}

export function parseSemVergeMetadata(body = ""): SemVergeMetadata {
  const match = METADATA_BLOCK.exec(body);
  if (!match) {
    return {};
  }

  const payload = match[1]?.trim() ?? "";
  if (!payload) {
    return {};
  }
  const json = parseJsonMetadata(payload);
  if (json) {
    return json;
  }

  const result: SemVergeMetadata = {};
  for (const rawLine of payload.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s+/, "");
    const separator = line.indexOf(":");
    if (separator < 1) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase() as keyof SemVergeMetadata;
    const parsed = parseValue(line.slice(separator + 1));
    if (parsed === undefined) {
      continue;
    }
    if (key === "type" && typeof parsed === "string" && ALLOWED_TYPES.has(parsed as ReleaseKind)) {
      result.type = parsed as ReleaseKind;
    } else if (["customer", "headline", "outcome", "detail", "migration", "internal", "announcement", "action"].includes(key) && typeof parsed === "string") {
      result[key as "customer" | "headline" | "outcome" | "detail" | "migration" | "internal" | "announcement" | "action"] = parsed;
    } else if (key === "impact" && typeof parsed === "string" && ALLOWED_IMPACTS.has(parsed as CustomerImpact)) {
      result.impact = parsed as CustomerImpact;
    } else if ((key === "breaking" || key === "skip") && typeof parsed === "boolean") {
      result[key] = parsed;
    } else if (key === "readiness") {
      result.readiness = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : typeof parsed === "string" ? parsed.split(",").map((item) => item.trim()).filter(Boolean) : [];
    } else if (key === "audience") {
      result.audience = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : typeof parsed === "string" ? parsed.split(",").map((item) => item.trim()).filter(Boolean) : [];
    }
  }
  return result;
}
