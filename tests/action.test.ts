import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelBranchAllowed, channelFromBranch, run } from "../src/action.js";
import { parseConfig } from "../src/config.js";

function encoded(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

describe("GitHub Action orchestration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enforces optional channel branch scoping", () => {
    expect(channelBranchAllowed("nightly", "main", "nightly")).toBe(true);
    expect(channelBranchAllowed("main", "main", "nightly")).toBe(false);
    expect(channelBranchAllowed("main", "main")).toBe(true);
    expect(channelBranchAllowed("feature", "main")).toBe(false);
  });

  it("resolves a channel from its source branch", () => {
    const config = parseConfig(`release:\n  channels:\n    nightly:\n      label: ship:nightly\n      prerelease: nightly\n      branch: nightly\n`);
    expect(channelFromBranch(config, "refs/heads/nightly")).toMatchObject({ name: "nightly" });
    expect(channelFromBranch(config, "main")).toBeUndefined();
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
      if (url.hostname === "api.openai.com") {
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            version: "0.2.0",
            bump: "minor",
            channel: "stable",
            promotion: false,
            summary: "Bulk exports are now available for projects.",
            highlights: [{ changeId: "commit:change-sha", impact: "new", text: "Add bulk project exports." }],
            migrationRequired: false,
            migrationNotes: [],
            breakingChangeIds: []
          }) } }]
        }), { status: 200 });
      }
      if (url.pathname.endsWith("/repos/demo/repo")) {
        return new Response(JSON.stringify({ full_name: "demo/repo", name: "repo", owner: { login: "demo" }, default_branch: "main", html_url: "https://github.com/demo/repo" }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", path: ".semverge.yml", sha: "config-sha", encoding: "base64", content: encoded("ai:\n  enabled: true\n  provider: openai\n  model: gpt-test\n  releaseNotes: true\n") }), { status: 200 });
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
      if (url.pathname.endsWith("/commits/head-sha/pulls")) {
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
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "push", GITHUB_SHA: "head-sha", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, "INPUT_GITHUB-TOKEN": "test-token", INPUT_CONFIG: ".semverge.yml", OPENAI_API_KEY: "test-openai-key" })) {
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
    expect(output).toContain("release-channel<<");
    expect(output).toContain("stable");
    expect(output).toContain("release-promotion<<");
    expect(output).toContain("false");
    expect(output).toContain("https://github.com/demo/repo/pull/7");
    const treeRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/git/trees"));
    const treeEntries = (treeRequest?.body?.tree as Array<{ path: string; content: string }> | undefined) ?? [];
    const packageEntry = treeEntries.find((entry) => entry.path === "package.json");
    expect(JSON.parse(packageEntry?.content ?? "{}").version).toBe("0.2.0");
    expect(treeEntries.some((entry) => entry.path === "CHANGELOG.md")).toBe(true);
    expect(requests.some((request) => request.path.split("?")[0]?.endsWith("/commits/head-sha/pulls"))).toBe(true);
    const releasePullRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/pulls"));
    expect(String(releasePullRequest?.body?.body)).toContain("## Release graph");
    expect(String(releasePullRequest?.body?.body)).toContain("## Release files");
    expect(String(releasePullRequest?.body?.body)).toContain("`package.json`");
    expect(String(releasePullRequest?.body?.body)).toContain("## Operator checklist");
    expect(String(releasePullRequest?.body?.body)).toContain("Channel: **stable**");
    expect(String(releasePullRequest?.body?.body)).toContain("direct change: add exports");
    expect(String(releasePullRequest?.body?.body)).toContain("## AI-enhanced customer notes (review draft)");
    expect(String(releasePullRequest?.body?.body)).toContain("Status: **generated**");
    expect(String(releasePullRequest?.body?.body)).toContain("## Deterministic baseline");
    const aiRequest = requests.find((request) => request.path.split("?")[0] === "/v1/chat/completions");
    expect(aiRequest?.body?.model).toBe("gpt-test");
    expect(JSON.stringify(aiRequest?.body)).not.toContain("test-openai-key");
  });

  it("prepares an explicitly selected scheduled channel against its configured branches", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-channel-action-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({}));
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const configContent = `release:\n  channels:\n    nightly:\n      label: ship:nightly\n      prerelease: nightly\n      branch: nightly\n      baseBranch: release/1.x\n      releaseBranch: semverge/release/nightly\n      tagPrefix: nightly-v\n`;

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/repos/demo/repo")) {
        return new Response(JSON.stringify({ full_name: "demo/repo", name: "repo", owner: { login: "demo" }, default_branch: "main", html_url: "https://github.com/demo/repo" }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", path: ".semverge.yml", encoding: "base64", content: encoded(configContent) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/package.json")) {
        return new Response(JSON.stringify({ type: "file", path: "package.json", encoding: "base64", content: encoded(JSON.stringify({ name: "demo", version: "0.1.0" })) }), { status: 200 });
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
      if (url.pathname.endsWith("/commits/change-sha/pulls")) {
        return new Response("[]", { status: 200 });
      }
      if (url.pathname.endsWith("/commits")) {
        return new Response(JSON.stringify([{ sha: "change-sha", commit: { message: "feat: ship nightly", author: { name: "Test", date: "2026-08-04T00:00:00Z" } }, html_url: "https://github.com/demo/repo/commit/change-sha" }]), { status: 200 });
      }
      if (url.pathname.includes("/contents/") && init?.method !== "POST") {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/git/ref/heads/semverge/release/nightly")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/git/trees")) {
        return new Response(JSON.stringify({ sha: "release-tree" }), { status: 201 });
      }
      if (url.pathname.endsWith("/git/refs")) {
        return new Response(JSON.stringify({ ref: "refs/heads/semverge/release/nightly", object: { sha: "release-commit", type: "commit" } }), { status: 201 });
      }
      if (url.pathname.endsWith("/pulls") && init?.method === "POST") {
        return new Response(JSON.stringify({ number: 8, html_url: "https://github.com/demo/repo/pull/8" }), { status: 201 });
      }
      if (url.pathname.endsWith("/pulls")) {
        return new Response("[]", { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({
      GITHUB_API_URL: "https://api.github.test",
      GITHUB_REPOSITORY: "demo/repo",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_SHA: "head-sha",
      GITHUB_REF_NAME: "nightly",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      INPUT_GITHUB_TOKEN: "test-token",
      INPUT_CONFIG: ".semverge.yml",
      INPUT_RELEASE_CHANNEL: "nightly"
    })) {
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

    expect(output).toContain("0.2.0-nightly.0");
    expect(output).toContain("release-channel<<");
    expect(output).toContain("nightly");
    const treeRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/git/trees"));
    const treeEntries = (treeRequest?.body?.tree as Array<{ path: string; content: string }> | undefined) ?? [];
    expect(JSON.parse(treeEntries.find((entry) => entry.path === "package.json")?.content ?? "{}").version).toBe("0.2.0-nightly.0");
    const releasePullRequest = requests.find((request) => request.method === "POST" && request.path.endsWith("/pulls"));
    expect(releasePullRequest?.body).toMatchObject({ head: "semverge/release/nightly", base: "release/1.x" });
    expect(String(releasePullRequest?.body?.title)).toContain("nightly-v0.2.0-nightly.0");
  });

  it("does not prepare a second release when the push already merged a SemVerge release PR", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-merge-push-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main", after: "merge-sha" }));
    const requests: Array<{ method: string; path: string }> = [];

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: init?.method ?? "GET", path: url.pathname });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/repos/demo/repo")) {
        return new Response(JSON.stringify({ full_name: "demo/repo", name: "repo", owner: { login: "demo" }, default_branch: "main", html_url: "https://github.com/demo/repo" }), { status: 200 });
      }
      if (url.pathname.endsWith("/commits/merge-sha/pulls")) {
        return new Response(JSON.stringify([{ number: 7, title: "chore(release): v0.2.0", body: "", html_url: "https://github.com/demo/repo/pull/7", state: "closed", merged_at: "2026-08-04T00:00:00Z", merge_commit_sha: "merge-sha", head: { ref: "semverge/release", sha: "release-sha", repo: { full_name: "demo/repo" } }, base: { ref: "main", sha: "main-sha" }, labels: [] }]), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unexpected ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "push", GITHUB_SHA: "merge-sha", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, INPUT_GITHUB_TOKEN: "test-token", INPUT_CONFIG: ".semverge.yml" })) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      await run();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      rmSync(directory, { recursive: true, force: true });
    }

    expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/git/trees"))).toBe(false);
    expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/pulls"))).toBe(false);
  });
});
