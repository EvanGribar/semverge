import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectMigration, migrationReportMarkdown, writeMigrationConfig } from "../src/migrate.js";
import { parseConfig } from "../src/config.js";

describe("migration diagnostics", () => {
  it("detects Release Please and maps safe settings without enabling publication", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-migrate-release-please-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ devDependencies: { "release-please": "^16.0.0" } }));
      writeFileSync(join(directory, "release-please-config.json"), JSON.stringify({ "release-type": "node", "changelog-path": "docs/CHANGELOG.md", packages: { "packages/web": {} } }));

      const report = await inspectMigration(directory, "release-please");
      expect(report.detected).toBe(true);
      expect(report.confidence).toBe("high");
      expect(report.sourceFiles).toEqual(["release-please-config.json", "package.json"]);
      expect(report.generatedConfig).toContain("docs/CHANGELOG.md");
      expect(report.generatedConfig).toContain("enabled: false");
      expect(report.mappedSettings).toContain("monorepo.mode <- independent Release Please package configuration");
      expect(report.comparison).toEqual(expect.arrayContaining([
        expect.objectContaining({ area: "workspace scope", status: "mapped" }),
        expect.objectContaining({ area: "release strategy", status: "review" })
      ]));
      expect(migrationReportMarkdown(report)).toContain("Conservative generated configuration:");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("maps Release Please package version files and unsupported release-PR settings explicitly", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-migrate-release-please-files-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ devDependencies: { "release-please": "^16.0.0" } }));
      writeFileSync(join(directory, "release-please-config.json"), JSON.stringify({
        packages: {
          "packages/web": {
            "version-file": "VERSION",
            "extra-files": [{ type: "json", path: "deploy/metadata.json", jsonpath: "release.version" }]
          }
        },
        "pull-request-title-pattern": "chore(release): ${component}"
      }));

      const report = await inspectMigration(directory, "release-please");
      expect(report.generatedConfig).toContain("packages/web/VERSION");
      expect(report.generatedConfig).toContain("packages/web/deploy/metadata.json");
      expect(report.generatedConfig).toContain("release.version");
      expect(report.comparison).toContainEqual(expect.objectContaining({ area: "pull-request-title-pattern", status: "unsupported" }));
      expect(migrationReportMarkdown(report)).toContain("Compatibility comparison:");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("writes only an explicit migration and refuses to overwrite by default", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-migrate-changesets-"));
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ dependencies: { "@changesets/cli": "^2.0.0" } }));
      mkdirSync(join(directory, ".changeset"));
      writeFileSync(join(directory, ".changeset", "config.json"), "{}");
      const report = await inspectMigration(directory, "changesets");
      const path = await writeMigrationConfig(directory, report);
      expect(readFileSync(path, "utf8")).toContain("publishing:");
      expect(parseConfig(readFileSync(path, "utf8")).publishing.npm.enabled).toBe(false);
      await expect(writeMigrationConfig(directory, report)).rejects.toThrow();
      await expect(writeMigrationConfig(directory, report, true)).resolves.toBe(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports an undetected migration source without claiming compatibility", async () => {
    const directory = mkdtempSync(join(tmpdir(), "semverge-migrate-none-"));
    try {
      const report = await inspectMigration(directory, "semantic-release");
      expect(report.detected).toBe(false);
      expect(report.confidence).toBe("none");
      expect(report.warnings[0]).toContain("No semantic-release");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
