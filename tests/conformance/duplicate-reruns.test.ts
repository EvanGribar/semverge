import { describe, expect, it } from "vitest";
import { createReleaseTransaction, recordReleaseTransactionEvent, summarizeReleaseTransaction } from "../../src/transaction.js";

describe("Conformance: Duplicate Reruns and Idempotency", () => {
  it("deduplicates completed event keys in release transaction log during duplicate reruns", () => {
    let tx = createReleaseTransaction({
      version: "1.5.0",
      sourceCommit: "sha-rerun",
      packageIds: ["pkg-a", "pkg-b"],
      tagNames: ["v1.5.0"],
      npmEnabled: true
    });

    tx = recordReleaseTransactionEvent(tx, {
      key: "publish_npm_pkg-a",
      kind: "publish",
      target: "npm:pkg-a",
      status: "completed"
    });

    expect(tx.events).toHaveLength(1);

    // Duplicate rerun attempts to record the exact same completed event key
    const rerunTx = recordReleaseTransactionEvent(tx, {
      key: "publish_npm_pkg-a",
      kind: "publish",
      target: "npm:pkg-a",
      status: "completed"
    });

    expect(rerunTx.events).toHaveLength(1);
    expect(rerunTx).toBe(tx); // Reference equality when skipped
  });

  it("skips already published package side-effects when initial transaction state indicates prior publication", () => {
    const tx = createReleaseTransaction({
      version: "2.0.0",
      sourceCommit: "sha-pub",
      packageIds: ["already-published-pkg"],
      tagNames: ["v2.0.0"],
      alreadyPublishedPackageIds: ["already-published-pkg"],
      npmEnabled: true
    });

    expect(tx.publishedPackages).toEqual(["already-published-pkg"]);
    const summary = summarizeReleaseTransaction(tx);
    expect(summary.publishedPackages).toBe("1/1");
  });

  it("skips already published OCI image side-effects on duplicate workflow rerun", () => {
    const tx = createReleaseTransaction({
      version: "1.0.0",
      sourceCommit: "sha-oci",
      packageIds: ["app"],
      tagNames: ["v1.0.0"],
      ociImages: ["ghcr.io/demo/app"],
      alreadyPublishedOciImages: ["ghcr.io/demo/app"],
      npmEnabled: false
    });

    expect(tx.publishedOciImages).toEqual(["ghcr.io/demo/app"]);
    const summary = summarizeReleaseTransaction(tx);
    expect(summary.publishedOciImages).toBe("1/1");
  });
});
