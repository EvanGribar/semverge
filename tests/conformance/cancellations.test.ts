import { describe, expect, it } from "vitest";
import {
  advanceReleaseTransaction,
  createReleaseTransaction,
  mergeReleaseTransactions,
  recordReleaseTransactionEvent,
  summarizeReleaseTransaction
} from "../../src/transaction.js";

describe("Conformance: Cancellations, Interruptions and Transaction State", () => {
  it("tracks state machine transitions and prevents invalid backward transitions", () => {
    let tx = createReleaseTransaction({
      version: "1.0.0",
      sourceCommit: "sha-100",
      packageIds: ["pkg-a"],
      tagNames: ["v1.0.0"],
      npmEnabled: true
    });

    expect(tx.phase).toBe("planned");

    tx = advanceReleaseTransaction(tx, "approved", { key: "approve", kind: "approval", target: "release" });
    expect(tx.phase).toBe("approved");

    tx = advanceReleaseTransaction(tx, "prepared", { key: "prep", kind: "draft", target: "v1.0.0" });
    expect(tx.phase).toBe("prepared");

    tx = advanceReleaseTransaction(tx, "built", { key: "build", kind: "artifact", target: "bundle" });
    expect(tx.phase).toBe("built");

    expect(() => advanceReleaseTransaction(tx, "planned", { key: "revert", kind: "test", target: "fail" }))
      .toThrow("SemVerge cannot move a release transaction from built back to planned");
  });

  it("records failure during interrupted workflow runs and generates safe resumption advice", () => {
    let tx = createReleaseTransaction({
      version: "2.0.0",
      sourceCommit: "sha-200",
      packageIds: ["core"],
      tagNames: ["v2.0.0"],
      npmEnabled: true
    });

    tx = advanceReleaseTransaction(tx, "built", { key: "build_step", kind: "build", target: "dist" });
    tx = recordReleaseTransactionEvent(tx, {
      key: "npm_publish_step",
      kind: "publish",
      target: "npm:core",
      status: "failed",
      detail: "Network connection timeout during npm publish"
    });

    const summary = summarizeReleaseTransaction(tx);
    expect(summary.failure).toContain("Network connection timeout");
    expect(summary.safeNextAction).toContain("Resolve the recorded failure, then rerun the release workflow");
  });

  it("merges transaction states after a workflow cancellation and preserves recorded progress", () => {
    const initial = createReleaseTransaction({
      id: "tx_cancel_123",
      version: "3.0.0",
      sourceCommit: "sha-300",
      packageIds: ["web"],
      tagNames: ["v3.0.0"],
      npmEnabled: true
    });

    let state1 = advanceReleaseTransaction(initial, "prepared", { key: "draft_rel", kind: "release", target: "github" });
    state1 = recordReleaseTransactionEvent(state1, { key: "asset_upload", kind: "asset", target: "dist.zip", status: "completed" });
    state1.publishedPackages = ["web"];

    // A cancelled rerun reading the remote transaction marker merges state smoothly:
    const merged = mergeReleaseTransactions([state1], initial);
    expect(merged.id).toBe("tx_cancel_123");
    expect(merged.phase).toBe("prepared");
    expect(merged.publishedPackages).toEqual(["web"]);
    expect(summarizeReleaseTransaction(merged).safeNextAction).toContain("Resume tx_cancel_123");
  });
});
