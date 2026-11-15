import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReleaseTransaction } from "../src/transaction.js";

const exec = promisify(execFile);
const id = "release_agent-test";
const title = "feat: add delivery dashboard";
let output: string;
let checkout: string;
let cli: string;

beforeAll(async () => {
  output = await mkdtemp(resolve("node_modules", ".agent-test-"));
  checkout = await mkdtemp(join(tmpdir(), "semverge-agent-"));
  cli = join(output, "cli.mjs");
  await build({ entryPoints: ["src/cli.ts"], outfile: cli, bundle: true, packages: "external", platform: "node", format: "esm" });
  await writeFile(join(checkout, "package.json"), JSON.stringify({ name: "delivery", version: "1.3.0" }));
  await writeFile(join(checkout, "README.md"), "Delivery\n");
  await writeFile(join(checkout, ".semverge.yml"), [
    "readiness:",
    "  requiredFiles: [README.md, checklist.md]",
    "  requiredLabels: [release-approved]",
    "  commands:",
    "    - name: build",
    "      run: node -e \"process.exit(47)\"",
  ].join("\n"));
  await mkdir(join(checkout, ".semverge", "release-state"), { recursive: true });
  const record = createReleaseTransaction({
    id, version: "1.4.0", sourceCommit: "a".repeat(40), packageIds: ["delivery"], tagNames: ["v1.4.0"], npmEnabled: false
  });
  await writeFile(join(checkout, ".semverge", "release-state", id + ".json"), JSON.stringify(record));
});

afterAll(async () => {
  if (checkout) await rm(checkout, { recursive: true, force: true });
  if (output) await rm(output, { recursive: true, force: true });
});

async function cliResult(args: string[], exitCode = 0) {
  try {
    const { stdout } = await exec(process.execPath, [cli, ...args], { cwd: checkout });
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  } catch (error) {
    const failure = error as { code: number; stdout: string };
    expect(failure.code).toBe(exitCode);
    return JSON.parse(failure.stdout);
  }
}

describe.each(["legacy", "modern"] as const)("SemVerge stdio MCP (%s)", (era) => {
  it("returns CLI-equivalent plans, blockers and transaction evidence", async () => {
    const client = new Client({ name: "semverge-test", version: "1.0.0" }, {
      versionNegotiation: era === "legacy" ? { mode: "legacy" } : { mode: { pin: "2026-07-28" } }
    });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--checkout", checkout], cwd: output, stderr: "inherit" }));
      expect(client.getProtocolEra()).toBe(era);
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual(["analyze_repository", "check_readiness", "inspect_release", "plan_release"]);
      expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
      const call = (name: string, args: Record<string, string>) => client.callTool({ name, arguments: args });

      expect((await call("analyze_repository", {})).structuredContent).toEqual(await cliResult(["doctor", "--json"]));
      const plan = (await call("plan_release", { title })).structuredContent;
      expect(plan).toMatchObject({ scope: "local-preview", version: "1.4.0", bump: "minor" });
      expect(plan).toEqual(await cliResult(["plan", "--summary", title]));

      const readiness = (await call("check_readiness", { title })).structuredContent;
      expect(readiness).toEqual(await cliResult(["readiness", title], 1));
      expect(readiness).toMatchObject({
        status: "blocked", blockers: [{ kind: "missing-file", name: "checklist.md" }], observedFiles: ["README.md"], publicationAuthorized: false,
        unavailableEvidence: [
          { kind: "pull-request-label", name: "release-approved" },
          { kind: "configured-command-result", name: "build" }
        ],
        notAssessed: ["source-commit", "hosted-ci", "artifact-provenance"]
      });

      await writeFile(join(checkout, "checklist.md"), "Ready locally\n");
      try {
        const unverified = (await call("check_readiness", { title })).structuredContent;
        expect(unverified).toEqual(await cliResult(["readiness", title], 2));
        expect(unverified).toMatchObject({ status: "unverified", blockers: [], publicationAuthorized: false });
      } finally {
        await rm(join(checkout, "checklist.md"));
      }

      const recorded = (await call("inspect_release", { id })).structuredContent;
      expect(recorded).toMatchObject({ status: "recorded", transaction: { id, phase: "planned" } });
      expect(recorded).toEqual(await cliResult(["inspect", id]));
      expect((await call("inspect_release", { id: "release_missing" })).structuredContent).toEqual(await cliResult(["inspect", "release_missing"], 2));
      expect((await call("inspect_release", { id: "../package.json" })).isError).toBe(true);
      expect((await call("check_readiness", { title, commandsPassed: "true" })).isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 20_000);
});
