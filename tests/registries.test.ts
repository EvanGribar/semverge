import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { ociImageVersionDigest, ociImageVersionExists, parseOciImageRepository, publishConfigForEcosystem, publisherName, registryVersionExists, renderOciPublishCommand } from "../src/registries.js";

describe("registry publishing adapters", () => {
  it("checks an exact Python version through the PyPI JSON API", async () => {
    const fetcher = vi.fn(async (input: string) => {
      expect(input).toBe("https://pypi.org/pypi/demo-package/json");
      return new Response(JSON.stringify({ releases: { "1.2.3": [{}], "1.2.2": [{}] } }), { status: 200 });
    });

    await expect(registryVersionExists("python", "demo-package", "1.2.3", fetcher)).resolves.toBe(true);
    await expect(registryVersionExists("python", "demo-package", "1.2.4", fetcher)).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("treats missing crates.io versions as unpublished and preserves registry errors", async () => {
    const missing = vi.fn(async () => new Response(JSON.stringify({ message: "not found" }), { status: 404 }));
    await expect(registryVersionExists("rust", "demo-crate", "0.3.0", missing)).resolves.toBe(false);

    const unavailable = vi.fn(async () => new Response("busy", { status: 503 }));
    await expect(registryVersionExists("rust", "demo-crate", "0.3.0", unavailable)).rejects.toThrow("will not assume the version is absent");
  });

  it("checks exact OCI tags, including bearer-authenticated registries, and fails closed", async () => {
    expect(parseOciImageRepository("demo")).toEqual({ registry: "registry-1.docker.io", repository: "library/demo" });
    expect(parseOciImageRepository("docker.io/acme/demo")).toEqual({ registry: "registry-1.docker.io", repository: "acme/demo" });
    expect(() => parseOciImageRepository("ghcr.io/acme/demo:latest")).toThrow("untagged repository");
    expect(renderOciPublishCommand("docker push {image}:{version}", "ghcr.io/acme/demo", "1.2.3")).toBe("docker push ghcr.io/acme/demo:1.2.3");

    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === "/v2/acme/demo/manifests/1.2.3" && !init?.headers || url.pathname === "/v2/acme/demo/manifests/1.2.3" && !(init?.headers as Record<string, string> | undefined)?.authorization) {
        return new Response("auth required", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:acme/demo:pull"' } });
      }
      if (url.pathname === "/token") {
        expect(url.searchParams.get("service")).toBe("ghcr.io");
        expect(url.searchParams.get("scope")).toBe("repository:acme/demo:pull");
        return new Response(JSON.stringify({ token: "test-token" }), { status: 200 });
      }
      expect(url.pathname).toBe("/v2/acme/demo/manifests/1.2.3");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer test-token");
      return new Response("manifest", { status: 200 });
    });

    await expect(ociImageVersionExists("ghcr.io/acme/demo", "1.2.3", fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);

    const digest = `sha256:${"a".repeat(64)}`;
    const digestFetcher = vi.fn(async () => new Response("manifest", { status: 200, headers: { "docker-content-digest": digest } }));
    await expect(ociImageVersionDigest("ghcr.io/acme/demo", "1.2.3", digestFetcher)).resolves.toBe(digest);

    const missing = vi.fn(async () => new Response("missing", { status: 404 }));
    await expect(ociImageVersionExists("ghcr.io/acme/demo", "1.2.3", missing)).resolves.toBe(false);
    await expect(ociImageVersionDigest("ghcr.io/acme/demo", "1.2.3", missing)).resolves.toBeNull();
    const unavailable = vi.fn(async () => new Response("busy", { status: 503 }));
    await expect(ociImageVersionExists("ghcr.io/acme/demo", "1.2.3", unavailable)).rejects.toThrow("will not assume the image tag is absent");
  });

  it("maps ecosystem publishing settings without enabling them by default", () => {
    const config = parseConfig(`publishing:
  python:
    enabled: true
    command: python -m twine upload dist/*
  rust:
    enabled: true
    command: cargo publish --locked
`);

    expect(config.publishing.python).toEqual({ enabled: true, command: "python -m twine upload dist/*", idempotency: "registry" });
    expect(config.publishing.rust).toEqual({ enabled: true, command: "cargo publish --locked", idempotency: "registry" });
    expect(publishConfigForEcosystem(config, "python")).toBe(config.publishing.python);
    expect(publishConfigForEcosystem(config, "rust")).toBe(config.publishing.rust);
    expect(publisherName("node")).toBe("npm");
    expect(publisherName("python")).toBe("PyPI");
    expect(publisherName("rust")).toBe("crates.io");
  });
});
