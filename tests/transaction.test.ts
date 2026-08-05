import { describe, expect, it } from "vitest";
import {
  advanceReleaseTransaction,
  createReleaseTransaction,
  mergeReleaseTransactions,
  parseReleaseTransaction,
  parseReleaseTransactionBody,
  recordReleaseTransactionEvent,
  releaseTransactionBody,
  releaseTransactionMarker,
  summarizeReleaseTransaction,
  updateReleaseTransactionBody
} from "../src/transaction.js";

describe("release transaction state", () => {
  it("advances monotonically and records idempotent side effects", () => {
    let state = createReleaseTransaction({
      id: "release_01JTEST",
      version: "2.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["one", "two"],
      tagNames: ["v2.0.0"],
      npmEnabled: true,
      now: "2026-08-04T00:00:00.000Z"
    });
    state = advanceReleaseTransaction(state, "approved", { key: "approval", kind: "approval-verified", target: "merge-sha", now: "2026-08-04T00:01:00.000Z" });
    state = advanceReleaseTransaction(state, "prepared", { key: "plan", kind: "release-plan-prepared", target: "2.0.0", now: "2026-08-04T00:02:00.000Z" });
    state = recordReleaseTransactionEvent(state, { key: "package:one", kind: "package-published", target: "@demo/one", now: "2026-08-04T00:03:00.000Z" });
    state = recordReleaseTransactionEvent(state, { key: "package:one", kind: "package-published", target: "@demo/one", now: "2026-08-04T00:04:00.000Z" });

    expect(state.phase).toBe("prepared");
    expect(state.events.filter((event) => event.key === "package:one" && event.status === "completed")).toHaveLength(1);
    expect(() => advanceReleaseTransaction(state, "approved", { key: "backward", kind: "invalid", target: "release" })).toThrow("cannot move");
  });

  it("records artifact SHA-256 digests and rejects changed retry inputs", () => {
    const digest = "a".repeat(64);
    const state = createReleaseTransaction({
      id: "release_01JDIGEST",
      version: "2.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v2.0.0"],
      artifactDigests: { "dist/demo.tgz": digest },
      npmEnabled: false,
      now: "2026-08-04T00:00:00.000Z"
    });
    const parsed = parseReleaseTransactionBody(releaseTransactionBody("notes", state));

    expect(parsed?.artifactDigests).toEqual({ "dist/demo.tgz": digest });
    expect(summarizeReleaseTransaction(state).artifactDigests).toEqual({ "dist/demo.tgz": digest });
    expect(releaseTransactionBody("notes", state)).toContain(`Artifact \`dist/demo.tgz\`: \`${digest}\``);
    const changed = createReleaseTransaction({
      id: state.id,
      version: "2.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v2.0.0"],
      artifactDigests: { "dist/demo.tgz": "b".repeat(64) },
      npmEnabled: false
    });
    expect(() => mergeReleaseTransactions([changed], state)).toThrow("different artifact digest");
    expect(() => createReleaseTransaction({
      version: "2.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v2.0.0"],
      artifactDigests: { "dist/demo.tgz": "not-a-digest" },
      npmEnabled: false
    })).toThrow("SHA-256");
  });

  it("merges partial progress and retains the durable transaction id", () => {
    const expected = createReleaseTransaction({
      id: "release_expected",
      version: "1.2.3",
      sourceCommit: "merge-sha",
      packageIds: ["one", "two"],
      tagNames: ["v1.2.3"],
      npmEnabled: true,
      now: "2026-08-04T00:00:00.000Z"
    });
    const first = advanceReleaseTransaction({ ...expected, id: "release_actual", publishedPackages: [] }, "published", { key: "package:one", kind: "package-published", target: "@demo/one", now: "2026-08-04T00:01:00.000Z" });
    first.publishedPackages.push("one");
    const second = recordReleaseTransactionEvent({ ...expected, id: "release_actual", publishedPackages: [] }, { key: "package:two", kind: "package-published", target: "@demo/two", now: "2026-08-04T00:02:00.000Z" });
    second.publishedPackages.push("two");

    const merged = mergeReleaseTransactions([first, second], expected);
    expect(merged.id).toBe("release_actual");
    expect(merged.phase).toBe("published");
    expect(merged.publishedPackages).toEqual(["one", "two"]);
    expect(merged.events.map((event) => event.key)).toEqual(["package:one", "package:two"]);
  });

  it("upgrades legacy markers and exposes a safe recovery summary", () => {
    const legacy = {
      schemaVersion: 1,
      version: "1.0.1",
      packageIds: ["demo"],
      tagNames: ["v1.0.1"],
      npmEnabled: true,
      publishedPackages: [],
      uploadedAssets: { "v1.0.1": [] },
      ready: false,
      published: false
    };
    const state = parseReleaseTransaction(legacy);
    const parsedBody = parseReleaseTransactionBody(`${releaseTransactionMarker(state)}\nnotes`);
    const summary = summarizeReleaseTransaction(state);

    expect(state.schemaVersion).toBe(6);
    expect(state.phase).toBe("prepared");
    expect(parsedBody?.id).toBe(state.id);
    expect(summary.safeNextAction).toContain(state.id);
    expect(summary.publishedPackages).toBe("0/1");

    const v2 = { ...state, schemaVersion: 2, artifactDigests: undefined };
    expect(parseReleaseTransaction(v2).schemaVersion).toBe(6);
    expect(parseReleaseTransaction(v2).artifactDigests).toEqual({});
  });

  it("binds npm provenance intent to the retryable transaction", () => {
    const expected = createReleaseTransaction({
      id: "release_01JPROVENANCE",
      version: "1.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v1.0.0"],
      npmEnabled: true,
      npmProvenance: true
    });
    const changed = createReleaseTransaction({
      id: expected.id,
      version: expected.version,
      sourceCommit: expected.sourceCommit,
      packageIds: expected.packageIds,
      tagNames: expected.tagNames,
      npmEnabled: true,
      npmProvenance: false
    });

    expect(() => mergeReleaseTransactions([changed], expected)).toThrow("different release or publishing configuration");
    expect(parseReleaseTransaction({ ...expected, schemaVersion: 3, npmProvenance: undefined }).npmProvenance).toBe(false);
  });

  it("binds non-npm registry targets and intentionally unmanaged packages", () => {
    const expected = createReleaseTransaction({
      id: "release_01JREGISTRY",
      version: "1.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["python", "rust"],
      tagNames: ["v1.0.0"],
      publishingTargets: ["python"],
      alreadyPublishedPackageIds: ["rust"],
      npmEnabled: false
    });
    expect(expected.publishingTargets).toEqual(["python"]);
    expect(expected.publishedPackages).toEqual(["rust"]);
    expect(parseReleaseTransactionBody(releaseTransactionMarker(expected))?.publishingTargets).toEqual(["python"]);

    const changed = createReleaseTransaction({
      ...expected,
      publishingTargets: ["rust"]
    });
    expect(() => mergeReleaseTransactions([changed], expected)).toThrow("different release or publishing configuration");
  });

  it("binds OCI image repositories and merges their durable publication progress", () => {
    const expected = createReleaseTransaction({
      id: "release_01JOCI",
      version: "1.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v1.0.0"],
      ociImages: ["ghcr.io/acme/semverge"],
      alreadyPublishedPackageIds: ["demo"],
      npmEnabled: false
    });
    const partial = recordReleaseTransactionEvent({ ...expected, publishedOciImages: [] }, {
      key: "oci:ghcr.io/acme/semverge",
      kind: "oci-image-published",
      target: "ghcr.io/acme/semverge:1.0.0",
      now: "2026-08-04T00:01:00.000Z"
    });
    partial.publishedOciImages.push("ghcr.io/acme/semverge");

    expect(expected.publishingTargets).toEqual(["oci:ghcr.io/acme/semverge"]);
    expect(mergeReleaseTransactions([partial], expected).publishedOciImages).toEqual(["ghcr.io/acme/semverge"]);
    expect(parseReleaseTransactionBody(releaseTransactionMarker(partial))?.ociImages).toEqual(["ghcr.io/acme/semverge"]);
    expect(summarizeReleaseTransaction(partial).publishedOciImages).toBe("1/1");
    expect(releaseTransactionBody("notes", partial)).toContain("OCI images published: **1/1**");
  });

  it("keeps a failure until the failed side effect succeeds on retry", () => {
    const state = createReleaseTransaction({
      id: "release_01JFAIL",
      version: "1.0.0",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v1.0.0"],
      npmEnabled: true,
      now: "2026-08-04T00:00:00.000Z"
    });
    const failed = recordReleaseTransactionEvent(state, { key: "package:demo", kind: "package-published", target: "demo", status: "failed", detail: "publish failed", now: "2026-08-04T00:01:00.000Z" });
    const otherSuccess = recordReleaseTransactionEvent(failed, { key: "draft:v1.0.0", kind: "release-draft-prepared", target: "v1.0.0", now: "2026-08-04T00:02:00.000Z" });
    const retrySuccess = recordReleaseTransactionEvent(otherSuccess, { key: "package:demo", kind: "package-published", target: "demo", now: "2026-08-04T00:03:00.000Z" });

    expect(otherSuccess.failure?.message).toBe("publish failed");
    expect(retrySuccess.failure).toBeUndefined();
    expect(retrySuccess.events.filter((event) => event.key === "package:demo")).toHaveLength(2);
  });

  it("rewrites the marker and human summary without losing customer notes", () => {
    const state = createReleaseTransaction({
      id: "release_01JBODY",
      version: "1.2.3",
      sourceCommit: "merge-sha",
      packageIds: ["demo"],
      tagNames: ["v1.2.3"],
      npmEnabled: false,
      now: "2026-08-04T00:00:00.000Z"
    });
    const body = releaseTransactionBody("# What's new\n\nCustomer notes", state);
    const completed = advanceReleaseTransaction(state, "completed", {
      key: "done",
      kind: "release-completed",
      target: state.version,
      now: "2026-08-04T00:01:00.000Z"
    });
    const updated = updateReleaseTransactionBody(body, completed);

    expect(updated).toContain("Customer notes");
    expect(updated).toContain("State: **completed**");
    expect(parseReleaseTransactionBody(updated)?.phase).toBe("completed");
    expect(updated.match(/### SemVerge transaction/g)).toHaveLength(1);
  });
});
