import { describe, expect, it } from "vitest";
import { channelBaseBranch, parseConfig, validateConfig, validateConfigContent, withChannelPolicy } from "../src/config.js";
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

  it("parses configurable channel labels and branch scoping", () => {
    const content = `release:\n  channels:\n    preview:\n      label: ship:preview\n      prerelease: preview\n    nightly:\n      label: ship:nightly\n      prerelease: nightly\n      branch: nightly\n`;
    const config = parseConfig(content);
    expect(config.release.channels.preview).toEqual({ label: "ship:preview", prerelease: "preview" });
    expect(config.release.channels.nightly).toEqual({ label: "ship:nightly", prerelease: "nightly", branch: "nightly" });
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("release:\n  channels:\n    preview:\n      label: ship:preview\n")).toContainEqual({
      path: "release.channels.preview.prerelease",
      severity: "error",
      message: "must be a non-empty string"
    });
  });

  it("parses isolated channel pipeline branches and tag namespaces", () => {
    const content = `release:\n  channels:\n    nightly:\n      label: ship:nightly\n      prerelease: nightly\n      branch: nightly\n      baseBranch: release/1.x\n      releaseBranch: semverge/release/nightly\n      tagPrefix: nightly-v\n`;
    const config = parseConfig(content);
    expect(config.release.channels.nightly).toEqual({
      label: "ship:nightly",
      prerelease: "nightly",
      branch: "nightly",
      baseBranch: "release/1.x",
      releaseBranch: "semverge/release/nightly",
      tagPrefix: "nightly-v"
    });
    expect(channelBaseBranch(config, "nightly", "main")).toBe("release/1.x");
    expect(withChannelPolicy(config, "nightly").release).toMatchObject({
      branch: "semverge/release/nightly",
      tagPrefix: "nightly-v",
      prerelease: "nightly"
    });
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("release:\n  channels:\n    nightly:\n      label: ship:nightly\n      prerelease: nightly\n      releaseBranch: ''\n")).toContainEqual({
      path: "release.channels.nightly.releaseBranch",
      severity: "error",
      message: "must be a non-empty string when provided"
    });
  });

  it("keeps delayed monitoring opt-in and validates its observation window", () => {
    const content = `health:
  monitoring:
    enabled: true
    windowHours: 48
    comment: false
    checkRun: true
`;
    const config = parseConfig(content);
    expect(config.health.monitoring).toEqual({ enabled: true, windowHours: 48, comment: false, checkRun: true });
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("health:\n  monitoring:\n    enabled: true\n    windowHours: 0\n")).toContainEqual({
      path: "health.monitoring.windowHours",
      severity: "error",
      message: "must be greater than zero"
    });
    expect(parseConfig("").health.monitoring).toEqual({ enabled: false, windowHours: 24, comment: true, checkRun: false });
  });

  it("parses and validates independent dependency release policies", () => {
    const content = `monorepo:\n  mode: independent\n  dependencyPolicy:\n    dependencies: patch\n    devDependencies: none\n    peerDependencies: major\n    optionalDependencies: minor\n`;
    const config = parseConfig(content);
    expect(config.monorepo.dependencyPolicy).toEqual({ dependencies: "patch", devDependencies: "none", peerDependencies: "major", optionalDependencies: "minor" });
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("monorepo:\n  dependencyPolicy:\n    peerDependencies: breaking\n")).toContainEqual({
      path: "monorepo.dependencyPolicy.peerDependencies",
      severity: "error",
      message: "must be one of: none, patch, minor, major"
    });
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

  it("parses opt-in Python and Rust registry publishing policies", () => {
    const content = `publishing:
  python:
    enabled: true
    command: python -m twine upload dist/*
  rust:
    enabled: true
    command: cargo publish --locked
`;
    const config = parseConfig(content);
    expect(config.publishing.python).toEqual({ enabled: true, command: "python -m twine upload dist/*", idempotency: "registry" });
    expect(config.publishing.rust).toEqual({ enabled: true, command: "cargo publish --locked", idempotency: "registry" });
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("publishing:\n  python:\n    enabled: true\n    command: python -m build\n")).toContainEqual({
      path: "publishing.python.idempotency",
      severity: "error",
      message: "is required for custom python commands; choose registry or declared"
    });
    expect(validateConfigContent("publishing:\n  rust:\n    enabled: true\n    command: cargo publish --dry-run\n")).toContainEqual({
      path: "publishing.rust.idempotency",
      severity: "error",
      message: "is required for custom rust commands; choose registry or declared"
    });
  });

  it("parses opt-in OCI image publication with explicit retry semantics", () => {
    const content = `publishing:
  oci:
    enabled: true
    images:
      - ghcr.io/acme/semverge
    command: docker push {image}:{version}
    idempotency: registry
`;
    const config = parseConfig(content);
    expect(config.publishing.oci).toEqual({
      enabled: true,
      images: ["ghcr.io/acme/semverge"],
      command: "docker push {image}:{version}",
      idempotency: "registry"
    });
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("publishing:\n  oci:\n    enabled: true\n    images: []\n")).toContainEqual({
      path: "publishing.oci.images",
      severity: "error",
      message: "must contain at least one repository when OCI publishing is enabled"
    });
    expect(validateConfigContent("publishing:\n  oci:\n    enabled: true\n    images: [ghcr.io/acme/semverge]\n    command: docker push\n")).toContainEqual({
      path: "publishing.oci.idempotency",
      severity: "error",
      message: "is required for custom OCI commands; choose registry or declared"
    });
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
