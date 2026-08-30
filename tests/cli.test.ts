import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";
import { createReleaseTransaction } from "../src/transaction.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message)
    },
    stdout,
    stderr
  };
}

describe("SemVerge CLI", () => {
  it("initializes a repository, previews a plan, and passes doctor", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-"));
    try {
      const output = capture();
      expect(await runCli(["init"], directory, output.io)).toBe(0);
      expect(readFileSync(join(directory, ".semverge.yml"), "utf8")).toContain("tagPrefix: v");

      writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
      const planOutput = capture();
      expect(await runCli(["plan", "feat: add exports"], directory, planOutput.io)).toBe(0);
      expect(JSON.parse(planOutput.stdout[0] ?? "{}")).toMatchObject({ previousVersion: "1.0.0", version: "1.1.0", bump: "minor" });

      const explainOutput = capture();
      expect(await runCli(["explain", "feat: add exports"], directory, explainOutput.io)).toBe(0);
      expect(explainOutput.stdout.join("\n")).toContain("Version decision: 1.0.0 -> 1.1.0 (minor release).");
      expect(explainOutput.stdout.join("\n")).toContain("When merged:");

      const doctorOutput = capture();
      expect(await runCli(["doctor"], directory, doctorOutput.io)).toBe(0);
      expect(doctorOutput.stdout.join("\n")).toContain("Repository setup report");
      expect(doctorOutput.stdout.join("\n")).toContain("Package manager: unknown");
      expect(doctorOutput.stdout.join("\n")).toContain("OK");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns a failing doctor result for invalid configuration types", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-invalid-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
      writeFileSync(join(directory, ".semverge.yml"), "health:\n  enabled: 1\n");
      const output = capture();
      expect(await runCli(["doctor"], directory, output.io)).toBe(1);
      expect(output.stderr.join("\n")).toContain("health.enabled");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints a conservative migration report", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-migrate-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ devDependencies: { "semantic-release": "^24.0.0" } }));
      const output = capture();
      expect(await runCli(["migrate", "semantic-release"], directory, output.io)).toBe(0);
      expect(output.stdout.join("\n")).toContain("SemVerge migration report");
      expect(output.stdout.join("\n")).toContain("Publication is disabled");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps the original title-only plan invocation working", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-title-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
      const output = capture();
      expect(await runCli(["fix: repair release notes"], directory, output.io)).toBe(0);
      expect(JSON.parse(output.stdout[0] ?? "{}").version).toBe("1.0.1");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps AI assistance explicitly opt-in", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-assist-"));
    try {
      const output = capture();
      expect(await runCli(["assist", "feat: optional summary"], directory, output.io)).toBe(0);
      expect(output.stdout.join("\n")).toContain("AI assistance is disabled");
      expect(output.stderr).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("can seed init with detected workspace and migration guidance", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-init-detect-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        name: "demo",
        version: "1.0.0",
        packageManager: "pnpm@10.0.0",
        workspaces: ["packages/*"],
        devDependencies: { "release-please": "^16.0.0" }
      }));
      const output = capture();
      expect(await runCli(["init", "--detect"], directory, output.io)).toBe(0);
      const config = readFileSync(join(directory, ".semverge.yml"), "utf8");
      expect(config).toContain("# package manager: pnpm");
      expect(config).toContain("packages/*");
      expect(config).toContain("# release tools detected: release-please");
      expect(config).toContain("semverge migrate <tool>");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints an advisory infer result and only applies it with an explicit body path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-infer-"));
    const previousKey = process.env.OPENAI_API_KEY;
    try {
      writeFileSync(join(directory, ".semverge.yml"), `ai:\n  enabled: true\n  infer: true\n  provider: openai\n  model: test-model\n`);
      writeFileSync(join(directory, "pr-body.md"), "Teams can export several projects together.\n");
      process.env.OPENAI_API_KEY = "test-key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        metadata: { type: "feature", customer: "", headline: "Bulk exports", outcome: "Teams can export several projects together.", detail: "", impact: "new", action: "", migration: "", breaking: false },
        confidence: "medium",
        ambiguity: ["The title did not use a conventional commit prefix."]
      }) } }] }), { status: 200 })));

      const output = capture();
      expect(await runCli(["infer", "Improve export workflow", "--body", "Teams can export several projects together.", "--json"], directory, output.io)).toBe(0);
      const report = JSON.parse(output.stdout[0] ?? "{}");
      expect(report).toMatchObject({ feature: "metadata-inference", status: "advisory", suggestion: { confidence: "medium" } });
      expect(report.input.context.categories).toEqual(expect.arrayContaining(["pull-request-title", "pull-request-body", "conventional-commit", "labels"]));
      expect(report.metadataBlock).toContain("type: feature");
      expect(readFileSync(join(directory, "pr-body.md"), "utf8")).not.toContain("<!-- semverge");

      const applied = capture();
      expect(await runCli(["infer", "Improve export workflow", "--body", "Teams can export several projects together.", "--write", "pr-body.md", "--json"], directory, applied.io)).toBe(0);
      expect(readFileSync(join(directory, "pr-body.md"), "utf8")).toContain("<!-- semverge");
    } finally {
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
      vi.unstubAllGlobals();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("recovers a durable transaction from a local state file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-recover-"));
    try {
      const state = createReleaseTransaction({
        id: "release_01JLOCAL",
        version: "2.0.0",
        sourceCommit: "merge-sha",
        packageIds: ["demo"],
        tagNames: ["v2.0.0"],
        npmEnabled: true,
        now: "2026-08-04T00:00:00.000Z"
      });
      const statePath = join(directory, "state.json");
      writeFileSync(statePath, JSON.stringify(state));
      const output = capture();
      const previousRepository = process.env.GITHUB_REPOSITORY;
      process.env.GITHUB_REPOSITORY = "demo/repo";

      try {
        expect(await runCli(["recover", state.id, "--state", "state.json"], directory, output.io)).toBe(0);
        expect(output.stdout.join("\n")).toContain("State: **planned**");
        expect(output.stdout.join("\n")).toContain("Safe next action:");
      } finally {
        if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = previousRepository;
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints machine-readable verification statuses and uses non-zero status for incomplete evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-cli-verify-"));
    try {
      const state = createReleaseTransaction({
        id: "release_01JVERIFYCLI",
        version: "2.0.0",
        sourceCommit: "merge-sha",
        packageIds: ["demo"],
        tagNames: ["v2.0.0"],
        npmEnabled: false
      });
      writeFileSync(join(directory, "state.json"), JSON.stringify(state));
      const output = capture();

      expect(await runCli(["verify", "2.0.0", "--state", "state.json", "--json"], directory, output.io)).toBe(1);
      const report = JSON.parse(output.stdout[0] ?? "{}");
      expect(report).toMatchObject({ schemaVersion: 1, tag: "v2.0.0", version: "2.0.0", status: "mismatch" });
      expect(report.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Release transaction", status: "mismatch" })
      ]));

      const unavailableOutput = capture();
      const previousRepository = process.env.GITHUB_REPOSITORY;
      try {
        delete process.env.GITHUB_REPOSITORY;
        expect(await runCli(["verify", "3.0.0", "--json"], directory, unavailableOutput.io)).toBe(2);
        expect(JSON.parse(unavailableOutput.stdout[0] ?? "{}")).toMatchObject({ status: "unavailable" });
      } finally {
        if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = previousRepository;
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
