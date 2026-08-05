import { describe, expect, it } from "vitest";
import { ociImageVersionExists, registryVersionExists } from "../../src/registries.js";

describe("Conformance: Registry Failures and Idempotency Safety", () => {
  describe("PyPI Registry Failure Handlers", () => {
    it("throws explicit error on PyPI 500 Server Error and does NOT assume version is absent", async () => {
      const mockFetcher = async () => new Response("Internal Server Error", { status: 500 });
      await expect(registryVersionExists("python", "demo-pkg", "1.0.0", mockFetcher))
        .rejects.toThrow("Could not verify demo-pkg@1.0.0 in the PyPI registry (HTTP 500). Fix registry access and retry; SemVerge will not assume the version is absent.");
    });

    it("throws explicit error when PyPI returns malformed JSON", async () => {
      const mockFetcher = async () => new Response("{ invalid json", { status: 200, headers: { "content-type": "application/json" } });
      await expect(registryVersionExists("python", "demo-pkg", "1.0.0", mockFetcher))
        .rejects.toThrow("the registry returned invalid JSON; SemVerge will not assume the version is absent.");
    });

    it("returns false cleanly when PyPI returns HTTP 404 (package or version missing)", async () => {
      const mockFetcher = async () => new Response("Not Found", { status: 404 });
      const exists = await registryVersionExists("python", "new-pkg", "1.0.0", mockFetcher);
      expect(exists).toBe(false);
    });
  });

  describe("crates.io Registry Failure Handlers", () => {
    it("throws explicit error on crates.io 503 Service Unavailable", async () => {
      const mockFetcher = async () => new Response("Service Unavailable", { status: 503 });
      await expect(registryVersionExists("rust", "kernel-crate", "0.1.0", mockFetcher))
        .rejects.toThrow("Could not verify kernel-crate@0.1.0 in the crates.io registry (HTTP 503)");
    });

    it("returns false cleanly when crates.io returns HTTP 404", async () => {
      const mockFetcher = async () => new Response("Not Found", { status: 404 });
      const exists = await registryVersionExists("rust", "unreleased-crate", "0.1.0", mockFetcher);
      expect(exists).toBe(false);
    });
  });

  describe("OCI Image Registry Failure Handlers", () => {
    it("throws explicit error when OCI registry returns 401 without WWW-Authenticate header", async () => {
      const mockFetcher = async () => new Response("Unauthorized", { status: 401 });
      await expect(ociImageVersionExists("ghcr.io/acme/app", "1.0.0", mockFetcher))
        .rejects.toThrow("the registry requires authentication but did not provide a bearer challenge");
    });

    it("throws explicit error on OCI registry 500 status", async () => {
      const mockFetcher = async () => new Response("Error", { status: 500 });
      await expect(ociImageVersionExists("ghcr.io/acme/app", "1.0.0", mockFetcher))
        .rejects.toThrow("the registry returned HTTP 500");
    });

    it("returns false cleanly when OCI registry returns 404", async () => {
      const mockFetcher = async () => new Response("Not Found", { status: 404 });
      const exists = await ociImageVersionExists("ghcr.io/acme/app", "1.0.0", mockFetcher);
      expect(exists).toBe(false);
    });
  });
});
