import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, parse, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { GitHubClient } from "../src/github.js";
import { createReleaseTransaction, releaseTransactionMarker, type ReleaseTransaction } from "../src/transaction.js";
import { parseReleaseVerificationTarget, verificationReportJson, verificationReportMarkdown, verifyRelease, type VerifyReleaseInput } from "../src/verification.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(), realpath: vi.fn() };
});

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

beforeEach(() => {
  vi.mocked(fs.realpath).mockImplementation(async (path) => resolve(String(path)));
  vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error("missing fixture"), { code: "ENOENT" }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.realpath).mockReset();
  vi.mocked(fs.readFile).mockReset();
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

  describe("local path containment", () => {
    const workspace = resolve("verification-fixture/workspace");

    const containedTransaction = (artifactDigests: Record<string, string>) => complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: [],
      tagNames: ["v2.4.0"],
      artifactDigests,
      npmEnabled: false
    }));

    const npmTransaction = () => complete(createReleaseTransaction({
      version: "2.4.0",
      sourceCommit: "commit-sha",
      packageIds: [],
      tagNames: ["v2.4.0"],
      publishingTargets: ["npm"],
      npmEnabled: true,
      npmProvenance: true
    }));

    const npmRunner = vi.fn<NonNullable<VerifyReleaseInput["npmRunner"]>>(async () => {
      throw new Error("registry is offline");
    });

    beforeEach(() => {
      vi.mocked(fs.realpath).mockImplementation(async (path) => resolve(String(path)));
      npmRunner.mockClear();
    });

    it.each([
      "..",
      "../outside/demo.tgz",
      resolve("verification-fixture/other"),
      resolve("verification-fixture/workspace-sibling/demo.tgz"),
      ...(process.platform === "win32" ? [`${parse(workspace).root[0]?.toUpperCase() === "Z" ? "Y" : "Z"}:\\demo.tgz`] : [])
    ])("rejects outside artifact path %s before filesystem access", async (path) => {
      const transaction = containedTransaction({ [path]: "a".repeat(64) });
      const report = await verifyRelease({ target: "v2.4.0", cwd: workspace, config, client: client(transaction.sourceCommit), release: null, transaction });

      expect(report.evidence).toContainEqual(expect.objectContaining({ name: `Artifact ${path}`, status: "unavailable", detail: expect.stringContaining("could not be read") }));
      expect(fs.realpath).not.toHaveBeenCalled();
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it("reads an inward symlink through its canonical path and preserves missing-file evidence", async () => {
      const canonicalRoot = resolve("verification-fixture/canonical-workspace");
      const canonicalFile = join(canonicalRoot, "artifacts/demo.tgz");
      const bytes = Buffer.from("harmless fixture artifact");
      const digest = createHash("sha256").update(bytes).digest("hex");
      vi.mocked(fs.realpath).mockImplementation(async (path) => {
        if (String(path) === workspace) return canonicalRoot;
        if (String(path) === join(workspace, "linked/demo.tgz")) return canonicalFile;
        throw Object.assign(new Error("missing fixture"), { code: "ENOENT" });
      });
      vi.mocked(fs.readFile).mockResolvedValue(bytes);
      const transaction = containedTransaction({ "linked/demo.tgz": digest, "missing.tgz": digest });
      const report = await verifyRelease({ target: "v2.4.0", cwd: workspace, config, client: client(transaction.sourceCommit), release: null, transaction });

      expect(fs.readFile).toHaveBeenCalledExactlyOnceWith(canonicalFile);
      expect(report.evidence).toContainEqual(expect.objectContaining({ name: "Artifact linked/demo.tgz", status: "verified" }));
      expect(report.evidence).toContainEqual(expect.objectContaining({ name: "Artifact missing.tgz", status: "unavailable", detail: expect.stringContaining("is not present") }));
    });

    it("treats traversal artifact paths as unavailable without reading files", async () => {
      const artifactDigests = {
        "dist/demo.tgz": "a".repeat(64),
        "../outside/demo.tgz": "b".repeat(64)
      };
      const transaction = complete(createReleaseTransaction({
        version: "2.4.0",
        sourceCommit: "commit-sha",
        packageIds: [],
        tagNames: ["v2.4.0"],
        artifactDigests,
        npmEnabled: false
      }));
      const readFileSpy = vi.spyOn(fs, "readFile");
      const report = await verifyRelease({
        target: "v2.4.0",
        cwd: process.cwd(),
        config,
        client: client(transaction.sourceCommit),
        release: null,
        transaction
      });

      expect(report.evidence.find((item) => item.name === "Release artifact digests")?.status).toBe("unavailable");
      expect(report.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Artifact dist/demo.tgz", status: "unavailable" }),
        expect.objectContaining({ name: "Artifact ../outside/demo.tgz", status: "unavailable" })
      ]));
      expect(readFileSpy).toHaveBeenCalledTimes(1);
      expect(readFileSpy.mock.calls[0]?.[0]).toContain("dist");
    });

    it("treats symlinked artifact paths that resolve outside the workspace as unavailable", async () => {
      const transaction = complete(createReleaseTransaction({
        version: "2.4.0",
        sourceCommit: "commit-sha",
        packageIds: [],
        tagNames: ["v2.4.0"],
        artifactDigests: { "linked/demo.tgz": "a".repeat(64) },
        npmEnabled: false
      }));
      const root = resolve("fixtures/symlink-root");
      vi.mocked(fs.realpath).mockImplementation(async (path) => {
        const value = resolve(String(path));
        return value === join(root, "linked/demo.tgz") ? resolve("fixtures/outside/demo.tgz") : value;
      });
      const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(Object.assign(new Error("denied"), { code: "EPERM" }));
      const report = await verifyRelease({
        target: "v2.4.0",
        cwd: root,
        config,
        client: client(transaction.sourceCommit),
        release: null,
        transaction
      });

      expect(readFileSpy).not.toHaveBeenCalled();
      expect(report.evidence.find((item) => item.name === "Release artifact digests")?.status).toBe("unavailable");
      expect(report.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Artifact linked/demo.tgz", status: "unavailable" })
      ]));
    });

    it.each(["outward", "missing", "denied"])("blocks npm publication and provenance for %s canonical directories", async (kind) => {
      vi.mocked(fs.realpath).mockImplementation(async (path) => {
        if (String(path) === workspace) return workspace;
        if (kind === "outward") return resolve("verification-fixture/outside-package");
        throw Object.assign(new Error("fixture unavailable"), { code: kind === "missing" ? "ENOENT" : "EACCES" });
      });
      const transaction = npmTransaction();
      const report = await verifyRelease({
        target: "v2.4.0", cwd: workspace, config, client: client(transaction.sourceCommit), release: release(transaction), transaction,
        manifest: { packages: [{ name: "demo", version: "2.4.0", directory: "linked-package" }] }, npmRunner
      });

      expect(npmRunner).not.toHaveBeenCalled();
      expect(report.evidence).toContainEqual(expect.objectContaining({ name: "npm demo@2.4.0", status: "unavailable" }));
      expect(report.evidence).toContainEqual(expect.objectContaining({ name: "npm provenance demo@2.4.0", status: "unavailable" }));
    });

    it("uses canonical inward package directories for both npm checks", async () => {
      const canonicalRoot = resolve("verification-fixture/canonical-workspace");
      const canonicalPackage = join(canonicalRoot, "packages/demo");
      vi.mocked(fs.realpath).mockImplementation(async (path) => String(path) === workspace ? canonicalRoot : canonicalPackage);
      const transaction = npmTransaction();
      await verifyRelease({
        target: "v2.4.0", cwd: workspace, config, client: client(transaction.sourceCommit), release: release(transaction), transaction,
        manifest: { packages: [{ name: "demo", version: "2.4.0", directory: "linked-package" }] }, npmRunner
      });

      expect(npmRunner).toHaveBeenCalledTimes(2);
      expect(npmRunner.mock.calls.map((call) => call[2].cwd)).toEqual([canonicalPackage, canonicalPackage]);
    });

    it.each(["python", "rust"] as const)("verifies remote %s packages without resolving a nonexistent workspace", async (ecosystem) => {
      vi.mocked(fs.realpath).mockRejectedValue(Object.assign(new Error("missing workspace"), { code: "ENOENT" }));
      const transaction = { ...containedTransaction({}), publishingTargets: [ecosystem] };
      const registryFetcher = vi.fn(async () => new Response(JSON.stringify({ releases: { "2.4.0": [] } }), { status: 200 }));
      const report = await verifyRelease({
        target: "v2.4.0", cwd: workspace, config, client: client(transaction.sourceCommit), release: release(transaction), transaction,
        manifest: { packages: [{ name: "demo", version: "2.4.0", directory: "packages/demo", ecosystem }] }, registryFetcher
      });

      expect(fs.realpath).not.toHaveBeenCalled();
      expect(registryFetcher).toHaveBeenCalledTimes(1);
      expect(report.evidence).toContainEqual(expect.objectContaining({ name: `${ecosystem} demo@2.4.0`, status: "verified" }));
    });

    it("passes contained package directories to npm and rejects outward ones before the runner", async () => {
      const transaction = npmTransaction();
      const report = await verifyRelease({
        target: "v2.4.0",
        cwd: process.cwd(),
        config,
        client: client(transaction.sourceCommit),
        release: release(transaction),
        transaction,
        manifest: { mode: "single", version: "2.4.0", packages: [
          { id: "demo", name: "demo", ecosystem: "node", version: "2.4.0", directory: "packages/demo" },
          { id: "escape", name: "escape", ecosystem: "node", version: "2.4.0", directory: "../escape" }
        ] },
        npmRunner
      });

      expect(npmRunner).toHaveBeenCalledTimes(2);
      for (const call of npmRunner.mock.calls) {
        expect(call[2].cwd).toBe(resolve("packages/demo"));
        expect(call[1][1]).toBe("demo@2.4.0");
      }
      expect(report.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "npm demo@2.4.0", status: "unavailable" }),
        expect.objectContaining({ name: "npm escape@2.4.0", status: "unavailable", detail: expect.stringContaining("outside the verification workspace") })
      ]));
      expect(report.evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "npm provenance escape@2.4.0", status: "unavailable", detail: "The release manifest points outside the verification workspace." })
      ]));
    });
  });
});
