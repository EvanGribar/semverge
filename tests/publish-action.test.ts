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
vi.mock("../src/npm.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/npm.js")>()),
  npmVersionExists: npmVersionExistsMock
}));

const registryVersionExistsMock = vi.hoisted(() => vi.fn(async () => false));
const ociImageVersionExistsMock = vi.hoisted(() => vi.fn(async () => false));
const ociImageVersionDigestMock = vi.hoisted(() => vi.fn(async () => null));
vi.mock("../src/registries.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/registries.js")>()),
  registryVersionExists: registryVersionExistsMock,
  ociImageVersionExists: ociImageVersionExistsMock,
  ociImageVersionDigest: ociImageVersionDigestMock
}));

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

function manifest(ecosystem?: "node" | "python" | "rust", channel = "stable"): string {
  return JSON.stringify({
    schemaVersion: 2,
    mode: "single",
    version: "0.2.0",
    ...(channel ? { channel } : {}),
    readiness: { passed: true },
    packages: [{ id: "demo", name: "demo", directory: "", version: "0.2.0", ...(ecosystem ? { ecosystem } : {}), customerNotes: "RELEASE_NOTES.md" }]
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
    registryVersionExistsMock.mockReset();
    registryVersionExistsMock.mockResolvedValue(false);
    ociImageVersionExistsMock.mockReset();
    ociImageVersionExistsMock.mockResolvedValue(false);
    ociImageVersionDigestMock.mockReset();
    ociImageVersionDigestMock.mockResolvedValue(null);
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
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("release:\n  branch: release/bot\n  channels:\n    nightly:\n      label: ship:nightly\n      prerelease: nightly\n      tagPrefix: nightly-v\nhealth:\n  enabled: true\nartifacts:\n  paths:\n    - artifact.txt\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest(undefined, "nightly")) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/RELEASE_NOTES.md")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("# What's new\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/ref/tags/nightly-v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/releases/tags/nightly-v0.2.0")) {
        return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      if (url.pathname.endsWith("/releases") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: 3, tag_name: "nightly-v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/nightly-v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", body: body?.body, draft: true, assets: [] }), { status: 201 });
      }
      if (url.pathname.endsWith("/releases/3") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: 3, tag_name: "nightly-v0.2.0", html_url: "https://github.com/demo/repo/releases/tag/nightly-v0.2.0", upload_url: "https://uploads.github.com/repos/demo/repo/releases/3/assets{?name,label}", body: body?.body, draft: body?.draft ?? true, assets: [] }), { status: 200 });
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
    expect(requests[createIndex]?.body).toMatchObject({ draft: true, tag_name: "nightly-v0.2.0" });
    expect(requests[finalizeIndex]?.body?.tag_name).toBe("nightly-v0.2.0");
    expect(requests[createIndex]?.body?.body).toContain("semverge-progress");
    expect(String(requests[createIndex]?.body?.body)).toContain(`Artifact \`artifact.txt\`: \`${artifactDigest}\``);
    expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/git/refs"))).toBe(false);
    expect(requests.some((request) => request.path.endsWith(`/actions/runs?head_sha=${mergeSha}&per_page=100&page=1`))).toBe(true);
    expect(output).toContain("post-release-verification");
    expect(output).toContain('"phase":"completed"');
    expect(output).toContain("https://github.com/demo/repo/releases/tag/nightly-v0.2.0");
  });

  it("publishes a Python package through its configured registry adapter", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-python-publish-"));
    const workspace = prepareGitWorkspace(retryFixtureDirectory);
    const config = `release:
  branch: release/bot
health:
  enabled: false
publishing:
  python:
    enabled: true
    command: node -e "process.stdout.write('python-published')"
    idempotency: declared
`;
    writeFileSync(join(workspace.directory, ".semverge.yml"), config);
    execFileSync("git", ["add", ".semverge.yml"], { cwd: workspace.directory, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "enable Python publishing"], { cwd: workspace.directory, stdio: "ignore" });
    const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace.directory, encoding: "utf8" }).trim();
    const eventPath = publishEvent(directory, mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let release: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", path: `${url.pathname}${url.search}`, body });
      if (url.pathname.endsWith("/contents/.semverge.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(config) }), { status: 200 });
      }
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest("python")) }), { status: 200 });
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

    const previous = setPublishEnvironment(directory, eventPath, outputPath, workspace.directory, mergeSha);
    try {
      await run();
    } finally {
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
      rmSync(workspace.directory, { recursive: true, force: true });
    }

    expect(npmVersionExistsMock).not.toHaveBeenCalled();
    expect(registryVersionExistsMock).not.toHaveBeenCalled();
    expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/releases"))).toBe(true);
    const finalBody = requests.filter((request) => request.method === "PATCH" && request.path.endsWith("/releases/3")).at(-1)?.body?.body;
    const state = parseReleaseTransactionBody(typeof finalBody === "string" ? finalBody : null);
    expect(state?.publishingTargets).toEqual(["python"]);
    expect(state?.publishedPackages).toEqual(["demo"]);
  });

  it("publishes a declared OCI image target and records durable image progress", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-oci-publish-"));
    const workspace = prepareGitWorkspace(retryFixtureDirectory);
    const config = `release:
  branch: release/bot
health:
  enabled: false
publishing:
  oci:
    enabled: true
    images:
      - ghcr.io/acme/semverge
    command: node -e "process.stdout.write('oci-published')"
    idempotency: declared
`;
    writeFileSync(join(workspace.directory, ".semverge.yml"), config);
    execFileSync("git", ["add", ".semverge.yml"], { cwd: workspace.directory, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "enable OCI publishing"], { cwd: workspace.directory, stdio: "ignore" });
    const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace.directory, encoding: "utf8" }).trim();
    const eventPath = publishEvent(directory, mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let release: Record<string, unknown> | null = null;
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

    const previous = setPublishEnvironment(directory, eventPath, outputPath, workspace.directory, mergeSha);
    const previousFailure = process.env.SEMVERGE_TEST_FAILURE;
    try {
      process.env.SEMVERGE_TEST_FAILURE = "oci-publish";
      await expect(run()).rejects.toThrow("Injected SemVerge test failure at oci-publish.");
      delete process.env.SEMVERGE_TEST_FAILURE;
      await run();
    } finally {
      if (previousFailure === undefined) delete process.env.SEMVERGE_TEST_FAILURE; else process.env.SEMVERGE_TEST_FAILURE = previousFailure;
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
      rmSync(workspace.directory, { recursive: true, force: true });
    }

    expect(ociImageVersionExistsMock).not.toHaveBeenCalled();
    const finalBody = requests.filter((request) => request.method === "PATCH" && request.path.endsWith("/releases/3")).at(-1)?.body?.body;
    const state = parseReleaseTransactionBody(typeof finalBody === "string" ? finalBody : null);
    expect(state?.publishingTargets).toEqual(["oci:ghcr.io/acme/semverge"]);
    expect(state?.ociImages).toEqual(["ghcr.io/acme/semverge"]);
    expect(state?.publishedOciImages).toEqual(["ghcr.io/acme/semverge"]);
    expect(state?.events.some((event) => event.key === "oci:ghcr.io/acme/semverge" && event.status === "failed")).toBe(true);
    expect(state?.events.filter((event) => event.key === "oci:ghcr.io/acme/semverge" && event.status === "completed")).toHaveLength(1);
    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/releases"))).toHaveLength(1);
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

  it("uses injected asset failure to verify retry-safe transaction recovery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-asset-failure-"));
    const config = "release:\n  branch: release/bot\nhealth:\n  enabled: false\nartifacts:\n  paths:\n    - artifact.txt\n";
    const workspace = prepareGitWorkspace(retryFixtureDirectory);
    writeFileSync(join(workspace.directory, ".semverge.yml"), config);
    writeFileSync(join(workspace.directory, "artifact.txt"), "artifact");
    execFileSync("git", ["add", ".semverge.yml", "artifact.txt"], { cwd: workspace.directory, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "artifact"], { cwd: workspace.directory, stdio: "ignore" });
    const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace.directory, encoding: "utf8" }).trim();
    const eventPath = publishEvent(directory, mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let release: Record<string, unknown> | null = null;
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
      if (url.pathname.endsWith("/assets") && init?.method === "POST") {
        return new Response(JSON.stringify({ name: "artifact.txt" }), { status: 201 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = setPublishEnvironment(directory, eventPath, outputPath, workspace.directory, mergeSha);
    const previousFailure = process.env.SEMVERGE_TEST_FAILURE;
    try {
      process.env.SEMVERGE_TEST_FAILURE = "asset-upload";
      await expect(run()).rejects.toThrow("Injected SemVerge test failure at asset-upload.");
      delete process.env.SEMVERGE_TEST_FAILURE;
      await run();
    } finally {
      if (previousFailure === undefined) delete process.env.SEMVERGE_TEST_FAILURE; else process.env.SEMVERGE_TEST_FAILURE = previousFailure;
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
      rmSync(workspace.directory, { recursive: true, force: true });
    }

    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/releases"))).toHaveLength(1);
    expect(requests.filter((request) => request.method === "POST" && request.path.split("?")[0]?.endsWith("/assets"))).toHaveLength(1);
    expect(requests.some((request) => request.method === "PATCH" && request.path.endsWith("/releases/3") && request.body?.draft === false)).toBe(true);
    const finalBody = requests.filter((request) => request.method === "PATCH" && request.path.endsWith("/releases/3")).at(-1)?.body?.body;
    const finalState = parseReleaseTransactionBody(typeof finalBody === "string" ? finalBody : null);
    expect(finalState?.phase).toBe("completed");
    expect(finalState?.events.some((event) => event.key === "asset:v0.2.0:artifact.txt" && event.status === "failed")).toBe(true);
  });

  it("resumes after finalization and verification failures without duplicating the release", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-finalization-retry-"));
    const config = "release:\n  branch: release/bot\nhealth:\n  enabled: true\n";
    const eventPath = publishEvent(directory);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    let release: Record<string, unknown> | null = null;
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
      if (url.pathname.endsWith("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
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

    const previous = setPublishEnvironment(directory, eventPath, outputPath);
    const previousFailure = process.env.SEMVERGE_TEST_FAILURE;
    try {
      process.env.SEMVERGE_TEST_FAILURE = "release-finalize";
      await expect(run()).rejects.toThrow("Injected SemVerge test failure at release-finalize.");
      process.env.SEMVERGE_TEST_FAILURE = "post-release-verification";
      await expect(run()).rejects.toThrow("Injected SemVerge test failure at post-release-verification.");
      delete process.env.SEMVERGE_TEST_FAILURE;
      await run();
    } finally {
      if (previousFailure === undefined) delete process.env.SEMVERGE_TEST_FAILURE; else process.env.SEMVERGE_TEST_FAILURE = previousFailure;
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
    }

    expect(requests.filter((request) => request.method === "POST" && request.path.endsWith("/releases"))).toHaveLength(1);
    expect(requests.filter((request) => request.method === "PATCH" && request.path.endsWith("/releases/3") && request.body?.draft === false)).toHaveLength(1);
    const finalBody = requests.filter((request) => request.method === "PATCH" && request.path.endsWith("/releases/3")).at(-1)?.body?.body;
    expect(parseReleaseTransactionBody(typeof finalBody === "string" ? finalBody : null)?.phase).toBe("completed");
  });

  it("refuses provenance publication before creating a release side effect without OIDC", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-provenance-preflight-"));
    const workspace = prepareGitWorkspace(retryFixtureDirectory);
    const config = "release:\n  branch: release/bot\nhealth:\n  enabled: false\npublishing:\n  npm:\n    enabled: true\n    provenance: true\n";
    writeFileSync(join(workspace.directory, ".semverge.yml"), config);
    execFileSync("git", ["add", ".semverge.yml"], { cwd: workspace.directory, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "enable provenance"], { cwd: workspace.directory, stdio: "ignore" });
    const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspace.directory, encoding: "utf8" }).trim();
    const eventPath = publishEvent(directory, mergeSha);
    const outputPath = join(directory, "outputs.txt");
    const requests: Array<{ method: string; path: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ method: init?.method ?? "GET", path: url.pathname });
      if (url.pathname.endsWith("/contents/release-manifest.json")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded(manifest()) }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unexpected request ${init?.method ?? "GET"} ${url.pathname}` }), { status: 500 });
    }));

    const previous = setPublishEnvironment(directory, eventPath, outputPath, workspace.directory, mergeSha);
    try {
      await expect(run()).rejects.toThrow("GitHub Actions OIDC");
    } finally {
      restoreEnvironment(previous);
      rmSync(directory, { recursive: true, force: true });
      rmSync(workspace.directory, { recursive: true, force: true });
    }

    expect(requests.some((request) => request.method === "POST" && request.path.endsWith("/releases"))).toBe(false);
    expect(npmVersionExistsMock).not.toHaveBeenCalled();
  });
});
