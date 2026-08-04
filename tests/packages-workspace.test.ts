import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { discoverPackages } from "../src/packages.js";
import { buildWorkspaceReleasePlan } from "../src/workspace-release.js";
import { readTargetName, readTargetVersion, updateTargetVersion } from "../src/version-adapters.js";

describe("package discovery and workspace releases", () => {
  const fixedFiles = {
    "package.json": JSON.stringify({ name: "demo", version: "1.0.0", workspaces: ["packages/*"] }),
    "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
    "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0" }),
    "package-lock.json": JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" }, "packages/one": { name: "@demo/one", version: "1.0.0" }, "packages/two": { name: "@demo/two", version: "1.0.0" } } })
  };

  it("discovers npm workspaces and infers fixed mode", () => {
    const result = discoverPackages(fixedFiles, Object.keys(fixedFiles), DEFAULT_CONFIG);
    expect(result.mode).toBe("fixed");
    expect(result.packages.map((item) => item.name)).toEqual(["demo", "@demo/one", "@demo/two"]);
  });

  it("discovers pnpm workspace packages without extra configuration", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" })
    };
    const result = discoverPackages(files, Object.keys(files), DEFAULT_CONFIG);
    expect(result.packages.map((item) => item.name)).toEqual(["demo", "@demo/one"]);
  });

  it("updates every package in fixed mode", () => {
    const discovered = discoverPackages(fixedFiles, Object.keys(fixedFiles), DEFAULT_CONFIG);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files: fixedFiles,
      config: DEFAULT_CONFIG,
      changes: [parseChange({ title: "feat: add shared export", source: "pull_request", files: ["packages/one/src/export.ts"] })],
      date: "2026-08-04"
    });
    expect(plan.hasRelease).toBe(true);
    expect(plan.version).toBe("1.1.0");
    expect(plan.versionChanges).toHaveLength(4);
    expect(plan.versionChanges.map((change) => change.path)).toEqual(expect.arrayContaining(["package.json", "packages/one/package.json", "packages/two/package.json", "package-lock.json"]));
    expect(plan.manifest).toContain('"mode": "fixed"');
  });

  it("assigns independent changes to the package whose files changed", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "2.0.0" }),
      "packages/one/package-lock.json": JSON.stringify({ version: "1.0.0", packages: { "": { name: "@demo/one", version: "1.0.0" } } })
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix(one): repair one", source: "pull_request", files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    });
    expect(plan.packages).toHaveLength(1);
    expect(plan.packages[0]?.package.name).toBe("@demo/one");
    expect(plan.packages[0]?.plan.version).toBe("1.0.1");
    expect(plan.versionChanges.some((change) => change.path === "packages/one/package-lock.json" && change.content.includes('"version": "1.0.1"'))).toBe(true);
    expect(plan.outputs.some((output) => output.path === "packages/one/CHANGELOG.md")).toBe(true);
  });
});

describe("ecosystem version adapters", () => {
  it("reads and updates Python pyproject versions", () => {
    const target = { ecosystem: "python" as const, manifestPath: "pyproject.toml", directory: "" };
    const content = `[project]\nname = "demo"\nversion = "1.2.3"\n`;
    expect(readTargetName(target, content)).toBe("demo");
    expect(readTargetVersion(target, content)).toBe("1.2.3");
    expect(updateTargetVersion(target, content, "1.3.0").content).toContain('version = "1.3.0"');
  });

  it("reads and updates Rust Cargo versions", () => {
    const target = { ecosystem: "rust" as const, manifestPath: "Cargo.toml", directory: "" };
    const content = `[package]\nname = "demo"\nversion = "0.4.0"\n`;
    expect(readTargetName(target, content)).toBe("demo");
    expect(readTargetVersion(target, content)).toBe("0.4.0");
    expect(updateTargetVersion(target, content, "0.5.0").content).toContain('version = "0.5.0"');
  });
});
