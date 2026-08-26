import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { GitHubClient } from "../src/github.js";
import { createReleaseTransaction, releaseTransactionMarker, type ReleaseTransaction } from "../src/transaction.js";
import { parseReleaseVerificationTarget, verificationReportJson, verificationReportMarkdown, verifyRelease } from "../src/verification.js";

const config = parseConfig("");

function complete(transaction: ReleaseTransaction): ReleaseTransaction {
  return { ...transaction, phase: "completed", ready: true, published: true };
}

function release(transaction: ReleaseTransaction, assets: Array<{ name: string; browser_download_url?: string }> = []): { id: number; tag_name: string; html_url: string; upload_url: string; body: string; target_commitish: string; assets: Array<{ name: string; browser_download_url?: string }> } {
  return {
    id: 1,
    tag_name: transaction.tagNames[0] ?? `v${transaction.version}`,
    html_url: "https://github.com/demo/repo/releases/tag/v2.4.0",
    upload_url: "https://uploads.github.com/demo",
    body: releaseTransactionMarker(transaction),
    target_commitish: transaction.sourceCommit,
    assets
  };
}

function client(sourceCommit: string, assetBytes?: Uint8Array): GitHubClient {
  const value = new GitHubClient("", "demo/repo");
  vi.spyOn(value, "resolveTagCommit").mockResolvedValue(sourceCommit);
  if (assetBytes) {
    vi.spyOn(value, "downloadReleaseAsset").mockResolvedValue(assetBytes);
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("release verification", () => {
  it("verifies the transaction, source commit, and release asset digest", async () => {
    const artifact = new Uint8Array(Buffer.from("artifact"));
    const digest = createHash("sha256").update(artifact).digest("hex");
    const transaction = complete(createReleaseTransaction({
      id: "release_01JVERIFY",
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: ["demo"],
      tagNames: ["v2.4.0"],
      artifactDigests: { "dist/demo.tgz": digest },
      npmEnabled: false
    }));
    const report = await verifyRelease({
      target: "v2.4.0",
      cwd: process.cwd(),
      config,
      client: client(transaction.sourceCommit, artifact),
      release: release(transaction, [{ name: "demo.tgz", browser_download_url: "https://downloads.example/demo.tgz" }]),
      transaction
    });

    expect(report.status).toBe("verified");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Release transaction", status: "verified" }),
      expect.objectContaining({ name: "Git tag and source commit", status: "verified" }),
      expect.objectContaining({ name: "Artifact dist/demo.tgz", status: "verified" })
    ]));
    expect(verificationReportMarkdown(report)).toContain("Release v2.4.0 is verified.");
    expect(JSON.parse(verificationReportJson(report))).toMatchObject({ schemaVersion: 1, status: "verified", tag: "v2.4.0" });
  });

  it("identifies an artifact digest mismatch", async () => {
    const transaction = complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: ["demo"],
      tagNames: ["v2.4.0"],
      artifactDigests: { "dist/demo.tgz": "a".repeat(64) },
      npmEnabled: false
    }));
    const report = await verifyRelease({
      target: "2.4.0",
      cwd: process.cwd(),
      config,
      client: client(transaction.sourceCommit, new Uint8Array(Buffer.from("different"))),
      release: release(transaction, [{ name: "demo.tgz" }]),
      transaction
    });

    expect(report.status).toBe("mismatch");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Artifact dist/demo.tgz", status: "mismatch" })
    ]));
  });

  it("fails when the Git tag resolves to a different source commit", async () => {
    const transaction = complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: ["demo"],
      tagNames: ["v2.4.0"],
      npmEnabled: false
    }));
    const report = await verifyRelease({
      target: "v2.4.0",
      cwd: process.cwd(),
      config,
      client: client("other-commit"),
      release: release(transaction),
      transaction
    });

    expect(report.status).toBe("mismatch");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Git tag and source commit", status: "mismatch", observed: "other-commit" })
    ]));
  });

  it("rejects a GitHub release tag that is not recorded by the transaction", async () => {
    const transaction = complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: ["demo"],
      tagNames: ["v2.3.0"],
      npmEnabled: false
    }));
    const report = await verifyRelease({
      target: "v2.4.0",
      cwd: process.cwd(),
      config,
      client: client(transaction.sourceCommit),
      release: release({ ...transaction, tagNames: ["v2.4.0"] }),
      transaction
    });

    expect(report.status).toBe("mismatch");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "GitHub release", status: "mismatch" })
    ]));
  });

  it("distinguishes an unavailable package provider from an integrity mismatch", async () => {
    const transaction = complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: ["demo"],
      tagNames: ["v2.4.0"],
      publishingTargets: ["npm"],
      npmEnabled: true,
      npmProvenance: true
    }));
    const report = await verifyRelease({
      target: "v2.4.0",
      cwd: process.cwd(),
      config,
      client: client(transaction.sourceCommit),
      release: release(transaction),
      transaction,
      manifest: { mode: "single", version: "2.4.0", packages: [{ id: "demo", name: "demo", ecosystem: "node", version: "2.4.0" }] },
      npmRunner: vi.fn(async () => {
        throw new Error("registry is offline");
      })
    });

    expect(report.status).toBe("unavailable");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "npm demo@2.4.0", status: "unavailable" }),
      expect.objectContaining({ name: "npm provenance demo@2.4.0", status: "unavailable" })
    ]));
  });

  it("checks recorded OCI digests and reports unsupported targets separately", async () => {
    const image = "ghcr.io/acme/demo";
    const digest = `sha256:${"b".repeat(64)}`;
    const transaction = complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: [],
      tagNames: ["v2.4.0"],
      publishingTargets: [`oci:${image}`, "custom-provider"],
      ociImages: [image],
      alreadyPublishedOciImages: [image],
      ociDigests: { [image]: digest },
      npmEnabled: false
    }));
    const registryFetcher = vi.fn(async () => new Response("manifest", { status: 200, headers: { "docker-content-digest": digest } }));
    const report = await verifyRelease({
      target: "https://github.com/demo/repo/releases/tag/v2.4.0",
      cwd: process.cwd(),
      config,
      client: client(transaction.sourceCommit),
      release: release(transaction),
      transaction,
      registryFetcher
    });

    expect(report.status).toBe("unavailable");
    expect(report.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: `OCI ${image}:2.4.0`, status: "verified" }),
      expect.objectContaining({ name: "Publication target custom-provider", status: "unavailable" })
    ]));
    expect(registryFetcher).toHaveBeenCalledTimes(2);
  });

  it("parses release URLs and transaction IDs without adding time-varying fields", () => {
    expect(parseReleaseVerificationTarget("https://github.com/demo/repo/releases/tag/v2.4.0", config)).toMatchObject({ tag: "v2.4.0", version: "2.4.0" });
    expect(parseReleaseVerificationTarget("release_01JVERIFY", config)).toEqual({ input: "release_01JVERIFY", transactionId: "release_01JVERIFY" });
  });
});
