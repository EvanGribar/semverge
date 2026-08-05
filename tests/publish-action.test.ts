import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/action.js";
import { parseReleaseTransactionBody } from "../src/transaction.js";

const npmVersionExistsMock = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../src/npm.js", () => ({ npmVersionExists: npmVersionExistsMock }));

const retryFixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "node-retry");
const retryFixtureConfig = join(retryFixtureDirectory, ".semverge.yml");

function encoded(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

function publishEvent(directory: string, mergeSha = "merge-sha"): string {
  const eventPath = join(directory, "event.json");
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
      merge_commit_sha: mergeSha,
      head: { ref: "release/bot", sha: "release-sha", repo: { full_name: "demo/repo" } },
      base: { ref: "main", sha: "main-sha" },
      labels: []
    }
  }));
  return eventPath;
}

function setPublishEnvironment(directory: string, eventPath: string, outputPath: string, workspace = directory, mergeSha = "merge-sha"): Map<string, string | undefined> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({
    GITHUB_API_URL: "https://api.github.test",
    GITHUB_REPOSITORY: "demo/repo",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: mergeSha,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: outputPath,
    GITHUB_WORKSPACE: workspace,
    INPUT_GITHUB_TOKEN: "test-token",
    INPUT_CONFIG: ".semverge.yml"
  })) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return previous;
}

function restoreEnvironment(previous: Map<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

function manifest(): string {
  return JSON.stringify({
    schemaVersion: 2,
    mode: "single",
    version: "0.2.0",
    readiness: { passed: true },
    packages: [{ id: "demo", name: "demo", directory: "", version: "0.2.0", customerNotes: "RELEASE_NOTES.md" }]
  });
}

function prepareGitWorkspace(source: string): { directory: string; mergeSha: string } {
  const directory = mkdtempSync(join(tmpdir(), "semverge-workspace-"));
  cpSync(source, directory, { recursive: true });
  execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "SemVerge Test"], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: directory, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: directory, stdio: "ignore" });
  const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
  return { directory, mergeSha };
}

