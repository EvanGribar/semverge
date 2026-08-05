import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../src/config.js";
import { publishConfigForEcosystem, publisherName, registryVersionExists } from "../src/registries.js";

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
