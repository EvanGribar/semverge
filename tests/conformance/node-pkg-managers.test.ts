import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { inspectRepository, repositoryDoctorMarkdown } from "../../src/doctor.js";
import { discoverPackages } from "../../src/packages.js";
import { parseConfig } from "../../src/config.js";

const temporaryDirectories: string[] = [];

function temporaryRepository(): string {
  const directory = mkdtempSync(join(tmpdir(), "semverge-conformance-pkg-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Conformance: Node Versions and Package Managers", () => {
  describe("Package Manager Lockfiles and Diagnostics", () => {
    it("conforms to pnpm lockfile and packageManager field detection", async () => {
      const dir = temporaryRepository();
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "pnpm-conformance-app",
        version: "1.0.0",
        packageManager: "pnpm@9.12.0",
        engines: { node: ">=20.0.0" }
      }));
      writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

      const report = await inspectRepository(dir);
      expect(report.packageManager.name).toBe("pnpm");
      expect(report.packageManager.source).toContain("package.json packageManager");
      expect(report.packageManager.lockfiles).toEqual(["pnpm-lock.yaml"]);
    });

    it("conforms to Yarn v1 and Berry lockfile detection", async () => {
      const dir = temporaryRepository();
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "yarn-conformance-app",
        version: "2.1.0",
        packageManager: "yarn@4.5.0",
        engines: { node: ">=18.0.0" }
      }));
      writeFileSync(join(dir, "yarn.lock"), "# yarn lockfile v1\n");

      const report = await inspectRepository(dir);
      expect(report.packageManager.name).toBe("yarn");
      expect(report.packageManager.lockfiles).toEqual(["yarn.lock"]);
    });

    it("conforms to Bun text and binary lockfile detection (bun.lock / bun.lockb)", async () => {
      const dirText = temporaryRepository();
      writeFileSync(join(dirText, "package.json"), JSON.stringify({
        name: "bun-text-app",
        version: "0.5.0",
        packageManager: "bun@1.1.20"
      }));
      writeFileSync(join(dirText, "bun.lock"), "# Bun lockfile v1\n");

      const reportText = await inspectRepository(dirText);
      expect(reportText.packageManager.name).toBe("bun");
      expect(reportText.packageManager.lockfiles).toEqual(["bun.lock"]);

      const dirBin = temporaryRepository();
      writeFileSync(join(dirBin, "package.json"), JSON.stringify({
        name: "bun-bin-app",
        version: "0.5.0"
      }));
      writeFileSync(join(dirBin, "bun.lockb"), Buffer.from([0x42, 0x55, 0x4e, 0x00]));

      const reportBin = await inspectRepository(dirBin);
      expect(reportBin.packageManager.name).toBe("bun");
      expect(reportBin.packageManager.lockfiles).toEqual(["bun.lockb"]);
    });

    it("conforms to npm lockfile and shrinkwrap detection", async () => {
      const dir = temporaryRepository();
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "npm-conformance-app",
        version: "3.0.0",
        engines: { node: ">=20" }
      }));
      writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
      writeFileSync(join(dir, "npm-shrinkwrap.json"), JSON.stringify({ lockfileVersion: 3 }));

      const report = await inspectRepository(dir);
      expect(report.packageManager.name).toBe("npm");
      expect(report.packageManager.lockfiles).toEqual(["package-lock.json", "npm-shrinkwrap.json"]);
    });

    it("detects and warns on multiple conflicting lockfiles", async () => {
      const dir = temporaryRepository();
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "conflicted-app",
        version: "1.0.0"
      }));
      writeFileSync(join(dir, "package-lock.json"), "{}\n");
      writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

      const report = await inspectRepository(dir);
      expect(report.packageManager.name).toBe("multiple");
      expect(report.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining("Multiple package-manager lockfiles were detected")
      ]));
    });

    it("warns when no lockfile or packageManager field is present", async () => {
      const dir = temporaryRepository();
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "bare-app",
        version: "1.0.0"
      }));

      const report = await inspectRepository(dir);
      expect(report.packageManager.name).toBe("unknown");
      expect(report.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining("Package manager was not detected")
      ]));
    });
  });

  describe("Workspace Resolution across Package Managers", () => {
    it("discovers workspaces defined via pnpm-workspace.yaml", () => {
      const files = {
        "package.json": JSON.stringify({ name: "root", version: "1.0.0", private: true }),
        "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
        "packages/core/package.json": JSON.stringify({ name: "@workspace/core", version: "1.0.0" }),
        "apps/web/package.json": JSON.stringify({ name: "@workspace/web", version: "1.0.0" })
      };
      const config = parseConfig("");
      const result = discoverPackages(files, Object.keys(files), config);
      expect(result.packages.map((p) => p.name)).toEqual(expect.arrayContaining([
        "@workspace/core",
        "@workspace/web"
      ]));
    });

    it("discovers workspaces defined via package.json workspaces array (npm/Yarn/Bun)", () => {
      const files = {
        "package.json": JSON.stringify({
          name: "bun-workspace-root",
          version: "0.1.0",
          private: true,
          workspaces: ["modules/*"]
        }),
        "modules/auth/package.json": JSON.stringify({ name: "@app/auth", version: "0.1.0" }),
        "modules/db/package.json": JSON.stringify({ name: "@app/db", version: "0.1.0" })
      };
      const config = parseConfig("");
      const result = discoverPackages(files, Object.keys(files), config);
      expect(result.packages.map((p) => p.name)).toEqual(expect.arrayContaining([
        "@app/auth",
        "@app/db"
      ]));
    });

    it("discovers workspaces defined via package.json workspaces object (Yarn classic syntax)", () => {
      const files = {
        "package.json": JSON.stringify({
          name: "yarn-object-root",
          version: "0.1.0",
          private: true,
          workspaces: { packages: ["libs/*"] }
        }),
        "libs/ui/package.json": JSON.stringify({ name: "@yarn/ui", version: "0.1.0" })
      };
      const config = parseConfig("");
      const result = discoverPackages(files, Object.keys(files), config);
      expect(result.packages.map((p) => p.name)).toEqual(expect.arrayContaining(["@yarn/ui"]));
    });
  });

  describe("Node Engine Constraints and Diagnostics Formatting", () => {
    it("formats markdown repository report without leaking secrets or crashing", async () => {
      const dir = temporaryRepository();
      writeFileSync(join(dir, "package.json"), JSON.stringify({
        name: "formatted-app",
        version: "1.2.3",
        packageManager: "pnpm@9.0.0",
        engines: { node: ">=20.0.0" }
      }));
      writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

      const report = await inspectRepository(dir);
      const markdown = repositoryDoctorMarkdown(report);
      expect(markdown).toContain("Package manager: pnpm");
      expect(markdown).toContain("formatted-app=1.2.3");
    });
  });
});
