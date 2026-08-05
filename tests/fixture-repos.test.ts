import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { parseConfig } from "../src/config.js";
import { runCli } from "../src/cli.js";
import { discoverPackages } from "../src/packages.js";
import { buildWorkspaceReleasePlan } from "../src/workspace-release.js";

const fixturesRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function fixturePath(name: string): string {
  return join(fixturesRoot, name);
}

function fixtureFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else {
        files[relative(directory, path).replace(/\\/g, "/")] = readFileSync(path, "utf8");
      }
    }
  };
  visit(directory);
  return files;
}

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

describe("fixture repositories", () => {
  it("runs the local plan command against a single-package fixture", async () => {
    const output = capture();
    expect(await runCli(["plan", "fix: repair release notes"], fixturePath("node-single"), output.io)).toBe(0);
    expect(JSON.parse(output.stdout[0] ?? "{}")).toMatchObject({ previousVersion: "1.4.2", version: "1.4.3", bump: "patch" });
    expect(output.stderr).toEqual([]);
  });

  it("records stable promotion in a workspace manifest", () => {
    const directory = fixturePath("node-single");
    const files = fixtureFiles(directory);
    files["package.json"] = files["package.json"]?.replace('"1.4.2"', '"1.4.2-beta.1"') ?? "";
    files[".semverge.yml"] = "release:\n  promotion: stable\n";
    const config = parseConfig(files[".semverge.yml"] ?? "");
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes: [],
      date: "2026-08-04"
    });

    expect(plan).toMatchObject({ hasRelease: true, version: "1.4.2", channel: "stable", promotion: true });
    expect(JSON.parse(plan.manifest)).toMatchObject({ channel: "stable", promotion: true, packages: [{ version: "1.4.2", promotion: true }] });
  });

  it("plans independent workspace releases and ordinary internal dependency propagation", () => {
    const directory = fixturePath("node-independent");
    const files = fixtureFiles(directory);
    const config = parseConfig(files[".semverge.yml"] ?? "");
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes: [parseChange({ title: "fix: repair core export", source: "pull_request", files: ["apps/core/src/index.js"] })],
      date: "2026-08-04"
    });

    expect(discovered.mode).toBe("independent");
    expect(plan.packages.map((item) => [item.package.name, item.plan.version])).toEqual([
      ["@semverge-fixture/core", "1.0.1"],
      ["@semverge-fixture/web", "1.0.1"]
    ]);
    expect(plan.packages.find((item) => item.package.name === "@semverge-fixture/web")?.plan.releaseChanges.some((change) => change.dependencyUpdate)).toBe(true);
    expect(plan.versionChanges.map((change) => change.path)).toEqual(expect.arrayContaining(["apps/core/package.json", "apps/web/package.json"]));
    expect(plan.versionChanges.some((change) => change.path === "package.json")).toBe(false);
  });

  it("discovers and plans a fixed-version pnpm workspace", () => {
    const directory = fixturePath("pnpm-fixed");
    const files = fixtureFiles(directory);
    const config = parseConfig(files[".semverge.yml"] ?? "");
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes: [parseChange({ title: "feat: add a shared release surface", source: "pull_request", files: ["packages/core/src/index.js"] })],
      date: "2026-08-04"
    });

    expect(files["pnpm-workspace.yaml"]).toContain("packages/*");
    expect(files["pnpm-lock.yaml"]).toContain("lockfileVersion");
    expect(discovered.mode).toBe("fixed");
    expect(plan.version).toBe("2.4.0");
    expect(plan.packages.map((item) => [item.package.name, item.plan.version])).toEqual([
      ["@semverge-fixture/fixed-root", "2.4.0"],
      ["@semverge-fixture/fixed-core", "2.4.0"],
      ["@semverge-fixture/fixed-web", "2.4.0"]
    ]);
    expect(plan.versionChanges.map((change) => change.path)).toEqual(expect.arrayContaining([
      "package.json",
      "packages/core/package.json",
      "packages/web/package.json"
    ]));
  });

  it("plans more than 100 changed files from a fixture repository", () => {
    const directory = fixturePath("node-large");
    const files = fixtureFiles(directory);
    const config = parseConfig(files[".semverge.yml"] ?? "");
    const discovered = discoverPackages(files, Object.keys(files), config);
    const changedFiles = Object.keys(files).filter((path) => path.startsWith("src/generated/"));
    const changes = changedFiles.map((path, index) => parseChange({
      title: `fix: update generated item ${index + 1}`,
      source: "commit",
      files: [path]
    }));
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes,
      date: "2026-08-04"
    });

    expect(changedFiles).toHaveLength(101);
    expect(plan.version).toBe("1.0.1");
    expect(plan.releaseChanges).toHaveLength(101);
  });
});
