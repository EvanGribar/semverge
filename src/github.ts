import { readFile } from "node:fs/promises";

export interface GitHubRepository {
  full_name: string;
  name: string;
  owner: { login: string };
  default_branch: string;
  html_url: string;
}

export interface GitHubTag {
  name: string;
  commit: { sha: string };
}

export interface GitHubCommitSummary {
  sha: string;
  commit: {
    message: string;
    author?: { name?: string; email?: string; date?: string };
  };
  html_url?: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string; sha: string };
  labels: Array<{ name: string }>;
}

export interface GitHubRef {
  ref: string;
  object: { sha: string; type: string };
}

export interface GitHubCommit {
  sha: string;
  tree: { sha: string };
}

export interface GitHubContentFile {
  type: "file";
  path: string;
  sha: string;
  content?: string;
  encoding?: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  html_url: string;
  upload_url: string;
  body?: string | null;
  draft?: boolean;
  target_commitish?: string;
  published_at?: string | null;
  created_at?: string;
  assets?: Array<{ name: string; browser_download_url?: string }>;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubIssueComment {
  id: number;
  body?: string | null;
  html_url?: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface RequestPage<T> {
  data: T | null;
  next: string | null;
}

interface CompareResult {
  commits: GitHubCommitSummary[];
}

interface GitTreeResult {
  tree: Array<{ path: string; type: string; sha: string }>;
  truncated: boolean;
}

interface WorkflowRunsResult {
  workflow_runs: GitHubWorkflowRun[];
}

interface GitTreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  content: string;
}

export class GitHubClient {
  private readonly apiBase: string;

  constructor(
    private readonly token: string,
    private readonly repository: string,
    apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com"
  ) {
    this.apiBase = apiBase.replace(/\/$/, "");
  }

  private buildUrl(path: string): string {
    return /^https?:\/\//i.test(path) ? path : `${this.apiBase}/repos/${this.repository}${path}`;
  }

  private nextPage(linkHeader: string | null): string | null {
    if (!linkHeader) {
      return null;
    }
    const link = linkHeader.split(",").find((part) => /;\s*rel=["']?next["']?(?:\s|$)/i.test(part));
    const match = link?.match(/<([^>]+)>/);
    return match?.[1] ?? null;
  }

  private async requestPage<T>(path: string, options: RequestOptions = {}, allowNotFound = false): Promise<RequestPage<T>> {
    const headers = new Headers(options.headers);
    headers.set("accept", "application/vnd.github+json");
    headers.set("x-github-api-version", "2022-11-28");
    if (this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }
    const init: RequestInit = {
      method: options.method ?? "GET",
      headers
    };
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(this.buildUrl(path), init);
    if (allowNotFound && response.status === 404) {
      return { data: null, next: null };
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub API ${options.method ?? "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return { data: text ? JSON.parse(text) as T : null, next: this.nextPage(response.headers.get("link")) };
  }

  private async request<T>(path: string, options: RequestOptions = {}, allowNotFound = false): Promise<T | null> {
    return (await this.requestPage<T>(path, options, allowNotFound)).data;
  }

  private async paginate<T>(path: string, extract: (payload: unknown) => T[]): Promise<T[]> {
    const items: T[] = [];
    const visited = new Set<string>();
    let next: string | null = path;
    while (next) {
      const url = this.buildUrl(next);
      if (visited.has(url)) {
        throw new Error(`GitHub API pagination repeated the same page: ${url}`);
      }
      visited.add(url);
      const page = await this.requestPage<unknown>(url);
      if (page.data === null) {
        break;
      }
      items.push(...extract(page.data));
      next = page.next;
    }
    return items;
  }

  async repositoryInfo(): Promise<GitHubRepository> {
    return (await this.request<GitHubRepository>("")) as GitHubRepository;
  }

  async getFile(path: string, ref?: string): Promise<string | null> {
    const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const file = await this.request<GitHubContentFile>(`/contents/${encodedPath}${query}`, {}, true);
    if (!file || file.type !== "file" || !file.content) {
      return null;
    }
    return Buffer.from(file.content.replace(/\n/g, ""), file.encoding === "base64" ? "base64" : "utf8").toString("utf8");
  }

  async getRef(ref: string): Promise<GitHubRef | null> {
    return this.request<GitHubRef>(`/git/ref/${ref}`, {}, true);
  }

  async getCommit(sha: string): Promise<GitHubCommit> {
    return (await this.request<GitHubCommit>(`/git/commits/${encodeURIComponent(sha)}`)) as GitHubCommit;
  }

  async getTree(treeSha: string): Promise<Array<{ path: string; type: string; sha: string }>> {
    const result = (await this.request<GitTreeResult>(`/git/trees/${encodeURIComponent(treeSha)}?recursive=1`)) as GitTreeResult;
    if (result.truncated) {
      throw new Error("GitHub returned a truncated repository tree; configure explicit monorepo package paths for large repositories.");
    }
    return result.tree;
  }

  async listTags(): Promise<GitHubTag[]> {
    return this.paginate<GitHubTag>("/tags?per_page=100&page=1", (payload) => Array.isArray(payload) ? payload as GitHubTag[] : []);
  }

  async compare(base: string, head: string): Promise<CompareResult> {
    const commits = await this.paginate<GitHubCommitSummary>(`/compare/${encodeURIComponent(`${base}...${head}`)}?per_page=100&page=1`, (payload) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return [];
      }
      const value = (payload as Record<string, unknown>).commits;
      return Array.isArray(value) ? value as GitHubCommitSummary[] : [];
    });
    return { commits };
  }

  async listCommits(sha: string): Promise<GitHubCommitSummary[]> {
    return this.paginate<GitHubCommitSummary>(`/commits?sha=${encodeURIComponent(sha)}&per_page=100&page=1`, (payload) => Array.isArray(payload) ? payload as GitHubCommitSummary[] : []);
  }

  async commitPullRequests(sha: string): Promise<GitHubPullRequest[]> {
    return this.paginate<GitHubPullRequest>(`/commits/${encodeURIComponent(sha)}/pulls?per_page=100&page=1`, (payload) => Array.isArray(payload) ? payload as GitHubPullRequest[] : []);
  }

  async listPullRequestFiles(number: number): Promise<string[]> {
    const files = await this.paginate<{ filename?: string }>(`/pulls/${number}/files?per_page=100&page=1`, (payload) => Array.isArray(payload) ? payload as Array<{ filename?: string }> : []);
    return files.flatMap((file) => typeof file.filename === "string" ? [file.filename] : []);
  }

  async listPullRequests(params: { state: "open" | "closed"; head?: string; base?: string }): Promise<GitHubPullRequest[]> {
    const query = new URLSearchParams({ state: params.state, per_page: "100" });
    if (params.head) query.set("head", params.head);
    if (params.base) query.set("base", params.base);
    query.set("page", "1");
    return this.paginate<GitHubPullRequest>(`/pulls?${query.toString()}`, (payload) => Array.isArray(payload) ? payload as GitHubPullRequest[] : []);
  }

  async listWorkflowRuns(headSha: string): Promise<GitHubWorkflowRun[]> {
    return this.paginate<GitHubWorkflowRun>(`/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=100&page=1`, (payload) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return [];
      }
      const value = (payload as WorkflowRunsResult).workflow_runs;
      return Array.isArray(value) ? value : [];
    });
  }

