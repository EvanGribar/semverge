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
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface CompareResult {
  commits: GitHubCommitSummary[];
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

  private async request<T>(path: string, options: RequestOptions = {}, allowNotFound = false): Promise<T | null> {
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
    const response = await fetch(`${this.apiBase}/repos/${this.repository}${path}`, init);
    if (allowNotFound && response.status === 404) {
      return null;
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub API ${options.method ?? "GET"} ${path} failed (${response.status}): ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) as T : null;
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

  async listTags(): Promise<GitHubTag[]> {
    return (await this.request<GitHubTag[]>("/tags?per_page=100")) ?? [];
  }

  async compare(base: string, head: string): Promise<CompareResult> {
    return (await this.request<CompareResult>(`/compare/${encodeURIComponent(`${base}...${head}`)}`)) as CompareResult;
  }

  async listCommits(sha: string): Promise<GitHubCommitSummary[]> {
    return (await this.request<GitHubCommitSummary[]>(`/commits?sha=${encodeURIComponent(sha)}&per_page=100`)) ?? [];
  }

  async commitPullRequests(sha: string): Promise<GitHubPullRequest[]> {
    return (await this.request<GitHubPullRequest[]>(`/commits/${encodeURIComponent(sha)}/pulls`)) ?? [];
  }

  async listPullRequests(params: { state: "open" | "closed"; head?: string; base?: string }): Promise<GitHubPullRequest[]> {
    const query = new URLSearchParams({ state: params.state, per_page: "100" });
    if (params.head) query.set("head", params.head);
    if (params.base) query.set("base", params.base);
    return (await this.request<GitHubPullRequest[]>(`/pulls?${query.toString()}`)) ?? [];
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

  async createRelease(input: { tag_name: string; target_commitish: string; name: string; body: string; prerelease: boolean }): Promise<GitHubRelease> {
    return (await this.request<GitHubRelease>("/releases", { method: "POST", body: input })) as GitHubRelease;
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
