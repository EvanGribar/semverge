import { describe, expect, it } from "vitest";
import { parseChange, prereleaseChannelFromLabels, releaseChannelFromLabels } from "../src/changes.js";

describe("release change parsing", () => {
  it("uses product labels as a conventional-commit override", () => {
    const change = parseChange({
      title: "chore: improve export pipeline",
      source: "pull_request",
      labels: ["ship:feature"],
      number: 42,
      url: "https://github.com/EvanGribar/semverge/pull/42"
    });
    expect(change.kind).toBe("feature");
    expect(change.customerSummary).toBe("improve export pipeline");
    expect(change.customerCommunication).toEqual({ outcome: "improve export pipeline", impact: "new" });
  });

  it("builds structured customer communication from explicit metadata", () => {
    const change = parseChange({
      title: "feat(api): add bulk export",
      source: "pull_request",
      body: `<!-- semverge
type: feature
headline: Bulk project exports
customer: Legacy summary
outcome: Teams can download multiple projects in one step.
detail: Exported data keeps the existing format.
impact: new
action: No action is required.
audience: [teams, admins]
-->`
    });

    expect(change.customerCommunication).toEqual({
      headline: "Bulk project exports",
      outcome: "Teams can download multiple projects in one step.",
      detail: "Exported data keeps the existing format.",
      impact: "new",
      actionRequired: "No action is required.",
      audience: ["teams", "admins"]
    });
    expect(change.customerSummary).toBe("Teams can download multiple projects in one step.");
    expect(change.kind).toBe("feature");
  });

  it("keeps legacy customer metadata as the structured outcome", () => {
    const change = parseChange({
      title: "fix: repair empty exports",
      source: "pull_request",
      body: "<!-- semverge\ncustomer: Empty exports now complete reliably.\n-->"
    });

    expect(change.customerCommunication).toEqual({
      outcome: "Empty exports now complete reliably.",
      impact: "fixed"
    });
  });

  it("reads structured customer and migration notes", () => {
    const change = parseChange({
      title: "fix(api): normalize an old response",
      source: "pull_request",
      body: `<!-- semverge\ntype: breaking\ncustomer: API responses now use the normalized shape.\nimpact: changed\naction: Update clients to read data.items.\nmigration: Update clients to read data.items.\n-->`
    });
    expect(change.kind).toBe("breaking");
    expect(change.breaking).toBe(true);
    expect(change.customerSummary).toBe("API responses now use the normalized shape.");
    expect(change.migration).toBe("Update clients to read data.items.");
    expect(change.customerCommunication).toEqual({
      outcome: "API responses now use the normalized shape.",
      impact: "changed",
      actionRequired: "Update clients to read data.items."
    });
  });

  it("uses a conservative fallback for conventional and internal changes", () => {
    const fix = parseChange({ title: "fix: stabilize export retries", source: "commit" });
    const internal = parseChange({ title: "chore: refresh tooling", source: "commit" });

    expect(fix.customerCommunication).toEqual({ outcome: "stabilize export retries", impact: "fixed" });
    expect(internal.customerCommunication).toEqual({ outcome: "refresh tooling", impact: "improved" });
  });

  it("allows ship:skip to suppress a release contribution", () => {
    const change = parseChange({ title: "feat: hidden experiment", source: "pull_request", labels: ["ship:skip"] });
    expect(change.skipped).toBe(true);
  });

  it("maps named prerelease channel labels", () => {
    expect(prereleaseChannelFromLabels(["ship:rc"])).toBe("rc");
    expect(prereleaseChannelFromLabels(["SHIP:NIGHTLY"])).toBe("nightly");
    expect(prereleaseChannelFromLabels(["ship:canary"])).toBe("canary");
    expect(prereleaseChannelFromLabels(["ship:stable"])).toBeUndefined();
  });

  it("uses a configured channel label and preserves its branch policy", () => {
    const match = releaseChannelFromLabels(["ship:preview"], {
      preview: { label: "ship:preview", prerelease: "preview", branch: "preview" }
    });
    expect(match).toEqual({ name: "preview", policy: { label: "ship:preview", prerelease: "preview", branch: "preview" } });
    expect(prereleaseChannelFromLabels(["ship:preview"], {
      preview: { label: "ship:preview", prerelease: "preview", branch: "preview" }
    })).toBe("preview");
  });
});