describe("merged release publication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    npmVersionExistsMock.mockReset();
    npmVersionExistsMock.mockResolvedValue(false);
  });

  it("builds before creating a draft and publishes only after the transaction is ready", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-publish-"));
    const eventPath = publishEvent(directory);
    writeFileSync(join(directory, "artifact.txt"), "artifact");
    execFileSync("git", ["init"], { cwd: directory, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: directory, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "SemVerge Test"], { cwd: directory, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: directory, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: directory, stdio: "ignore" });
    const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
    publishEvent(directory, mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const artifactDigest = createHash("sha256").update("artifact").digest("hex");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("release:\n  branch: release/bot\nhealth:\n  enabled: true\nartifacts:\n  paths:\n    - artifact.txt\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest()) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/RELEASE_NOTES.md")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("# What's new\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/ref/tags/v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases/tags/v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/releases") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: 3, tag_name: "v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", body: body?.body, draft: true, assets: [] }), { status: 201 });
      }
      if (url.pathname.endsWith("/releases/3") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: 3, tag_name: "v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", body: body?.body, draft: body?.draft ?? true, assets: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/assets") && init?.method === "POST") {
        return new Response(JSON.stringify({ name: "artifact.txt" }), { status: 201 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = setPublishEnvironment(directory, eventPath, outputPath, directory, mergeSha);
    let output = "";
    try {
      await run();
      output = readFileSync(outputPath, "utf8");
    } finally {
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
    }

    const createIndex = requests.findIndex((request) => request.method === "POST" && request.path.endsWith("/releases"));
    const finalizeIndex = requests.findIndex((request) => request.method === "PATCH" && request.path.endsWith("/releases/3") && request.body?.draft === false);
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(finalizeIndex).toBeGreaterThan(createIndex);
    expect(requests[createIndex]?.body).toMatchObject({ draft: true, tag_name: "v0.2.0" });
    expect(requests[finalizeIndex]?.body?.tag_name).toBe("v0.2.0");
    expect(requests[createIndex]?.body?.body).toContain("semverge-progress");
    expect(String(requests[createIndex]?.body?.body)).toContain(`Artifact \`artifact.txt\`: \`${artifactDigest}\``);
    expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/git/refs"))).toBe(false);
    expect(requests.some((request) => request.path.endsWith(`/actions/runs?head_sha=${mergeSha}&per_page=100&page=1`))).toBe(true);
    expect(output).toContain("post-release-verification");
    expect(output).toContain('"phase":"completed"');
    expect(output).toContain("https://github.com/demo/repo/releases/tag/v0.2.0");
  });

  it("does not create a tag or draft release when the artifact build fails", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-build-failure-"));
    const eventPath = publishEvent(directory);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: init?.method ?? "GET", path: url.pathname });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("release:\n  branch: release/bot\nhealth:\n  enabled: false\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest()) }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Unexpected request" }), { status: 500 });
    }));

    const previous = setPublishEnvironment(directory, eventPath, outputPath);
    const previousArtifactCommand = process.env.INPUT_ARTIFACT_COMMAND;
    process.env.INPUT_ARTIFACT_COMMAND = "node -e \"process.exit(1)\"";
    try {
      await expect(run()).rejects.toThrow();
    } finally {
      if (previousArtifactCommand === undefined) delete process.env.INPUT_ARTIFACT_COMMAND; else process.env.INPUT_ARTIFACT_COMMAND = previousArtifactCommand;
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
    }

    expect(requests.some((request) => request.method === "POST" && (request.path.endsWith("/releases") || request.path.endsWith("/git/refs")))).toBe(false);
  });

  it("resumes a draft release without recreating it after a package publish failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-retry-"));
    const workspace = prepareGitWorkspace(retryFixtureDirectory);
    const eventPath = publishEvent(directory, workspace.mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let release: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(readFileSync(retryFixtureConfig, "utf8")) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest()) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/RELEASE_NOTES.md")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("# What's new\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/ref/tags/v0.2.0")) {
        return release ? new Response(JSON.stringify({ ref: "refs/tags/v0.2.0", object: { sha: workspace.mergeSha, type: "commit" } }), { status: 200 }) : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases/tags/v0.2.0")) {
        return release ? new Response(JSON.stringify(release), { status: 200 }) : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases") && init?.method === "POST") {
        release = { id: 3, tag_name: "v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", body: body?.body, draft: true, assets: [] };
        return new Response(JSON.stringify(release), { status: 201 });
      }
      if (url.pathname.endsWith("/releases/3") && init?.method === "PATCH") {
        release = { ...release, body: body?.body, draft: body?.draft ?? release?.draft ?? true };
        return new Response(JSON.stringify(release), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = setPublishEnvironment(directory, eventPath, outputPath, workspace.directory, workspace.mergeSha);
    const previousRetry = process.env.SEMVERGE_RETRY;
    delete process.env.SEMVERGE_RETRY;
    try {
      await expect(run()).rejects.toThrow();
      process.env.SEMVERGE_RETRY = "true";
      await run();
    } finally {
      if (previousRetry === undefined) delete process.env.SEMVERGE_RETRY; else process.env.SEMVERGE_RETRY = previousRetry;
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
      rmSync(workspace.directory, { recursive: true, force: true });
    }

    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/releases"))).toHaveLength(1);
    expect(requests.some((request) => request.method === "PATCH" && request.path.endsWith("/releases/3") && request.body?.draft === false)).toBe(true);
  });

  it("treats a registry-confirmed version as published without rerunning the npm command", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-registry-retry-"));
    const workspace = prepareGitWorkspace(retryFixtureDirectory);
    rmSync(join(workspace.directory, ".semverge.yml"));
    const eventPath = publishEvent(directory, workspace.mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let release: Record<string, unknown> | null = null;
    const config = "release:\n  branch: release/bot\nhealth:\n  enabled: false\npublishing:\n  npm:\n    enabled: true\n    command: node scripts/publish-fixture.cjs\n    idempotency: registry\n";
    npmVersionExistsMock.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(config) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest()) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/RELEASE_NOTES.md")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("# What's new\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/ref/tags/v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases/tags/v0.2.0")) {
        return release ? new Response(JSON.stringify(release), { status: 200 }) : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases") && init?.method === "POST") {
        release = { id: 3, tag_name: "v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", body: body?.body, draft: true, assets: [] };
        return new Response(JSON.stringify(release), { status: 201 });
      }
      if (url.pathname.endsWith("/releases/3") && init?.method === "PATCH") {
        release = { ...release, body: body?.body, draft: body?.draft ?? release?.draft ?? true };
        return new Response(JSON.stringify(release), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = setPublishEnvironment(directory, eventPath, outputPath, workspace.directory, workspace.mergeSha);
    const previousRetry = process.env.SEMVERGE_RETRY;
    delete process.env.SEMVERGE_RETRY;
    try {
      await run();
    } finally {
      if (previousRetry === undefined) delete process.env.SEMVERGE_RETRY; else process.env.SEMVERGE_RETRY = previousRetry;
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
      rmSync(workspace.directory, { recursive: true, force: true });
    }

    expect(npmVersionExistsMock).toHaveBeenCalledWith("demo", "0.2.0", workspace.directory);
    expect(requests.some((request) => request.method === "PATCH" && request.path.endsWith("/releases/3") && request.body?.draft === false)).toBe(true);
    const finalBody = requests.filter((request) => request.method === "PATCH" && request.path.endsWith("/releases/3")).at(-1)?.body?.body;
    expect(parseReleaseTransactionBody(typeof finalBody === "string" ? finalBody : null)?.phase).toBe("completed");
  });
});
