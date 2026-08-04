import { describe, expect, it, vi } from "vitest";
import { npmVersionExists } from "../src/npm.js";

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
