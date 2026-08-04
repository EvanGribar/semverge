import { describe, expect, it } from "vitest";
import {
  RELEASE_PLUGIN_HOOKS,
  ReleasePluginRegistry,
  defineReleasePlugin,
  runReleasePluginHook,
  validateReleasePlugin,
  type ReleasePluginContextInput
} from "../src/plugin-sdk.js";

const context: ReleasePluginContextInput = {
  sourceCommit: "merge-sha",
  version: "2.0.0",
  packages: [{ id: "demo", name: "demo", version: "2.0.0", ecosystem: "node", directory: "", private: false, releaseable: true }],
  changes: [{ title: "feat: ship it", source: "commit", files: ["src/index.ts"], labels: ["ship:feature"] }],
  config: {}
};

describe("SemVerge plugin SDK", () => {
  it("exposes the documented lifecycle hooks and runs registered plugins deterministically", async () => {
    const registry = new ReleasePluginRegistry();
    const calls: string[] = [];
    registry.register(defineReleasePlugin({
      apiVersion: 1,
      name: "first",
      capabilities: ["package-registry"],
      hooks: {
        analyze: ({ hook }) => {
          calls.push(`first:${hook}`);
          return { summary: "first analysis" };
        },
        publish: async ({ packages }) => ({
          effects: packages.map((packageItem) => ({ id: `publish:${packageItem.id}`, idempotencyKey: `package:${packageItem.id}`, kind: "package-publish", target: packageItem.name, externallyDetectable: true }))
        })
      }
    }));
    registry.register({
      apiVersion: 1,
      name: "second",
      hooks: { analyze: ({ hook }) => { calls.push(`second:${hook}`); } }
    });

    const analysis = await runReleasePluginHook(registry, "analyze", context);
    const publication = await runReleasePluginHook(registry, "publish", context);

    expect(RELEASE_PLUGIN_HOOKS).toEqual(["analyze", "plan", "validate", "prepare", "build", "publish", "upload", "announce", "verify", "recover"]);
    expect(calls).toEqual(["first:analyze", "second:analyze"]);
    expect(analysis.map((invocation) => invocation.plugin)).toEqual(["first", "second"]);
    expect(analysis[0]?.result.summary).toBe("first analysis");
    expect(publication).toHaveLength(1);
    expect(publication[0]?.result.effects?.[0]).toMatchObject({ id: "publish:demo", idempotencyKey: "package:demo" });
  });

  it("validates the public contract and rejects duplicate registrations", () => {
    const invalid = validateReleasePlugin({ apiVersion: 99, name: "", hooks: { unknown: true }, capabilities: ["ok", 1] });
    expect(invalid.map((item) => item.path)).toEqual(["apiVersion", "name", "hooks.unknown", "capabilities"]);

    const registry = new ReleasePluginRegistry();
    const plugin = { apiVersion: 1 as const, name: "duplicate", hooks: { recover: () => undefined } };
    registry.register(plugin);
    expect(() => registry.register(plugin)).toThrow("already registered");
    expect(registry.get("duplicate")).toBe(plugin);
  });

  it("wraps hook failures with the plugin and lifecycle context", async () => {
    const registry = new ReleasePluginRegistry();
    registry.register({
      apiVersion: 1,
      name: "broken",
      hooks: { recover: () => { throw new Error("provider unavailable"); } }
    });

    await expect(runReleasePluginHook(registry, "recover", context)).rejects.toThrow("SemVerge plugin broken failed during recover: provider unavailable");
  });
});