  async listIssueComments(number: number): Promise<GitHubIssueComment[]> {
    return this.paginate<GitHubIssueComment>(`/issues/${number}/comments?per_page=100&page=1`, (payload) => Array.isArray(payload) ? payload as GitHubIssueComment[] : []);
  }

  async createIssueComment(number: number, body: string): Promise<GitHubIssueComment> {
    return (await this.request<GitHubIssueComment>(`/issues/${number}/comments`, { method: "POST", body: { body } })) as GitHubIssueComment;
  }

  async listReleases(): Promise<GitHubRelease[]> {
    return this.paginate<GitHubRelease>("/releases?per_page=100&page=1", (payload) => Array.isArray(payload) ? payload as GitHubRelease[] : []);
  }

  async createTree(baseTree: string, entries: GitTreeEntry[]): Promise<{ sha: string }> {
    return (await this.request<{ sha: string }>("/git/trees", {
      method: "POST",
      body: { base_tree: baseTree, tree: entries }
    })) as { sha: string };
  }

  async createCommit(message: string, tree: string, parent: string): Promise<{ sha: string }> {
    return (await this.request<{ sha: string }>("/git/commits", {
      method: "POST",
      body: { message, tree, parents: [parent] }
    })) as { sha: string };
  }

  async createRef(ref: string, sha: string): Promise<GitHubRef> {
    return (await this.request<GitHubRef>("/git/refs", {
      method: "POST",
      body: { ref: `refs/${ref}`, sha }
    })) as GitHubRef;
  }

  async updateRef(ref: string, sha: string, force = false): Promise<GitHubRef> {
    return (await this.request<GitHubRef>(`/git/refs/${ref}`, {
      method: "PATCH",
      body: { sha, force }
    })) as GitHubRef;
  }

  async createPullRequest(input: { title: string; head: string; base: string; body: string }): Promise<GitHubPullRequest> {
    return (await this.request<GitHubPullRequest>("/pulls", { method: "POST", body: input })) as GitHubPullRequest;
  }

  async updatePullRequest(number: number, input: { title: string; body: string }): Promise<GitHubPullRequest> {
    return (await this.request<GitHubPullRequest>(`/pulls/${number}`, { method: "PATCH", body: input })) as GitHubPullRequest;
  }

  async createRelease(input: { tag_name: string; target_commitish: string; name: string; body: string; prerelease: boolean; draft?: boolean }): Promise<GitHubRelease> {
    return (await this.request<GitHubRelease>("/releases", { method: "POST", body: input })) as GitHubRelease;
  }

  async updateRelease(id: number, input: { body?: string; draft?: boolean; tag_name?: string }): Promise<GitHubRelease> {
    return (await this.request<GitHubRelease>(`/releases/${id}`, { method: "PATCH", body: input })) as GitHubRelease;
  }

  async getReleaseByTag(tag: string): Promise<GitHubRelease | null> {
    return this.request<GitHubRelease>(`/releases/tags/${encodeURIComponent(tag)}`, {}, true);
  }

  async uploadReleaseAsset(release: GitHubRelease, filePath: string): Promise<void> {
    const { basename } = await import("node:path");
    const content = await readFile(filePath);
    const uploadUrl = release.upload_url.replace(/\{[^}]+\}$/, "");
    const url = new URL(uploadUrl);
    url.searchParams.set("name", basename(filePath));
    const headers = new Headers({
      accept: "application/vnd.github+json",
      "content-type": "application/octet-stream",
      "content-length": String(content.byteLength),
      "x-github-api-version": "2022-11-28"
    });
    if (this.token) {
      headers.set("authorization", `Bearer ${this.token}`);
    }
    const response = await fetch(url, { method: "POST", headers, body: content });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub asset upload failed (${response.status}): ${text.slice(0, 500)}`);
    }
  }
}

export function releaseTagName(prefix: string, version: string): string {
  return `${prefix}${version}`;
}
