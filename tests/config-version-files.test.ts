import { describe, expect, it } from "vitest";
import { parseConfig, validateConfig, validateConfigContent } from "../src/config.js";
import { readPackageVersion, updateVersionFiles } from "../src/version-files.js";

describe("configuration and version files", () => {
  it("parses simple progressive YAML configuration", () => {
    const config = parseConfig(`release:\n  branch: release/bot\n  prerelease: beta\n  promotion: stable\nreadiness:\n  requiredLabels: [ship:ready]\noutputs:\n  customerNotes: docs/RELEASE.md\n`);
    expect(config.release.branch).toBe("release/bot");
    expect(config.release.prerelease).toBe("beta");
    expect(config.release.promotion).toBe("stable");
    expect(config.readiness.requiredLabels).toEqual(["ship:ready"]);
    expect(config.outputs.customerNotes).toBe("docs/RELEASE.md");
    expect(config.publishing.npm.idempotency).toBe("registry");
  });

  it("rejects unknown release promotion policies", () => {
    expect(validateConfigContent("release:\n  promotion: nightly\n")).toContainEqual({
      path: "release.promotion",
      severity: "error",
      message: "must be one of: stable"
    });
  });

  it("requires an explicit idempotency contract for custom npm commands", () => {
    const content = "publishing:\n  npm:\n    enabled: true\n    command: pnpm publish\n";
    const config = parseConfig(content);
    expect(config.publishing.npm.idempotency).toBeUndefined();
    expect(validateConfigContent(content).some((issue) => issue.path === "publishing.npm.idempotency" && issue.severity === "error")).toBe(true);
    expect(validateConfig(config).some((issue) => issue.path === "publishing.npm.idempotency" && issue.severity === "error")).toBe(true);
    expect(parseConfig(`${content}    idempotency: declared\n`).publishing.npm.idempotency).toBe("declared");
  });

  it("keeps npm provenance opt-in and rejects unsafe command combinations", () => {
    const content = "publishing:\n  npm:\n    enabled: true\n    provenance: true\n";
    const config = parseConfig(content);
    expect(config.publishing.npm.provenance).toBe(true);
    expect(validateConfigContent(content)).not.toContainEqual(expect.objectContaining({ path: "publishing.npm.provenance", severity: "error" }));

    const custom = "publishing:\n  npm:\n    enabled: true\n    provenance: true\n    command: pnpm publish\n    idempotency: declared\n";
    expect(validateConfigContent(custom)).toContainEqual({
      path: "publishing.npm.provenance",
      severity: "error",
      message: "requires the default npm publish command; custom commands must own their provenance flags"
    });
    expect(validateConfigContent("publishing:\n  npm:\n    provenance: true\n")).toContainEqual({
      path: "publishing.npm.provenance",
      severity: "error",
      message: "requires publishing.npm.enabled: true"
    });
  });

  it("updates package.json and npm lockfile root versions", () => {
    const changes = updateVersionFiles({
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, version: "1.0.0", packages: { "": { name: "demo", version: "1.0.0" } } })
    }, "1.1.0");
    expect(changes).toHaveLength(2);
    expect(JSON.parse(changes[0]?.content ?? "{}").version).toBe("1.1.0");
    expect(JSON.parse(changes[1]?.content ?? "{}").packages[""].version).toBe("1.1.0");
    expect(readPackageVersion(changes[0]?.content ?? "{}")).toBe("1.1.0");
  });

  it("maps legacy rollback workflow configuration to a neutral custom check", () => {
    const config = parseConfig("health:\n  workflows:\n    - name: Rollback production\n      purpose: rollback\n");
    expect(config.health.workflows).toEqual([{ name: "Rollback production", purpose: "custom", required: true }]);
    expect("hotfixWindowHours" in config.health).toBe(false);
  });
});
