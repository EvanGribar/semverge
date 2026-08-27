import { describe, expect, it, vi } from "vitest";
import { OPENAI_API_KEY_ENV, OPENAI_CHAT_COMPLETIONS_ENDPOINT, createAiProvider, type FetchLike } from "../src/ai.js";
import { parseChange } from "../src/changes.js";
import { parseConfig } from "../src/config.js";
import { releaseCommunicationRequest, suggestReleaseCommunication } from "../src/release-assistance.js";
import { buildReleasePlan } from "../src/release.js";
import type { AiConfig } from "../src/types.js";

const config: AiConfig = {
  enabled: true,
  provider: "openai",
  model: "test-model",
  timeoutMs: 100
};

function releasePlan() {
  return buildReleasePlan({
    currentVersion: "1.0.0",
    date: "2026-08-27",
    changes: [parseChange({ title: "feat: add bulk export", source: "commit" })]
  });
}

function successfulFetch(content: string) {
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));
}

describe("optional BYOK AI provider layer", () => {
  it("keeps the default disabled path local and request-free", async () => {
    const fetchImpl = successfulFetch("{}");
    expect(parseConfig("").ai).toEqual({ enabled: false, provider: "openai", model: "", timeoutMs: 10_000 });
    await expect(suggestReleaseCommunication(releasePlan(), { ...config, enabled: false }, { env: {}, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses explicit provider configuration without making it part of release planning", () => {
    const parsed = parseConfig(`ai:
  enabled: true
  provider: openai
  model: test-model
  timeoutMs: 2500
`);
    expect(parsed.ai).toEqual({ enabled: true, provider: "openai", model: "test-model", timeoutMs: 2500 });
    expect(releasePlan()).toMatchObject({ version: "1.1.0", bump: "minor" });
  });

  it("requires the user-supplied API key only when the provider is enabled", () => {
    const fetchImpl = successfulFetch("{}");
    expect(() => createAiProvider(config, {}, { fetchImpl })).toThrow(`${OPENAI_API_KEY_ENV} is not set`);
    expect(createAiProvider({ ...config, enabled: false }, {}, { fetchImpl })).toBeNull();
  });

  it("sends the documented minimal envelope and validates a successful JSON response", async () => {
    const fetchImpl = successfulFetch(JSON.stringify({
      summary: "Bulk export is now available.",
      highlights: ["Export multiple projects in one operation."],
      migrationNotes: []
    }));
    const result = await suggestReleaseCommunication(releasePlan(), config, {
      env: { [OPENAI_API_KEY_ENV]: "test-secret" },
      fetchImpl
    });

    expect(result).toEqual({
      summary: "Bulk export is now available.",
      highlights: ["Export multiple projects in one operation."],
      migrationNotes: []
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(OPENAI_CHAT_COMPLETIONS_ENDPOINT);
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer test-secret"
    });
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    expect(body.model).toBe("test-model");
    expect(body.response_format).toMatchObject({ type: "json_schema" });
    const input = JSON.parse(body.messages[1].content) as Record<string, any>;
    expect(input).toEqual({
      schemaVersion: 1,
      feature: "release-communication",
      release: {
        version: "1.1.0",
        previousVersion: "1.0.0",
        bump: "minor",
        channel: "stable",
        changes: [{ kind: "feature", title: "feat: add bulk export", summary: "add bulk export", breaking: false }]
      }
    });
    expect(String(init?.body)).not.toContain("test-secret");
    expect(String(init?.body)).not.toContain("OPENAI_API_KEY");
  });

  it("falls back at the feature boundary for missing credentials", async () => {
    const result = await suggestReleaseCommunication(releasePlan(), config, {
      env: {},
      fallback: (error) => {
        expect(error.kind).toBe("configuration");
        expect(error.message).toContain(OPENAI_API_KEY_ENV);
        return { summary: "deterministic fallback", highlights: [], migrationNotes: [] };
      }
    });
    expect(result).toEqual({ summary: "deterministic fallback", highlights: [], migrationNotes: [] });
  });

  it("reports malformed model JSON and schema mismatches", async () => {
    const malformed = successfulFetch("not-json");
    await expect(suggestReleaseCommunication(releasePlan(), config, { env: { [OPENAI_API_KEY_ENV]: "test" }, fetchImpl: malformed }))
      .rejects.toMatchObject({ kind: "malformed-output" });

    const wrongShape = successfulFetch(JSON.stringify({ summary: 42, highlights: [], migrationNotes: [] }));
    await expect(suggestReleaseCommunication(releasePlan(), config, { env: { [OPENAI_API_KEY_ENV]: "test" }, fetchImpl: wrongShape }))
      .rejects.toMatchObject({ kind: "malformed-output" });
  });

  it("enforces timeout and caller cancellation without leaking provider errors into the plan", async () => {
    const slowFetch = vi.fn<FetchLike>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    await expect(suggestReleaseCommunication(releasePlan(), { ...config, timeoutMs: 10 }, {
      env: { [OPENAI_API_KEY_ENV]: "test" },
      fetchImpl: slowFetch
    })).rejects.toMatchObject({ kind: "timeout" });

    const controller = new AbortController();
    const cancellableFetch = vi.fn<FetchLike>(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const pending = suggestReleaseCommunication(releasePlan(), config, {
      env: { [OPENAI_API_KEY_ENV]: "test" },
      fetchImpl: cancellableFetch,
      signal: controller.signal
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("surfaces provider failures clearly when no feature fallback is supplied", async () => {
    const failed = vi.fn<FetchLike>(async () => new Response(JSON.stringify({ error: { message: "model unavailable" } }), { status: 503 }));
    await expect(suggestReleaseCommunication(releasePlan(), config, { env: { [OPENAI_API_KEY_ENV]: "test" }, fetchImpl: failed }))
      .rejects.toMatchObject({ kind: "provider", message: expect.stringContaining("HTTP 503") });
  });

  it("builds the provider request from release facts rather than source files", () => {
    const request = releaseCommunicationRequest(releasePlan());
    expect(request.input).toEqual(expect.objectContaining({ schemaVersion: 1, feature: "release-communication" }));
    expect(request.input).not.toHaveProperty("source");
    expect(request.input).not.toHaveProperty("files");
    expect(request.input).not.toHaveProperty("config");
  });
});
