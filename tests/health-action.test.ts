import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/action.js";

function encoded(content: string): string {
  return Buffer.from(content, "utf8").toString("base64");
}

describe("published release health action", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks expected assets and configured publishing workflows", async () => {
    const directory = mkdtempSync(join(tmpdir(), "shipkit-health-"));
    const eventPath = join(directory, "event.json");
    const outputPath = join(directory, "outputs.txt");
    writeFileSync(eventPath, JSON.stringify({
      action: "published",
      release: { tag_name: "v1.0.0", target_commitish: "merge-sha", published_at: "2026-08-04T00:00:00Z", assets: [{ name: "build.zip" }] }
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/contents/.shipkit.yml")) {
        return new Response(JSON.stringify({ type: "file", encoding: "base64", content: encoded("health:\n  enabled: true\n  expectedArtifacts: [build.zip]\n  workflows:\n    - name: Publish package\n      purpose: package\n      required: true\n") }), { status: 200 });
      }
      if (url.pathname.endsWith("/releases/tags/v1.0.0")) {
        return new Response(JSON.stringify({ id: 1, tag_name: "v1.0.0", html_url: "https://github.com/demo/repo/releases/tag/v1.0.0", upload_url: "https://uploads.github.com/assets{?name,label}", target_commitish: "merge-sha", published_at: "2026-08-04T00:00:00Z", assets: [{ name: "build.zip" }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/actions/runs")) {
        return new Response(JSON.stringify({ workflow_runs: [{ id: 4, name: "Publish package", status: "completed", conclusion: "success", head_sha: "merge-sha", html_url: "https://github.com/demo/repo/actions/runs/4", created_at: "2026-08-04T00:00:00Z", updated_at: "2026-08-04T00:01:00Z" }] }), { status: 200 });
      }
      if (url.pathname.endsWith("/releases")) {
        return new Response(JSON.stringify([{ tag_name: "v1.0.0", published_at: "2026-08-04T00:00:00Z" }]), { status: 200 });
      }
      return new Response(JSON.stringify({ message: `Unhandled ${url.pathname}` }), { status: 500 });
    }));

    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries({ GITHUB_API_URL: "https://api.github.test", GITHUB_REPOSITORY: "demo/repo", GITHUB_EVENT_NAME: "release", GITHUB_SHA: "merge-sha", GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: outputPath, INPUT_GITHUB_TOKEN: "test-token", INPUT_CONFIG: ".shipkit.yml" })) {
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
  });
});
