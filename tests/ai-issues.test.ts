import { describe, expect, it, vi } from "vitest";
import { OPENAI_API_KEY_ENV, type FetchLike } from "../src/ai.js";
import { parseChange } from "../src/changes.js";
import { buildReleasePlan } from "../src/release.js";
import {
  buildAiReleaseNotesPreview,
  reconcileReleaseNotes,
  releaseChangeId,
  releaseNotesFacts,
  releaseNotesRequest,
  type AiReleaseNotesSuggestion
} from "../src/release-assistance.js";
import {
  applyMetadataBlock,
  metadataInferenceRequest,
  reconcileMetadataSuggestion,
  renderMetadataBlock,
  suggestReleaseMetadata
} from "../src/metadata-inference.js";
import type { AiConfig } from "../src/types.js";

const aiConfig: AiConfig = {
  enabled: true,
  provider: "openai",
  model: "test-model",
  timeoutMs: 100,
  releaseNotes: true
};

function plan() {
  return buildReleasePlan({
    currentVersion: "1.0.0",
    date: "2026-08-29",
    changes: [
      parseChange({ title: "feat: add bulk export", source: "pull_request", number: 12 }),
      parseChange({ title: "fix: handle empty exports", source: "commit", sha: "fix-sha" }),
      parseChange({
        title: "feat!: normalize export responses",
        source: "pull_request",
        number: 13,
        body: "<!-- semverge\nmigration: Update clients to read data.items.\n-->"
      }),
      parseChange({ title: "chore: refresh tooling", source: "commit", sha: "internal-sha" })
    ]
  });
}

function validReleaseNotesSuggestion(): AiReleaseNotesSuggestion {
  const releasePlan = plan();
  const facts = releaseNotesFacts(releasePlan);
  return {
    version: facts.version,
    bump: facts.bump,
    channel: facts.channel,
    promotion: facts.promotion,
    summary: "Teams can work with exports more easily in this release.",
    highlights: facts.changes
      .filter((change) => change.customerFacing)
      .map((change) => ({ changeId: change.id!, impact: change.impact!, text: `Customer outcome for ${change.id}.` })),
    migrationRequired: facts.migrationRequired,
    migrationNotes: facts.changes
      .filter((change) => change.migrationRequired)
      .map((change) => ({ changeId: change.id!, text: "Review the required upgrade action." })),
    breakingChangeIds: facts.changes.filter((change) => change.breaking).map((change) => change.id!)
  };
}

function successfulFetch(content: string) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
}

