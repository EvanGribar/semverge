import { describe, expect, it } from "vitest";
import { bumpVersion, compareVersions, parseVersion } from "../src/semver.js";

describe("semantic versions", () => {
  it("orders prereleases before the stable version", () => {
    expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareVersions("1.0.0-beta.10", "1.0.0")).toBe(-1);
  });

  it("bumps stable and prerelease versions", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.3.0", "patch", "beta")).toBe("1.3.1-beta.0");
    expect(bumpVersion("1.3.1-beta.0", "none", "beta")).toBe("1.3.1-beta.1");
  });

  it("rejects malformed leading-zero prerelease identifiers", () => {
    expect(parseVersion("1.0.0-beta.01")).toBeNull();
  });
});
