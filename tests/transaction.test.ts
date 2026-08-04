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

    expect(state.schemaVersion).toBe(2);
    expect(state.phase).toBe("prepared");
    expect(parsedBody?.id).toBe(state.id);
    expect(summary.safeNextAction).toContain(state.id);
    expect(summary.publishedPackages).toBe("0/1");
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
