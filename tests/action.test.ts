import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/action.js";

function encoded(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

describe("GitHub Action orchestration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a release branch and PR from a zero-config push", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-action-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main", after: "head-sha" }));
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/repos/demo/repo")) {
        return new Response(JSON.stringify({ full_name: "demo/repo", name: "repo", owner: { login: "demo" }, default_branch: "main", html_url: "https://github.com/demo/repo" }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/package.json")) {
        return new Response(JSON.stringify({ type: "file", path: "package.json", sha: "package-sha", encoding: "base64", content: encoded(JSON.stringify({ name: "demo", version: "0.1.0" })) }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/commits/head-sha")) {
        return new Response(JSON.stringify({ sha: "head-sha", tree: { sha: "tree-sha" } }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/trees/tree-sha")) {
        return new Response(JSON.stringify({ tree: [{ path: "package.json", type: "blob", sha: "package-sha" }], truncated: false }), { status: 200 });
      }
      if (url.pathname.endsWith("/tags")) {
        return new Response("[]", { status: 200 });
      }
      if (url.pathname.endsWith("/git/commits") && init?.method === "POST") {
        return new Response(JSON.stringify({ sha: "release-commit" }), { status: 201 });
      }
      if (url.pathname.endsWith("/commits")) {
        return new Response(JSON.stringify([{ sha: "change-sha", commit: { message: "feat: add exports", author: { name: "Test", date: "2026-08-04T00:00:00Z" } }, html_url: "https://github.com/demo/repo/commit/change-sha" }]), { status: 200 });
      }
      if (url.pathname.endsWith("/commits/change-sha/pulls")) {
        return new Response("[]", { status: 200 });
      }
      if (url.pathname.includes("/contents/") && init?.method !== "POST") {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/git/ref/heads/semverge/release")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/git/trees")) {
        return new Response(JSON.stringify({ sha: "release-tree" }), { status: 201 });
      }
      if (url.pathname.endsWith("/git/refs")) {
        return new Response(JSON.stringify({ ref: "refs/heads/semverge/release", object: { sha: "release-commit", type: "commit" } }), { status: 201 });
      }
      if (url.pathname.endsWith("/pulls") && init?.method === "POST") {
        return new Response(JSON.stringify({ number: 7, html_url: "https://github.com/demo/repo/pull/7" }), { status: 201 });
      }
      if (url.pathname.endsWith("/pulls")) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "push", GITHUB_SHA: "head-sha", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, INPUT_GITHUB_TOKEN: "test-token", INPUT_CONFIG: ".semverge.yml" })) {
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

    expect(output).toContain("version<<");
    expect(output).toContain("0.2.0");
    expect(output).toContain("https://github.com/demo/repo/pull/7");
    const treeRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/git/trees"));
    const treeEntries = (treeRequest?.body?.tree as Array<{ path: string; content: string }> | undefined) ?? [];
    const packageEntry = treeEntries.find((entry) => entry.path === "package.json");
    expect(JSON.parse(packageEntry?.content ?? "{}").version).toBe("0.2.0");
    expect(treeEntries.some((entry) => entry.path === "CHANGELOG.md")).toBe(true);
  });
});
