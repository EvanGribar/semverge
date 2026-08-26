import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../src/github.js";

async function runPaginated<T>(pages: unknown[], operation: (client: GitHubClient) => Promise<T>): Promise<{ result: T; requests: URL[] }> {
  const requests: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const nextUrl = page < pages.length ? new URL(url) : null;
    if (nextUrl) {
      nextUrl.searchParams.set("page", String(page + 1));
    }
    return new Response(JSON.stringify(pages[page - 1] ?? []), {
      status: 200,
      headers: nextUrl ? { link: `<${nextUrl.toString()}>; rel="next"` } : undefined
    });
  }));

  const result = await operation(new GitHubClient("", "demo/repo", "https://api.github.test"));
  return { result, requests };
}

describe("GitHub API pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates tags and releases", async () => {
    const tags = await runPaginated([
      [{ name: "v2.0.0", commit: { sha: "tag-2" } }],
      [{ name: "v1.0.0", commit: { sha: "tag-1" } }]
    ], (client) => client.listTags());
    expect(tags.result.map((tag) => tag.name)).toEqual(["v2.0.0", "v1.0.0"]);
    expect(tags.requests).toHaveLength(2);
    expect(tags.requests[1]?.searchParams.get("page")).toBe("2");

    vi.unstubAllGlobals();
    const releases = await runPaginated([
      [{ tag_name: "v2.0.0", html_url: "release-2", upload_url: "upload-2" }],
      [{ tag_name: "v1.0.0", html_url: "release-1", upload_url: "upload-1" }]
    ], (client) => client.listReleases());
    expect(releases.result.map((release) => release.tag_name)).toEqual(["v2.0.0", "v1.0.0"]);
    expect(releases.requests).toHaveLength(2);
    expect(releases.requests[1]?.searchParams.get("page")).toBe("2");
  });

  it("paginates commit history and compare results", async () => {
    const commits = await runPaginated([
      [{ sha: "commit-2", commit: { message: "fix: second" } }],
      [{ sha: "commit-1", commit: { message: "feat: first" } }]
    ], (client) => client.listCommits("head-sha"));
    expect(commits.result.map((commit) => commit.sha)).toEqual(["commit-2", "commit-1"]);
    expect(commits.requests).toHaveLength(2);

    vi.unstubAllGlobals();
    const comparison = await runPaginated([
      { commits: [{ sha: "compare-2", commit: { message: "fix: second" } }] },
      { commits: [{ sha: "compare-1", commit: { message: "feat: first" } }] }
    ], (client) => client.compare("v1.0.0", "head-sha"));
    expect(comparison.result.commits.map((commit) => commit.sha)).toEqual(["compare-2", "compare-1"]);
    expect(comparison.requests).toHaveLength(2);
    expect(comparison.requests[1]?.searchParams.get("page")).toBe("2");
  });

  it("paginates pull-request associations, changed files, and release PR discovery", async () => {
    const associations = await runPaginated([
      [{ number: 2, title: "second", labels: [] }],
      [{ number: 1, title: "first", labels: [] }]
    ], (client) => client.commitPullRequests("commit-sha"));
    expect(associations.result.map((pullRequest) => pullRequest.number)).toEqual([2, 1]);

    vi.unstubAllGlobals();
    const files = await runPaginated([
      [{ filename: "src/second.ts" }],
      [{ filename: "src/first.ts" }]
    ], (client) => client.listPullRequestFiles(7));
    expect(files.result).toEqual(["src/second.ts", "src/first.ts"]);

    vi.unstubAllGlobals();
    const pullRequests = await runPaginated([
      [{ number: 2, title: "second", labels: [] }],
      [{ number: 1, title: "first", labels: [] }]
    ], (client) => client.listPullRequests({ state: "open", head: "demo:semverge/release", base: "main" }));
    expect(pullRequests.result.map((pullRequest) => pullRequest.number)).toEqual([2, 1]);
    expect(pullRequests.requests[0]?.searchParams.get("page")).toBe("1");
    expect(pullRequests.requests[1]?.searchParams.get("page")).toBe("2");
  });

  it("paginates workflow runs returned in the API envelope", async () => {
    const workflows = await runPaginated([
      { workflow_runs: [{ id: 2, name: "deploy", status: "completed", conclusion: "success", head_sha: "sha", html_url: "run-2", created_at: "", updated_at: "" }] },
      { workflow_runs: [{ id: 1, name: "publish", status: "completed", conclusion: "success", head_sha: "sha", html_url: "run-1", created_at: "", updated_at: "" }] }
    ], (client) => client.listWorkflowRuns("sha"));
    expect(workflows.result.map((run) => run.id)).toEqual([2, 1]);
    expect(workflows.requests).toHaveLength(2);
    expect(workflows.requests[1]?.searchParams.get("page")).toBe("2");
  });

  it("reads and creates issue comments for release history", async () => {
    const requests: Array<{ method: string; url: URL; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", url, body });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: 9, body: body?.body, html_url: "comment-9" }), { status: 201 });
      }
      return new Response(JSON.stringify([{ id: 8, body: "existing" }]), { status: 200 });
    }));

    const client = new GitHubClient("", "demo/repo", "https://api.github.test");
    await expect(client.listIssueComments(7)).resolves.toEqual([{ id: 8, body: "existing" }]);
    await expect(client.createIssueComment(7, "history")).resolves.toMatchObject({ id: 9, body: "history" });
    expect(requests.map((request) => `${request.method} ${request.url.pathname}`)).toEqual(["GET /repos/demo/repo/issues/7/comments", "POST /repos/demo/repo/issues/7/comments"]);
    expect(requests[1]?.body).toEqual({ body: "history" });
  });

  it("reads and creates completed check runs with external identifiers", async () => {
    const requests: Array<{ method: string; url: URL; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
      requests.push({ method: init?.method ?? "GET", url, body });
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ id: 12, name: body?.name, status: "completed", conclusion: body?.conclusion, external_id: body?.external_id }), { status: 201 });
      }
      return new Response(JSON.stringify({ check_runs: [{ id: 11, name: "SemVerge delayed monitoring", status: "completed", conclusion: "success", external_id: "monitor-1" }] }), { status: 200 });
    }));

    const client = new GitHubClient("", "demo/repo", "https://api.github.test");
    await expect(client.listCheckRuns("merge-sha", "SemVerge delayed monitoring")).resolves.toMatchObject([{ external_id: "monitor-1" }]);
    await expect(client.createCheckRun({ name: "SemVerge delayed monitoring", headSha: "merge-sha", externalId: "monitor-2", conclusion: "neutral", title: "Observed", summary: "summary" })).resolves.toMatchObject({ id: 12, external_id: "monitor-2" });
    expect(requests[0]?.url.searchParams.get("check_name")).toBe("SemVerge delayed monitoring");
    expect(requests[1]?.body).toMatchObject({ name: "SemVerge delayed monitoring", head_sha: "merge-sha", status: "completed", conclusion: "neutral", external_id: "monitor-2" });
  });

  it("resolves annotated tags and downloads release assets", async () => {
    const requests: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("/git/ref/tags/v2.0.0")) {
        return new Response(JSON.stringify({ ref: "refs/tags/v2.0.0", object: { sha: "tag-object", type: "tag" } }), { status: 200 });
      }
      if (url.pathname.endsWith("/git/tags/tag-object")) {
        return new Response(JSON.stringify({ object: { sha: "commit-sha", type: "commit" } }), { status: 200 });
      }
      expect(init?.headers).toBeDefined();
      return new Response("artifact", { status: 200 });
    }));

    const client = new GitHubClient("token", "demo/repo", "https://api.github.test");
    await expect(client.resolveTagCommit("v2.0.0")).resolves.toBe("commit-sha");
    await expect(client.downloadReleaseAsset({ name: "demo.tgz", browser_download_url: "https://downloads.example/demo.tgz" })).resolves.toEqual(new Uint8Array(Buffer.from("artifact")));
    expect(requests.map((request) => request.pathname)).toEqual([
      "/repos/demo/repo/git/ref/tags/v2.0.0",
      "/repos/demo/repo/git/tags/tag-object",
      "/demo.tgz"
    ]);
  });
});
