import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRepository, repositoryDoctorMarkdown } from "../src/doctor.js";

const temporaryDirectories: string[] = [];

function temporaryRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "semverge-doctor-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("repository setup diagnostics", () => {
  it("detects workspace, release tooling, registry, build, and trusted-publishing signals", async () => {
    const directory = temporaryRepository();
    mkdirSync(join(directory, "packages", "core"), { recursive: true });
    mkdirSync(join(directory, ".changeset"), { recursive: true });
    mkdirSync(join(directory, ".github", "workflows"), { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({
      name: "doctor-fixture",
      version: "1.0.0",
      packageManager: "pnpm@10.0.0",
      workspaces: ["packages/*"],
      scripts: { build: "tsc", prepare: "husky" },
      devDependencies: { "@changesets/cli": "^2.0.0" }
    }));
    writeFileSync(join(directory, "packages", "core", "package.json"), JSON.stringify({ name: "@demo/core", version: "1.1.0" }));
    writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(directory, ".changeset", "config.json"), "{}\n");
    writeFileSync(join(directory, ".semverge.yml"), "publishing:\n  npm:\n    enabled: true\n    provenance: true\n");
    writeFileSync(join(directory, ".npmrc"), "registry=https://user:secret@registry.npmjs.org/?token=secret\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n");
    writeFileSync(join(directory, ".github", "workflows", "release.yml"), `name: Release
permissions:
  contents: write
  pull-requests: write
  id-token: write
jobs:
  release:
    steps:
      - uses: EvanGribar/semverge@main
      - run: npm publish
`);

    const report = await inspectRepository(directory);

    expect(report.packageManager).toMatchObject({ name: "pnpm", lockfiles: ["pnpm-lock.yaml"] });
    expect(report.workspace).toMatchObject({ kind: "workspace", packageCount: 2, strategy: "independent", patterns: ["packages/*"] });
    expect(report.releaseTools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "changesets" }),
      expect.objectContaining({ name: "semverge" })
    ]));
    expect(report.build.scripts).toEqual(["build", "prepare"]);
    expect(report.registry).toMatchObject({ registry: "https://registry.npmjs.org/", trustedPublishing: "detected", provenance: "detected" });
    expect(report.github).toMatchObject({ semvergeWorkflow: true, publishWorkflows: [".github/workflows/release.yml"] });
    expect(report.github.permissions).toEqual({ contents: "write", pullRequests: "write", idToken: "write", actions: "not declared" });
    expect(repositoryDoctorMarkdown(report)).not.toContain("NPM_TOKEN");
    expect(repositoryDoctorMarkdown(report)).toContain("provider-side trusted-publishing eligibility");
  });

  it("warns about ambiguous package managers and missing hosted wiring without failing inspection", async () => {
    const directory = temporaryRepository();
    writeFileSync(join(directory, "package.json"), JSON.stringify({
      name: "ambiguous-fixture",
      version: "0.1.0",
      dependencies: { "semantic-release": "^24.0.0" }
    }));
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    writeFileSync(join(directory, "yarn.lock"), "# yarn lockfile v1\n");
    writeFileSync(join(directory, ".releaserc"), "{}\n");

    const report = await inspectRepository(directory);

    expect(report.packageManager.name).toBe("multiple");
    expect(report.releaseTools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "semantic-release" })]));
    expect(report.github.workflowFiles).toEqual([]);
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Multiple package-manager lockfiles"),
      expect.stringContaining("No standard build"),
      expect.stringContaining("No GitHub workflow files")
    ]));
    expect(readFileSync(join(directory, ".releaserc"), "utf8")).toBe("{}\n");
  });
});
