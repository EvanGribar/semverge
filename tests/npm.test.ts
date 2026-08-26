import { describe, expect, it, vi } from "vitest";
import { assertNpmProvenanceEnvironment, npmProvenanceCheck, npmPublishCommand, npmVersionExists } from "../src/npm.js";

const provenanceConfig = {
  enabled: true,
  command: "npm publish",
  idempotency: "registry" as const,
  provenance: true
};

describe("npm publication idempotency", () => {
  it("recognizes the exact version returned by npm view", async () => {
    const runner = vi.fn(async () => ({ stdout: '"1.2.3"\n', stderr: "" }));

    await expect(npmVersionExists("@demo/package", "1.2.3", "C:/workspace", runner)).resolves.toBe(true);
    expect(runner).toHaveBeenCalledWith(expect.stringMatching(/^npm(?:\.cmd)?$/), ["view", "@demo/package@1.2.3", "version", "--json"], { cwd: "C:/workspace" });
  });

  it("treats an npm registry 404 as not yet published", async () => {
    const runner = vi.fn(async () => {
      throw { code: "E404", stderr: "npm error code E404\nnpm error 404 Not Found" };
    });

    await expect(npmVersionExists("demo", "1.2.3", "C:/workspace", runner)).resolves.toBe(false);
  });

  it("does not convert registry access failures into a publish attempt", async () => {
    const runner = vi.fn(async () => {
      throw { code: "E401", stderr: "npm error code E401\nnpm error Unable to authenticate" };
    });

    await expect(npmVersionExists("demo", "1.2.3", "C:/workspace", runner)).rejects.toThrow("will not assume the version is absent");
  });
});

describe("npm provenance", () => {
  it("recognizes registry attestation evidence for the exact package version", async () => {
    const runner = vi.fn(async () => ({ stdout: JSON.stringify({ provenance: { url: "https://registry.npmjs.org/-/provenance" } }), stderr: "" }));

    await expect(npmProvenanceCheck("demo", "1.2.3", "C:/workspace", runner)).resolves.toEqual({
      status: "verified",
      detail: "npm registry attestation evidence is present for demo@1.2.3."
    });
    expect(runner).toHaveBeenCalledWith(expect.stringMatching(/^npm(?:\.cmd)?$/), ["view", "demo@1.2.3", "dist.attestations", "--json"], { cwd: "C:/workspace" });
  });

  it("reports a provenance claim without registry attestation as a mismatch", async () => {
    const runner = vi.fn(async () => ({ stdout: "{}", stderr: "" }));

    await expect(npmProvenanceCheck("demo", "1.2.3", "C:/workspace", runner)).resolves.toMatchObject({ status: "mismatch" });
  });

  it("adds provenance only to the built-in npm publish command", () => {
    expect(npmPublishCommand(provenanceConfig)).toBe("npm publish --provenance");
    expect(npmPublishCommand({ ...provenanceConfig, provenance: false })).toBe("npm publish");
  });

  it("rejects custom commands and missing OIDC runtime evidence", () => {
    expect(() => npmPublishCommand({ ...provenanceConfig, command: "pnpm publish" })).toThrow("default npm publish command");
    expect(() => assertNpmProvenanceEnvironment(provenanceConfig, { GITHUB_ACTIONS: "true" })).toThrow("id-token: write");
    expect(() => assertNpmProvenanceEnvironment(provenanceConfig, {
      GITHUB_ACTIONS: "true",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/oidc",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "redacted-test-token"
    })).not.toThrow();
  });
});
