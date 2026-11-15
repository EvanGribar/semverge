export interface Application {
  id: string;
  name: string;
  createdAt: number;
}
export interface Service {
  id: string;
  applicationId: string;
  name: string;
  createdAt: number;
}
export interface Environment {
  id: string;
  name: string;
  createdAt: number;
}
export interface Monitor {
  id: string;
  serviceId: string;
  environmentId: string;
  name: string;
  url: string;
  intervalSeconds: number;
  expectedStatus: number;
  paused: number;
  nextRunAt: number;
  leaseUntil: number;
  leaseId: string | null;
  createdAt: number;
}
export interface Observation {
  id: string;
  monitorId: string;
  checkedAt: number;
  outcome: "up" | "down";
  statusCode: number | null;
  latencyMs: number;
  reason: string;
}
export interface ReleaseRecord {
  id: string;
  serviceId: string;
  environmentId: string;
  transactionId: string;
  version: string;
  sourceCommit: string;
  phase: string;
  failed: number;
  published: number;
  ready: number;
  sourceUpdatedAt: number;
  importedAt: number;
  fingerprint: string;
  events: string;
}
export type IncidentStatus = "open" | "acknowledged" | "resolved";
export interface Incident {
  id: string;
  serviceId: string;
  environmentId: string;
  monitorId: string | null;
  releaseId: string | null;
  title: string;
  status: IncidentStatus;
  owner: string | null;
  createdAt: number;
  resolvedAt: number | null;
}
export interface TimelineEntry {
  id: string;
  incidentId: string;
  kind: string;
  message: string;
  createdAt: number;
}
export interface ProbeResult {
  outcome: "up" | "down";
  statusCode: number | null;
  latencyMs: number;
  reason: string;
}
export class InputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
export function text(value: unknown, field: string, max = 120): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new InputError(
      `${field} must be nonempty text, at most ${max} characters, without control characters.`,
    );
  }
  return value.trim();
}
export function integer(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    throw new InputError(`${field} must be an integer from ${min} to ${max}.`);
  return value;
}
