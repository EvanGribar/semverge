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

  it("rejects malformed leading-zero core and prerelease identifiers", () => {
    expect(parseVersion("01.0.0")).toBeNull();
    expect(parseVersion("1.01.0")).toBeNull();
    expect(parseVersion("1.0.01")).toBeNull();
    expect(parseVersion("1.0.0-beta.01")).toBeNull();
    expect(parseVersion("v1.0.0")).not.toBeNull();
  });

  it("uses SemVer precedence and ignores build metadata", () => {
    expect(compareVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
  });
});
