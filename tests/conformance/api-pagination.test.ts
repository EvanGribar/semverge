import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../../src/github.js";

describe("Conformance: GitHub API Pagination", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paginates multi-page GitHub API responses using rel=\"next\" Link headers", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/tags?per_page=100&page=1")) {
        return new Response(JSON.stringify([{ name: "v1.0.0", commit: { sha: "sha1" } }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.test/repos/demo/repo/tags?per_page=100&page=2>; rel="next"'
          }
        });
      }
      if (href.endsWith("/tags?per_page=100&page=2")) {
        return new Response(JSON.stringify([{ name: "v1.1.0", commit: { sha: "sha2" } }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("Not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient("test-token", "demo/repo", "https://api.github.test");
    const tags = await client.listTags();

    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.name)).toEqual(["v1.0.0", "v1.1.0"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detects and throws error on circular pagination link loops", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: {
          "content-type": "application/json",
          link: '<https://api.github.test/repos/demo/repo/releases?per_page=100&page=1>; rel="next"'
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient("test-token", "demo/repo", "https://api.github.test");
    await expect(client.listReleases()).rejects.toThrow("GitHub API pagination repeated the same page");
  });

  it("accumulates paginated pull request file listings across multiple pages", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/pulls/10/files?per_page=100&page=1")) {
        return new Response(JSON.stringify([{ filename: "file1.ts" }, { filename: "file2.ts" }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.test/repos/demo/repo/pulls/10/files?per_page=100&page=2>; rel="next"'
          }
        });
      }
      if (href.endsWith("/pulls/10/files?per_page=100&page=2")) {
        return new Response(JSON.stringify([{ filename: "file3.ts" }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("Not found", { status: 404 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient("test-token", "demo/repo", "https://api.github.test");
    const files = await client.listPullRequestFiles(10);

    expect(files).toEqual(["file1.ts", "file2.ts", "file3.ts"]);
  });
});
