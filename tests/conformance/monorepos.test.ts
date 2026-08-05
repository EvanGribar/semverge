import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { discoverPackages } from "../../src/packages.js";
import { buildWorkspaceReleasePlan } from "../../src/workspace-release.js";
import { parseChange } from "../../src/changes.js";

describe("Conformance: Fixed and Independent Monorepos", () => {
  describe("Fixed Monorepo Invariants", () => {
    it("conforms to lockstep version bumps in fixed mode for Node monorepos", () => {
      const files = {
        "package.json": JSON.stringify({ name: "@fixed/root", version: "1.2.0", private: false }),
        "packages/alpha/package.json": JSON.stringify({ name: "@fixed/alpha", version: "1.2.0" }),
        "packages/beta/package.json": JSON.stringify({ name: "@fixed/beta", version: "1.2.0", dependencies: { "@fixed/alpha": "1.2.0" } }),
        "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n"
      };
      const config = parseConfig("monorepo:\n  mode: fixed\n");
      const discovered = discoverPackages(files, Object.keys(files), config);
      expect(discovered.mode).toBe("fixed");
      expect(discovered.packages).toHaveLength(3);

      const plan = buildWorkspaceReleasePlan({
        packages: discovered.packages,
        mode: discovered.mode,
        files,
        config,
        changes: [parseChange({ title: "feat(alpha): add new API capability", source: "pull_request", files: ["packages/alpha/src/index.js"] })],
        date: "2026-08-05"
      });

      expect(plan.version).toBe("1.3.0");
      expect(plan.packages.every((p) => p.plan.version === "1.3.0")).toBe(true);
      expect(plan.versionChanges.map((vc) => vc.path)).toEqual(expect.arrayContaining([
        "package.json",
        "packages/alpha/package.json",
        "packages/beta/package.json"
      ]));
    });

    it("conforms to fixed mode auto-detection when all discovered package versions match", () => {
      const files = {
        "package.json": JSON.stringify({ name: "@fixed-auto/root", version: "5.0.0", private: true, workspaces: ["apps/*"] }),
        "apps/one/package.json": JSON.stringify({ name: "@fixed-auto/one", version: "5.0.0" }),
        "apps/two/package.json": JSON.stringify({ name: "@fixed-auto/two", version: "5.0.0" })
      };
      const config = parseConfig("");
      const discovered = discoverPackages(files, Object.keys(files), config);
      expect(discovered.mode).toBe("fixed");
    });
  });

  describe("Independent Monorepo Invariants", () => {
    it("conforms to independent mode auto-detection when package versions differ", () => {
      const files = {
        "package.json": JSON.stringify({ name: "@indep/root", version: "0.0.0", private: true, workspaces: ["pkgs/*"] }),
        "pkgs/core/package.json": JSON.stringify({ name: "@indep/core", version: "2.1.0" }),
        "pkgs/cli/package.json": JSON.stringify({ name: "@indep/cli", version: "1.0.4" })
      };
      const config = parseConfig("");
      const discovered = discoverPackages(files, Object.keys(files), config);
      expect(discovered.mode).toBe("independent");
    });

    it("bumps only the affected package and propagates dependent updates to internal consumers", () => {
      const files = {
        "package.json": JSON.stringify({ name: "@graph/root", version: "0.0.0", private: true, workspaces: ["pkgs/*"] }),
        "pkgs/util/package.json": JSON.stringify({ name: "@graph/util", version: "1.0.0" }),
        "pkgs/core/package.json": JSON.stringify({ name: "@graph/core", version: "2.0.0", dependencies: { "@graph/util": "^1.0.0" } }),
        "pkgs/app/package.json": JSON.stringify({ name: "@graph/app", version: "3.0.0", dependencies: { "@graph/core": "workspace:*" } })
      };
      const config = parseConfig("");
      const discovered = discoverPackages(files, Object.keys(files), config);

      const plan = buildWorkspaceReleasePlan({
        packages: discovered.packages,
        mode: discovered.mode,
        files,
        config,
        changes: [parseChange({ title: "fix(util): repair boundary validation", source: "pull_request", files: ["pkgs/util/src/index.js"] })],
        date: "2026-08-05"
      });

      expect(discovered.mode).toBe("independent");
      const utilPlan = plan.packages.find((p) => p.package.name === "@graph/util")?.plan;
      const corePlan = plan.packages.find((p) => p.package.name === "@graph/core")?.plan;
      expect(utilPlan?.version).toBe("1.0.1");
      expect(corePlan?.version).toBe("2.0.1");
      expect(corePlan?.releaseChanges.some((c) => c.dependencyUpdate)).toBe(true);
    });

    it("handles workspace: protocol dependencies across dependencies, devDependencies, and peerDependencies", () => {
      const files = {
        "package.json": JSON.stringify({ name: "root", version: "0.0.0", private: true, workspaces: ["packages/*"] }),
        "packages/shared/package.json": JSON.stringify({ name: "@ws/shared", version: "1.0.0" }),
        "packages/client/package.json": JSON.stringify({
          name: "@ws/client",
          version: "1.0.0",
          devDependencies: { "@ws/shared": "workspace:^1.0.0" },
          peerDependencies: { "@ws/shared": "workspace:*" }
        })
      };
      const config = parseConfig("");
      const discovered = discoverPackages(files, Object.keys(files), config);
      const shared = discovered.packages.find((p) => p.name === "@ws/shared");
      const client = discovered.packages.find((p) => p.name === "@ws/client");
      expect(shared).toBeDefined();
      expect(client).toBeDefined();
      expect(client?.workspaceDependencies).toContain("@ws/shared");
      expect(client?.workspaceDependencyTypes["@ws/shared"]).toEqual(expect.arrayContaining(["devDependencies", "peerDependencies"]));
    });
  });

  describe("Multi-Ecosystem Monorepos (Python & Rust)", () => {
    it("discovers Python workspace packages via tool.uv.workspace pyproject.toml", () => {
      const files = {
        "pyproject.toml": "[tool.uv.workspace]\nmembers = [\"libs/*\"]\n",
        "libs/core/pyproject.toml": "[project]\nname = \"py-core\"\nversion = \"0.4.0\"\n"
      };
      const config = parseConfig("");
      const discovered = discoverPackages(files, Object.keys(files), config);
      expect(discovered.packages).toHaveLength(1);
      expect(discovered.packages[0]).toMatchObject({
        ecosystem: "python",
        name: "py-core",
        version: "0.4.0",
        manifestPath: "libs/core/pyproject.toml"
      });
    });

    it("discovers Rust workspace packages via Cargo.toml [workspace]", () => {
      const files = {
        "Cargo.toml": "[workspace]\nmembers = [\"crates/*\"]\n",
        "crates/kernel/Cargo.toml": "[package]\nname = \"kernel\"\nversion = \"0.8.2\"\n"
      };
      const config = parseConfig("");
      const discovered = discoverPackages(files, Object.keys(files), config);
      expect(discovered.packages).toHaveLength(1);
      expect(discovered.packages[0]).toMatchObject({
        ecosystem: "rust",
        name: "kernel",
        version: "0.8.2",
        manifestPath: "crates/kernel/Cargo.toml"
      });
    });
  });
});
