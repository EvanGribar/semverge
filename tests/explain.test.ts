import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { explainReleasePlan } from "../src/explain.js";
import { buildReleasePlan } from "../src/release.js";

describe("release explanations", () => {
  it("explains the version decision, readiness path, and recovery path", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.4.0",
      config: { ...DEFAULT_CONFIG, readiness: { ...DEFAULT_CONFIG.readiness, requiredLabels: ["ship:ready"] } },
      changes: [parseChange({ title: "feat: add export", source: "commit" })]
    });

    const explanation = explainReleasePlan(plan);
    expect(explanation).toContain("Version decision: 1.4.0 -> 1.5.0 (minor release).");
    expect(explanation).toContain("feat: add export: minor release.");
    expect(explanation).toContain("Readiness: blocked.");
    expect(explanation).toContain("Missing labels: ship:ready.");
    expect(explanation).toContain("semverge recover <release-id>");
  });

  it("explains when no release is needed", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.4.0",
      changes: [parseChange({ title: "chore: refresh tooling", source: "commit" })]
    });

    const explanation = explainReleasePlan(plan);
    expect(explanation).toContain("no release-worthy changes were found");
    expect(explanation).toContain("does not create a release PR");
  });

  it("explains an explicit prerelease promotion", () => {
    const plan = buildReleasePlan({
      currentVersion: "1.4.0-beta.2",
      changes: [parseChange({ title: "fix: stabilize beta", source: "pull_request", labels: ["ship:stable"] })]
    });

    const explanation = explainReleasePlan(plan);
    expect(explanation).toContain("Release channel: stable (promoted from 1.4.0-beta.2)");
    expect(explanation).toContain("The prerelease was explicitly promoted to the stable channel.");
  });
});
