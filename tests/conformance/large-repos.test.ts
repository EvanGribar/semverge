import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { discoverPackages } from "../../src/packages.js";
import { buildWorkspaceReleasePlan } from "../../src/workspace-release.js";
import { parseChange } from "../../src/changes.js";

describe("Conformance: Large Repositories and File Scale", () => {
  it("handles release planning with over 200 changed files in a single execution", () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "@large/root", version: "1.0.0" }),
      ".semverge.yml": "version:\n  mode: single\n"
    };

    const count = 250;
    const changedFiles: string[] = [];
    for (let index = 1; index <= count; index += 1) {
      const path = `src/generated/file_${index}.ts`;
      files[path] = `export const ITEM_${index} = ${index};`;
      changedFiles.push(path);
    }

    const config = parseConfig(files[".semverge.yml"] ?? "");
    const discovered = discoverPackages(files, Object.keys(files), config);

    const changes = changedFiles.map((path, idx) => parseChange({
      title: `fix(generated): update item ${idx + 1}`,
      source: "commit",
      files: [path]
    }));

    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes,
      date: "2026-08-05"
    });

    expect(plan.version).toBe("1.0.1");
    expect(plan.releaseChanges).toHaveLength(count);
  });

  it("scales package discovery across a monorepo topology with 50 workspace packages", () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({ name: "@mega/root", version: "0.0.0", private: true }),
      "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n"
    };

    const packageNames: string[] = [];
    for (let index = 1; index <= 50; index += 1) {
      const pkgName = `@mega/pkg-${index}`;
      packageNames.push(pkgName);
      files[`packages/pkg-${index}/package.json`] = JSON.stringify({
        name: pkgName,
        version: `1.${index}.0`
      });
    }

    const config = parseConfig("");
    const discovered = discoverPackages(files, Object.keys(files), config);

    expect(discovered.packages).toHaveLength(51); // 50 subpackages + 1 root package
    expect(discovered.mode).toBe("independent");
    expect(discovered.packages.map((p) => p.name)).toEqual(expect.arrayContaining(packageNames));
  });
});
