import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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

      const doctorOutput = capture();
      expect(await runCli(["doctor"], directory, doctorOutput.io)).toBe(0);
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
});
