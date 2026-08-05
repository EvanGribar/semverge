import { describe, expect, it } from "vitest";
import { parseChange } from "../../src/changes.js";

describe("Conformance: Git Commit History Modes", () => {
  describe("Squash History Commit Structure", () => {
    it("parses conventional squash PR title with scope and breaking exclamation mark", () => {
      const change = parseChange({
        title: "feat(auth)!: replace legacy session cookie with JWT tokens (#142)",
        source: "pull_request",
        number: 142,
        url: "https://github.com/demo/repo/pull/142",
        body: "Migrated session storage to signed web tokens.\n<!-- semverge\ncustomer: JWT Authentication migration\n-->"
      });

      expect(change.kind).toBe("feature");
      expect(change.scope).toBe("auth");
      expect(change.breaking).toBe(true);
      expect(change.description).toBe("replace legacy session cookie with JWT tokens (#142)");
      expect(change.customerSummary).toBe("JWT Authentication migration");
      expect(change.number).toBe(142);
    });

    it("extracts breaking changes from multi-line BREAKING CHANGE: footers in squashed commit bodies", () => {
      const change = parseChange({
        title: "refactor(database): update query builder API",
        source: "commit",
        sha: "a1b2c3d4e5f6",
        body: "Refactored internal query generation.\n\nBREAKING CHANGE: The select() method now returns a Promise instead of a raw Query object."
      });

      expect(change.kind).toBe("internal");
      expect(change.scope).toBe("database");
      expect(change.breaking).toBe(true);
    });

    it("respects skip directives in squashed commit body metadata and labels", () => {
      const changeWithMetadata = parseChange({
        title: "chore: update documentation badges",
        source: "pull_request",
        body: "<!-- semverge\nskip: true\n-->"
      });
      expect(changeWithMetadata.skipped).toBe(true);

      const changeWithLabel = parseChange({
        title: "docs: fix typo in README",
        source: "pull_request",
        labels: ["ship:skip"]
      });
      expect(changeWithLabel.skipped).toBe(true);
    });
  });

  describe("Merge History Commit Structure", () => {
    it("parses merge commits linking PR numbers, metadata and author info", () => {
      const change = parseChange({
        title: "feat(billing): integrate Stripe payment provider (#88)",
        source: "pull_request",
        number: 88,
        url: "https://github.com/demo/repo/pull/88",
        sha: "m1e2r3g4e5",
        author: "alice",
        body: "<!-- semverge\ncustomer: Added Stripe payment support\n-->"
      });

      expect(change.kind).toBe("feature");
      expect(change.customerSummary).toBe("Added Stripe payment support");
      expect(change.author).toBe("alice");
      expect(change.sha).toBe("m1e2r3g4e5");
    });
  });

  describe("Rebase History Commit Structure", () => {
    it("parses a series of linear rebased commits without merge PR overhead", () => {
      const commits = [
        { title: "fix(core): handle null pointer in state store", sha: "c001", files: ["src/state.ts"] },
        { title: "feat(cli): add --json output flag", sha: "c002", files: ["src/cli.ts"] },
        { title: "docs(readme): add troubleshooting section", sha: "c003", files: ["README.md"] }
      ];

      const changes = commits.map((input) => parseChange({
        title: input.title,
        source: "commit",
        sha: input.sha,
        files: input.files
      }));

      expect(changes).toHaveLength(3);
      expect(changes[0]).toMatchObject({ kind: "fix", scope: "core", breaking: false, sha: "c001" });
      expect(changes[1]).toMatchObject({ kind: "feature", scope: "cli", breaking: false, sha: "c002" });
      expect(changes[2]).toMatchObject({ kind: "docs", scope: "readme", breaking: false, sha: "c003" });
    });
  });
});
