import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/action.js";

function encoded(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

describe("published release post-release verification action", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks expected assets and configured publishing workflows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-health-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({
      action: "published",
      release: { tag_name: "v1.0.0", target_commitish: "merge-sha", published_at: "2026-08-04T00:00:00Z", assets: [{ name: "build.zip" }] }
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("health:\n  enabled: true\n  expectedArtifacts: [build.zip]\n  workflows:\n    - name: Publish package\n      purpose: package\n      required: true\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/releases/tags/v1.0.0")) {
        return new Response(JSON.stringify({ id: 1, tag_name: "v1.0.0", html_url: "https://github.com/demo/repo/releases/tag/v1.0.0", upload_url: "https://uploads.github.com/assets{?name,label}", target_commitish: "merge-sha", published_at: "2026-08-04T00:00:00Z", assets: [{ name: "build.zip" }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [{ id: 4, name: "Publish package", status: "completed", conclusion: "success", head_sha: "merge-sha", html_url: "https://github.com/demo/repo/actions/runs/4", created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:01:00Z" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "release", GITHUB_SHA: "merge-sha", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, INPUT_GITHUB_TOKEN: "test-token", INPUT_CONFIG: ".semverge.yml" })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    let output = "";
    try {
      await run();
      output = readFileSync(outputPath, "utf8");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }
    expect(output).toContain('"status":"healthy"');
    expect(output).toContain("post-release-verification");
  });

  it("records an idempotent delayed-monitoring history comment on the release PR", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-monitor-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({}));
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const comments: string[] = [];
    const checkRuns: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: url.pathname, body });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(`health:
  enabled: true
  monitoring:
    enabled: true
    windowHours: 48
    comment: true
    checkRun: true
`) }), { status: 200 });
      }
      if (url.pathname.endsWith("/releases/tags/v1.0.0")) {
        return new Response(JSON.stringify({ id: 1, tag_name: "v1.0.0", html_url: "https://github.com/demo/repo/releases/tag/v1.0.0", upload_url: "https://uploads.github.com/assets{?name,label}", target_commitish: "merge-sha", published_at: "2026-08-05T00:00:00Z", assets: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/check-runs") && init?.method === "POST") {
        const externalId = typeof body?.external_id === "string" ? body.external_id : "";
        checkRuns.push(externalId);
        return new Response(JSON.stringify({ id: 11, name: body?.name, status: "completed", conclusion: body?.conclusion, external_id: externalId }), { status: 201 });
      }
      if (url.pathname.endsWith("/commits/merge-sha/check-runs")) {
        return new Response(JSON.stringify({ check_runs: checkRuns.map((externalId, index) => ({ id: index + 11, name: "SemVerge delayed monitoring", status: "completed", conclusion: "success", external_id: externalId })) }), { status: 200 });
      }
      if (url.pathname.endsWith("/commits/merge-sha/pulls")) {
        return new Response(JSON.stringify([{ number: 7, title: "chore(release): v1.0.0", body: "", html_url: "https://github.com/demo/repo/pull/7", state: "closed", merged_at: "2026-08-05T00:00:00Z", merge_commit_sha: "merge-sha", head: { ref: "semverge/release", sha: "release-sha", repo: { full_name: "demo/repo" } }, base: { ref: "main", sha: "main-sha" }, labels: [] }]), { status: 200 });
      }
      if (url.pathname.endsWith("/issues/7/comments") && init?.method === "POST") {
        comments.push(typeof body?.body === "string" ? body.body : "");
        return new Response(JSON.stringify({ id: 9, body: body?.body, html_url: "https://github.com/demo/repo/issues/7#issuecomment-9" }), { status: 201 });
      }
      if (url.pathname.endsWith("/issues/7/comments")) {
        return new Response(JSON.stringify(comments.map((body, index) => ({ id: index + 1, body }))), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "schedule", GITHUB_SHA: "merge-sha", GITHUB_RUN_ID: "42", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, INPUT_GITHUB_TOKEN: "test-token", INPUT_CONFIG: ".semverge.yml", INPUT_MONITOR_TAG: "v1.0.0" })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      await run();
      await run();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }

    const comment = requests.find((request) => request.method === "POST" && request.path.endsWith("/issues/7/comments"));
    expect(comment?.body?.body).toContain("<!-- semverge-monitor v1.0.0 42 -->");
    expect(comment?.body?.body).toContain("SemVerge post-release verification");
    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/issues/7/comments"))).toHaveLength(1);
    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/check-runs"))).toHaveLength(1);
  });
});
