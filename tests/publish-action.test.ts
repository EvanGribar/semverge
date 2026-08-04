import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/action.js";

function encoded(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

describe("merged release publication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a tag and GitHub release from the merged release PR", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-publish-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({
      action: "closed",
      pull_request: {
        number: 7,
        title: "chore(release): v0.2.0",
        body: "",
        html_url: "https://github.com/demo/repo/pull/7",
        state: "closed",
        merged: true,
        merged_at: "2026-08-04T00:00:00Z",
        merge_commit_sha: "merge-sha",
        head: { ref: "release/bot", sha: "release-sha", repo: { full_name: "demo/repo" } },
        base: { ref: "main", sha: "main-sha" },
        labels: []
      }
    }));
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("release:\n  branch: release/bot\nhealth:\n  enabled: false\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(JSON.stringify({ schemaVersion: 2, mode: "single", version: "0.2.0", readiness: { passed: true }, packages: [{ id: "demo", name: "demo", directory: "", version: "0.2.0", customerNotes: "RELEASE_NOTES.md" }] })) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/RELEASE_NOTES.md")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("# What's new\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/ref/tags/v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/git/refs") && init?.method === "POST") {
        return new Response(JSON.stringify({ ref: "refs/tags/v0.2.0", object: { sha: "merge-sha", type: "commit" } }), { status: 201 });
      }
      if (url.pathname.endsWith("/releases/tags/v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: 3, tag_name: "v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", assets: [] }), { status: 201 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: "merge-sha", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, INPUT_GITHUB_TOKEN: "test-token", INPUT_CONFIG: ".semverge.yml" })) {
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

    expect(output).toContain("0.2.0");
    expect(output).toContain("https://github.com/demo/repo/releases/tag/v0.2.0");
    const tagRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/git/refs"));
    expect(tagRequest?.body).toMatchObject({ ref: "refs/tags/v0.2.0", sha: "merge-sha" });
    const releaseRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/releases"));
    expect(releaseRequest?.body).toMatchObject({ tag_name: "v0.2.0", target_commitish: "merge-sha" });
  });
});
