import { createAiInputEnvelope, runOptionalAiFeature, type AiJsonRequest, type OptionalAiFeatureOptions } from "./ai.js";
import type { AiConfig, ReleasePlan } from "./types.js";

export interface ReleaseCommunicationSuggestion {
  summary: string;
  highlights: string[];
  migrationNotes: string[];
}

export const RELEASE_COMMUNICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1 },
    highlights: { type: "array", items: { type: "string" }, maxItems: 8 },
    migrationNotes: { type: "array", items: { type: "string" }, maxItems: 8 }
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
  return runOptionalAiFeature(config, releaseCommunicationRequest(plan), options);
}