describe("AI release safety and issue coverage", () => {
  it("sends immutable release facts, preserves internal boundaries, and supports bounded tone controls", () => {
    const request = releaseNotesRequest(plan(), { tone: "friendly", verbosity: "concise" });
    expect(request.input.release).toMatchObject({
      version: "2.0.0",
      previousVersion: "1.0.0",
      bump: "major",
      channel: "stable",
      promotion: false,
      migrationRequired: true
    });
    expect(request.input.release.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pr:12", customerFacing: true, impact: "new" }),
      expect.objectContaining({ id: "commit:internal-sha", customerFacing: false, title: "[internal change omitted]" })
    ]));
    expect(request.instructions).toContain("friendly");
    expect(request.instructions).toContain("concise");
    expect(JSON.stringify(request.input)).not.toContain("refresh tooling");
  });

  it("accepts only a complete reconciled release-notes draft", () => {
    const releasePlan = plan();
    const valid = reconcileReleaseNotes(releasePlan, validReleaseNotesSuggestion());
    expect(valid).toMatchObject({ accepted: true, status: "accepted", violations: [] });

    const hallucinated = validReleaseNotesSuggestion();
    hallucinated.highlights.push({ changeId: "pr:999", impact: "new", text: "Invented capability." });
    const rejected = reconcileReleaseNotes(releasePlan, hallucinated);
    expect(rejected.accepted).toBe(false);
    expect(rejected.violations.join(" ")).toContain("unknown change");

    const missingBreaking = validReleaseNotesSuggestion();
    missingBreaking.breakingChangeIds = [];
    const missingWarning = reconcileReleaseNotes(releasePlan, missingBreaking);
    expect(missingWarning.accepted).toBe(false);
    expect(missingWarning.violations.join(" ")).toContain("breaking-change ids");
  });

  it("uses the deterministic release notes on malformed, unavailable, or non-customer paths", async () => {
    const releasePlan = plan();
    const generated = await buildAiReleaseNotesPreview(releasePlan, aiConfig, {
      env: { [OPENAI_API_KEY_ENV]: "test-key" },
      fetchImpl: successfulFetch(JSON.stringify(validReleaseNotesSuggestion()))
    });
    expect(generated).toMatchObject({ status: "generated", suggestion: validReleaseNotesSuggestion() });
    expect(generated.rendered).toContain("## Action required");
    expect(generated.rendered).toContain("Update clients to read data.items.");

    const unavailable = await buildAiReleaseNotesPreview(releasePlan, aiConfig, { env: {} });
    expect(unavailable).toMatchObject({ status: "unavailable", reason: "configuration", deterministic: releasePlan.customerNotes });

    const internalOnly = buildReleasePlan({
      currentVersion: "1.0.0",
      changes: [parseChange({ title: "chore: refresh tooling", source: "commit" })]
    });
    await expect(buildAiReleaseNotesPreview(internalOnly, aiConfig, {
      env: { [OPENAI_API_KEY_ENV]: "test-key" },
      fetchImpl: successfulFetch("never-called")
    })).resolves.toMatchObject({ status: "not-applicable" });
  });

  it("redacts secret-like PR context and excludes unsafe file paths", () => {
    const request = metadataInferenceRequest({
      title: "feat: improve exports",
      body: "Please use token=super-secret-value, password=another-secret, and \"apiKey\": \"json-secret\".",
      labels: ["ship:feature"],
      files: ["src/export.ts", "../outside.ts", ".env", "dist/generated.js", "assets/logo.png"]
    });
    const serialized = JSON.stringify(request.input);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).not.toContain("json-secret");
    expect(request.input.context?.files).toEqual(["src/export.ts"]);
    expect(request.input.context?.categories).toEqual(expect.arrayContaining(["pull-request-title", "pull-request-body", "labels", "file-paths"]));
  });

  it("covers feature, fix, breaking, docs, and internal inference facts", () => {
    const cases = [
      { title: "feat: add bulk export", kind: "feature", bump: "minor", customerFacing: true, breaking: false },
      { title: "fix: handle empty exports", kind: "fix", bump: "patch", customerFacing: true, breaking: false },
      { title: "feat!: normalize export responses", kind: "feature", bump: "major", customerFacing: true, breaking: true },
      { title: "docs: explain export limits", kind: "docs", bump: "none", customerFacing: false, breaking: false },
      { title: "chore: refresh release tooling", kind: "internal", bump: "none", customerFacing: false, breaking: false }
    ] as const;

    for (const testCase of cases) {
      const request = metadataInferenceRequest({ title: testCase.title });
      expect(request.input.release.bump).toBe(testCase.bump);
      expect(request.input.release.changes[0]).toMatchObject({
        kind: testCase.kind,
        customerFacing: testCase.customerFacing,
        breaking: testCase.breaking
      });
    }
  });

  it("rejects metadata provider failures and malformed responses cleanly", async () => {
    const input = { title: "fix: handle empty exports" };
    await expect(suggestReleaseMetadata(input, aiConfig, { env: {} }))
      .rejects.toMatchObject({ kind: "configuration" });

    const malformed = successfulFetch(JSON.stringify({ metadata: {}, confidence: "low", ambiguity: [] }));
    await expect(suggestReleaseMetadata(input, aiConfig, {
      env: { [OPENAI_API_KEY_ENV]: "test-key" },
      fetchImpl: malformed
    })).rejects.toMatchObject({ kind: "malformed-output" });
  });

  it("keeps metadata inference advisory, deterministic, and explicitly applicable", async () => {
    const input = { title: "Improve export workflow", body: "Teams can export several projects together." };
    const suggestion = {
      metadata: {
        type: "feature",
        customer: "",
        headline: "Bulk exports",
        outcome: "Teams can export several projects together.",
        detail: "",
        impact: "new",
        action: "",
        migration: "",
        breaking: false
      },
      confidence: "medium",
      ambiguity: ["The title did not use a conventional commit prefix."]
    };
    const fetchImpl = successfulFetch(JSON.stringify(suggestion));
    const result = await suggestReleaseMetadata(input, { ...aiConfig, releaseNotes: false }, {
      env: { [OPENAI_API_KEY_ENV]: "test-key" },
      fetchImpl
    });
    expect(result).toEqual(suggestion);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const conflict = reconcileMetadataSuggestion({ title: "feat: export", body: "<!-- semverge\ntype: fix\n-->" }, suggestion);
    expect(conflict.accepted).toBe(false);
    expect(conflict.violations.join(" ")).toContain("explicit type");

    const block = renderMetadataBlock(suggestion.metadata);
    expect(block).toContain("type: feature");
    expect(applyMetadataBlock("Existing PR body.", suggestion.metadata)).toContain(block);
  });
});
