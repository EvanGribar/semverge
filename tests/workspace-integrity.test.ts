import { describe, expect, it } from "vitest";
import { assertWorkspaceAtCommit } from "../src/workspace-integrity.js";

describe("publication workspace integrity", () => {
  it("accepts a workspace checked out at the release merge commit", async () => {
    await expect(assertWorkspaceAtCommit("/workspace", "0123456789abcdef0123456789abcdef01234567", async () => "0123456789abcdef0123456789abcdef01234567")).resolves.toBeUndefined();
  });

  it("rejects a workspace at a different commit", async () => {
    await expect(assertWorkspaceAtCommit("/workspace", "0123456789abcdef0123456789abcdef01234567", async () => "fedcba9876543210fedcba9876543210fedcba98"))
      .rejects.toThrow("requires GITHUB_WORKSPACE at release merge commit");
  });

  it("rejects a workspace without a readable git checkout", async () => {
    await expect(assertWorkspaceAtCommit("/workspace", "0123456789abcdef0123456789abcdef01234567", async () => { throw new Error("not a repository"); }))
      .rejects.toThrow("could not read /workspace with git rev-parse HEAD");
  });
});
