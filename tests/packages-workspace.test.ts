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
    expect(plan.packages[0]?.explanation.reasons).toEqual(["direct-change", "fixed-workspace"]);
    expect(plan.unchangedPackages).toEqual([]);
  });

  it("releases an explicitly included private root in single mode", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true }),
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "single" as const, includeRoot: true } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "single",
      files,
      config,
      changes: [parseChange({ title: "feat: release the private root", source: "pull_request", files: ["src/index.ts"] })],
      date: "2026-08-04"
    });
    expect(plan.hasRelease).toBe(true);
    expect(plan.packages[0]?.package.name).toBe("demo");
    expect(plan.packages[0]?.plan.version).toBe("1.1.0");
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
    expect(plan.packages[0]?.explanation).toEqual({ reasons: ["direct-change"], directChanges: ["fix(one): repair one"], dependencies: [], dependencyTypes: {} });
    expect(plan.versionChanges.some((change) => change.path === "packages/one/package-lock.json" && change.content.includes('"version": "1.0.1"'))).toBe(true);
    expect(plan.outputs.some((output) => output.path === "packages/one/CHANGELOG.md")).toBe(true);
  });

  it("uses discovered workspace directories for root package ownership", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", workspaces: ["apps/*"] }),
      "apps/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "apps/two/package.json": JSON.stringify({ name: "@demo/two", version: "2.0.0" })
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix(one): repair one", source: "pull_request", files: ["apps/one/src/index.ts"] })],
      date: "2026-08-04"
    });
    expect(plan.packages.map((item) => item.package.name)).toEqual(["@demo/one"]);
  });

  it("releases all independent packages for an unscoped root change", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0" })
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const, unscopedChanges: "all" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "feat: document the workspace", source: "pull_request", files: ["README.md"] })],
      date: "2026-08-04"
    });
    expect(plan.packages.map((item) => item.package.name)).toEqual(["@demo/one", "@demo/two"]);
    expect(plan.packages.every((item) => item.plan.version === "1.1.0")).toBe(true);
  });

  it("propagates independent releases to workspace dependents", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0", dependencies: { "@demo/one": "workspace:*" } })
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix: repair shared export", source: "pull_request", files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    });
    const one = plan.packages.find((item) => item.package.name === "@demo/one");
    const two = plan.packages.find((item) => item.package.name === "@demo/two");
    expect(one?.plan.version).toBe("1.0.1");
    expect(two?.plan.version).toBe("1.0.1");
    expect(one?.explanation).toEqual({ reasons: ["direct-change"], directChanges: ["fix: repair shared export"], dependencies: [], dependencyTypes: {} });
    expect(two?.explanation).toEqual({ reasons: ["dependency-update"], directChanges: [], dependencies: ["@demo/one"], dependencyTypes: { "@demo/one": ["dependencies"] } });
    expect(two?.plan.releaseChanges.some((change) => change.dependencyUpdate)).toBe(true);
    expect(two?.plan.customerNotes).toContain("No customer-facing changes");
    expect(plan.manifest).toContain('"dependencyUpdate": true');
    expect(JSON.parse(plan.manifest).packages[1]).toMatchObject({ reasons: ["dependency-update"], dependencies: ["@demo/one"] });
    expect(plan.unchangedPackages.map((packageItem) => packageItem.name)).toEqual(["demo"]);
  });

  it("propagates independent releases to ordinary internal dependency ranges", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0", dependencies: { "@demo/one": "^1.0.0" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/one: {}\n  packages/two:\n    dependencies:\n      '@demo/one':\n        specifier: ^1.0.0\n        version: 1.0.0\n"
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix: repair shared export", source: "pull_request", files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    });
    const two = plan.packages.find((item) => item.package.name === "@demo/two");
    expect(two?.plan.version).toBe("1.0.1");
    expect(two?.explanation.dependencies).toEqual(["@demo/one"]);
    expect(two?.plan.releaseChanges.some((change) => change.dependencyUpdate)).toBe(true);
    expect(plan.versionChanges.some((change) => change.path === "packages/two/package.json" && change.content.includes('"@demo/one": "^1.0.1"'))).toBe(true);
    expect(plan.versionChanges.some((change) => change.path === "pnpm-lock.yaml" && change.content.includes("version: 1.0.1"))).toBe(true);
  });

  it("updates supported exact, protocol, and wildcard workspace ranges consistently", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({
        name: "@demo/two",
        version: "1.0.0",
        dependencies: { "@demo/one": "1.0.0" },
        devDependencies: { "@demo/one": "workspace:~1.0.0" },
        peerDependencies: { "@demo/one": "workspace:^1.0.0" },
        optionalDependencies: { "@demo/one": "workspace:*" }
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/one: {}\n  packages/two:\n    specifiers:\n      '@demo/one': 1.0.0\n    dependencies:\n      '@demo/one':\n        specifier: 1.0.0\n        version: 1.0.0\n    devDependencies:\n      '@demo/one':\n        specifier: 'workspace:~1.0.0'\n        version: 1.0.0\n    peerDependencies:\n      '@demo/one':\n        specifier: 'workspace:^1.0.0'\n        version: 1.0.0\n    optionalDependencies:\n      '@demo/one':\n        specifier: 'workspace:*'\n        version: 1.0.0\n"
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix: repair shared export", source: "pull_request", files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    });
    const manifest = plan.versionChanges.find((change) => change.path === "packages/two/package.json")?.content ?? "";
    const lockfile = plan.versionChanges.find((change) => change.path === "pnpm-lock.yaml")?.content ?? "";

    expect(manifest).toContain('"@demo/one": "1.0.1"');
    expect(manifest).toContain('"@demo/one": "workspace:~1.0.1"');
    expect(manifest).toContain('"@demo/one": "workspace:^1.0.1"');
    expect(manifest).toContain('"@demo/one": "workspace:*"');
    expect(lockfile).toContain("specifier: 1.0.1");
    expect(lockfile).toContain("workspace:~1.0.1");
    expect(lockfile).toContain("workspace:^1.0.1");
    expect(lockfile).toContain("workspace:*");
    expect(lockfile).toContain("version: 1.0.1");
  });

  it.each([">=1.2.3 <2.0.0", "^1.2.3 || ^2.0.0", "1.2.3 - 1.9.9"])(
    "rejects compound workspace dependency range %s instead of partially rewriting it",
    (range) => {
      const files = {
        "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
        "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.9.9" }),
        "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0", dependencies: { "@demo/one": range } })
      };
      const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
      const discovered = discoverPackages(files, Object.keys(files), config);

      expect(() => buildWorkspaceReleasePlan({
        packages: discovered.packages,
        mode: "independent",
        files,
        config,
        changes: [parseChange({ title: "feat!: cross the upper dependency bound", source: "pull_request", breaking: true, files: ["packages/one/src/index.ts"] })],
        date: "2026-08-04"
      })).toThrow(new RegExp(`Cannot safely update internal dependency range .*${range.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*2\\.0\\.0`));
    }
  );

  it("rejects compound ranges in pnpm lock metadata with the same fail-closed policy", () => {
    const range = ">=1.9.9 <2.0.0";
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.9.9" }),
      "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0", dependencies: { "@demo/one": "workspace:*" } }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/one: {}\n  packages/two:\n    dependencies:\n      '@demo/one':\n        specifier: '>=1.9.9 <2.0.0'\n        version: 1.9.9\n"
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);

    expect(() => buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "feat!: cross the upper dependency bound", source: "pull_request", breaking: true, files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    })).toThrow(new RegExp(`Cannot safely update internal dependency range .*${range.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*2\\.0\\.0`));
  });

  it("applies independent dependency policies by manifest field", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/peer/package.json": JSON.stringify({ name: "@demo/peer", version: "1.0.0", peerDependencies: { "@demo/one": "^1.0.0" } }),
      "packages/optional/package.json": JSON.stringify({ name: "@demo/optional", version: "1.0.0", optionalDependencies: { "@demo/one": "^1.0.0" } }),
      "packages/dev/package.json": JSON.stringify({ name: "@demo/dev", version: "1.0.0", devDependencies: { "@demo/one": "^1.0.0" } })
    };
    const config = {
      ...DEFAULT_CONFIG,
      monorepo: {
        ...DEFAULT_CONFIG.monorepo,
        mode: "independent" as const,
        dependencyPolicy: {
          ...DEFAULT_CONFIG.monorepo.dependencyPolicy,
          peerDependencies: "major" as const,
          optionalDependencies: "minor" as const,
          devDependencies: "none" as const
        }
      }
    };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix: repair shared export", source: "pull_request", files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    });

    expect(plan.packages.map((item) => item.package.name)).toEqual(["@demo/one", "@demo/peer", "@demo/optional"]);
    expect(plan.packages.map((item) => item.plan.version)).toEqual(["1.0.1", "2.0.0", "1.1.0"]);
    expect(plan.packages.find((item) => item.package.name === "@demo/peer")?.explanation.dependencyTypes).toEqual({ "@demo/one": ["peerDependencies"] });
    expect(plan.packages.find((item) => item.package.name === "@demo/optional")?.explanation.dependencyTypes).toEqual({ "@demo/one": ["optionalDependencies"] });
    expect(plan.packages.find((item) => item.package.name === "@demo/peer")?.plan.releaseChanges.find((change) => change.dependencyUpdate)?.forcedBump).toBe("major");
    expect(plan.unchangedPackages.map((item) => item.name)).toEqual(["demo", "@demo/dev"]);
    expect(plan.manifest).toContain('"peerDependencies"');
  });

  it("explains transitive independent dependency propagation", () => {
    const files = {
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", private: true, workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "@demo/one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({ name: "@demo/two", version: "1.0.0", dependencies: { "@demo/one": "^1.0.0" } }),
      "packages/three/package.json": JSON.stringify({ name: "@demo/three", version: "1.0.0", dependencies: { "@demo/two": "^1.0.0" } })
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix: repair the foundation", source: "pull_request", files: ["packages/one/src/index.ts"] })],
      date: "2026-08-04"
    });

    expect(plan.packages.map((item) => item.package.name)).toEqual(["@demo/one", "@demo/two", "@demo/three"]);
    expect(plan.packages.map((item) => item.explanation.dependencies)).toEqual([[], ["@demo/one"], ["@demo/two"]]);
    expect(plan.packages.map((item) => item.plan.version)).toEqual(["1.0.1", "1.0.1", "1.0.1"]);
    expect(plan.unchangedPackages.map((packageItem) => packageItem.name)).toEqual(["demo"]);
  });
});

describe("Python and Rust workspace discovery", () => {
  it("discovers Python uv workspace members and plans a fixed release", () => {
    const files = {
      "pyproject.toml": "[tool.uv.workspace]\nmembers = [\"packages/*\"]\n",
      "packages/one/pyproject.toml": "[project]\nname = \"demo-one\"\nversion = \"1.0.0\"\n",
      "packages/two/pyproject.toml": "[project]\nname = \"demo-two\"\nversion = \"1.0.0\"\n"
    };
    const discovered = discoverPackages(files, Object.keys(files), DEFAULT_CONFIG);
    expect(discovered.mode).toBe("fixed");
    expect(discovered.packages.map((item) => item.name)).toEqual(["demo-one", "demo-two"]);
    expect(discovered.packages.map((item) => item.ecosystem)).toEqual(["python", "python"]);

    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config: DEFAULT_CONFIG,
      changes: [parseChange({ title: "feat: add Python exports", source: "pull_request", files: ["packages/one/src/exports.py"] })],
      date: "2026-08-04"
    });
    expect(plan.version).toBe("1.1.0");
    expect(plan.versionChanges.map((change) => change.path)).toEqual(["packages/one/pyproject.toml", "packages/two/pyproject.toml"]);
    expect(plan.versionChanges.every((change) => change.content.includes('version = "1.1.0"'))).toBe(true);
  });

  it("discovers Rust Cargo workspace members and plans an independent release", () => {
    const files = {
      "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]\n",
      "crates/core/Cargo.toml": "[package]\nname = \"demo-core\"\nversion = \"0.1.0\"\n",
      "crates/cli/Cargo.toml": "[package]\nname = \"demo-cli\"\nversion = \"0.2.0\"\n"
    };
    const config = { ...DEFAULT_CONFIG, monorepo: { ...DEFAULT_CONFIG.monorepo, mode: "independent" as const } };
    const discovered = discoverPackages(files, Object.keys(files), config);
    expect(discovered.mode).toBe("independent");
    expect(discovered.packages.map((item) => item.name)).toEqual(["demo-core", "demo-cli"]);

    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: "independent",
      files,
      config,
      changes: [parseChange({ title: "fix: repair the Rust core", source: "commit", files: ["crates/core/src/lib.rs"] })],
      date: "2026-08-04"
    });
    expect(plan.packages.map((item) => item.package.name)).toEqual(["demo-core"]);
    expect(plan.packages[0]?.plan.version).toBe("0.1.1");
    expect(plan.versionChanges).toEqual([{ path: "crates/core/Cargo.toml", content: "[package]\nname = \"demo-core\"\nversion = \"0.1.1\"\n" }]);
    expect(plan.unchangedPackages.map((item) => item.name)).toEqual(["demo-cli"]);
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
