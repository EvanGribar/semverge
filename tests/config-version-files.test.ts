import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";
import { readPackageVersion, updateVersionFiles } from "../src/version-files.js";

describe("configuration and version files", () => {
  it("parses simple progressive YAML configuration", () => {
    const config = parseConfig(`release:\n  branch: release/bot\n  prerelease: beta\nreadiness:\n  requiredLabels: [ship:ready]\noutputs:\n  customerNotes: docs/RELEASE.md\n`);
    expect(config.release.branch).toBe("release/bot");
    expect(config.release.prerelease).toBe("beta");
    expect(config.readiness.requiredLabels).toEqual(["ship:ready"]);
    expect(config.outputs.customerNotes).toBe("docs/RELEASE.md");
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
