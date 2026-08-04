import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";

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
  });

  it("reads structured customer and migration notes", () => {
    const change = parseChange({
      title: "fix(api): normalize an old response",
      source: "pull_request",
      body: `<!-- semverge\ntype: breaking\ncustomer: API responses now use the normalized shape.\nmigration: Update clients to read data.items.\n-->`
    });
    expect(change.kind).toBe("breaking");
    expect(change.breaking).toBe(true);
    expect(change.customerSummary).toBe("API responses now use the normalized shape.");
    expect(change.migration).toBe("Update clients to read data.items.");
  });

  it("allows ship:skip to suppress a release contribution", () => {
    const change = parseChange({ title: "feat: hidden experiment", source: "pull_request", labels: ["ship:skip"] });
    expect(change.skipped).toBe(true);
  });
});
