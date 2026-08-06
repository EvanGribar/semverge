import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defineReleasePlugin, ReleasePluginRegistry, runReleasePluginHook, runTransactionOwnedPluginHook, createPluginRegistryFromConfig } from "../src/plugin-sdk.js";
import { createReleaseTransaction, recordReleaseTransactionEvent } from "../src/transaction.js";
import { buildReleasePlan } from "../src/release.js";
import { explainReleasePlan } from "../src/explain.js";
import { parseConfig } from "../src/config.js";
import type { SemVergeReleasePlugin } from "../src/plugin-sdk.js";

describe("Core Release Engine Plugin Execution", () => {
  it("registers, validates, and executes all 10 lifecycle hooks", async () => {
    const executedHooks: string[] = [];
    const fullPlugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "all-hooks-plugin",
      hooks: {
        analyze: (ctx) => { executedHooks.push(ctx.hook); return { summary: "analyzed changes" }; },
        plan: (ctx) => { executedHooks.push(ctx.hook); return { summary: "planned release" }; },
        validate: (ctx) => { executedHooks.push(ctx.hook); return { summary: "validated environment" }; },
        prepare: (ctx) => { executedHooks.push(ctx.hook); return { summary: "prepared release" }; },
        build: (ctx) => { executedHooks.push(ctx.hook); return { summary: "built artifacts" }; },
        publish: (ctx) => { executedHooks.push(ctx.hook); return { summary: "published packages" }; },
        upload: (ctx) => { executedHooks.push(ctx.hook); return { summary: "uploaded assets" }; },
        announce: (ctx) => { executedHooks.push(ctx.hook); return { summary: "announced release" }; },
        verify: (ctx) => { executedHooks.push(ctx.hook); return { summary: "verified release" }; },
        recover: (ctx) => { executedHooks.push(ctx.hook); return { summary: "recovered release" }; }
      }
    });

    const registry = new ReleasePluginRegistry();
    registry.register(fullPlugin);

    const context = {
      sourceCommit: "abc1234",
      version: "1.0.0",
      packages: [{ id: "pkg1", name: "pkg1", version: "1.0.0", ecosystem: "node", directory: "", private: false, releaseable: true }],
      changes: [{ title: "feat: new feature", source: "commit" as const, files: ["src/index.ts"], labels: ["ship:feature"], kind: "feature", breaking: false, customerSummary: "new feature" }],
      config: {}
    };

    for (const hook of ["analyze", "plan", "validate", "prepare", "build", "publish", "upload", "announce", "verify", "recover"] as const) {
      const invocations = await runReleasePluginHook(registry, hook, context);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]?.plugin).toBe("all-hooks-plugin");
      expect(invocations[0]?.result.summary).toBeDefined();
    }

    expect(executedHooks).toEqual(["analyze", "plan", "validate", "prepare", "build", "publish", "upload", "announce", "verify", "recover"]);
  });

  it("records plugin hook execution and plugin effects into transaction state", async () => {
    const plugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "effect-plugin",
      hooks: {
        publish: () => ({
          summary: "Created deployment target",
          effects: [
            { id: "deploy-1", idempotencyKey: "deploy-v1.0.0", kind: "deploy", target: "staging-server", reversible: true }
          ]
        })
      },
      executors: {
        deploy: {
          execute: async () => {},
          detect: async () => false
        }
      }
    });

    const registry = new ReleasePluginRegistry();
    registry.register(plugin);

    let transaction = createReleaseTransaction({
      version: "1.0.0",
      sourceCommit: "sha123",
      packageIds: ["root"],
      tagNames: ["v1.0.0"],
      npmEnabled: false
    });

    const context = {
      sourceCommit: "sha123",
      version: "1.0.0",
      packages: [],
      changes: [],
      config: {}
    };

    const res = await runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent);
    expect(res.transaction).toBeDefined();
    transaction = res.transaction!;

    expect(transaction.events.some((e) => e.key === "plugin:effect-plugin:publish" && e.status === "completed")).toBe(true);
    expect(transaction.events.some((e) => e.key === "effect:effect-plugin:deploy-v1.0.0" && e.status === "completed")).toBe(true);

    // Verify retry safety: re-running on same transaction skips duplicate hook execution
    const retryRes = await runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent);
    expect(retryRes.invocations[0]?.result.summary).toContain("Skipped publish");
  });

  it("blocks release plan when plugin returns blocked: true and explains it in semverge explain", () => {
    const blockingPlugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "guard-plugin",
      hooks: {
        plan: () => ({ blocked: true, summary: "Security audit incomplete" })
      }
    });

    const config = parseConfig("plugins:\n  - name: guard-plugin\n    apiVersion: 1\n");
    config.plugins = [blockingPlugin];

    const plan = buildReleasePlan({
      currentVersion: "1.0.0",
      changes: [{ title: "feat: add secure auth", source: "commit", labels: [], kind: "feature", breaking: false, skipped: false, customerSummary: "auth", readiness: [] }],
      config
    });

    expect(plan.readiness.passed).toBe(false);
    expect(plan.readiness.missingTasks).toContain("Plugin guard-plugin blocked release: Security audit incomplete");

    const explanation = explainReleasePlan(plan);
    expect(explanation).toContain("Plugins:");
    expect(explanation).toContain("guard-plugin: blocked (Security audit incomplete)");
  });

  it("parses plugin configuration from YAML and registers it in plugin registry", async () => {
    const plugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "config-plugin",
      hooks: {
        validate: () => ({ summary: "valid" })
      }
    });

    const config = parseConfig("plugins: []\n");
    config.plugins = [plugin];

    const registry = await createPluginRegistryFromConfig(config);
    expect(registry.get("config-plugin")).toBe(plugin);
  });

  it("loads plugins dynamically from local file modules", async () => {
    const config = parseConfig(`
plugins:
  - name: loaded-effect-plugin
    module: ./tests/fixtures/plugins/test-effect-plugin.js
`);
    const registry = await createPluginRegistryFromConfig(config, process.cwd());
    const plugin = registry.get("loaded-effect-plugin");
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe("loaded-effect-plugin");
    expect(plugin?.hooks.publish).toBeDefined();
  });

  it("executes side effects progressing through planned, started, completed, and failed states", async () => {
    const config = parseConfig(`
plugins:
  - name: test-effect-plugin
    module: ./tests/fixtures/plugins/test-effect-plugin.js
`);
    const registry = await createPluginRegistryFromConfig(config, process.cwd());

    let transaction = createReleaseTransaction({
      version: "1.0.0",
      sourceCommit: "sha123",
      packageIds: ["root"],
      tagNames: ["v1.0.0"],
      npmEnabled: false
    });

    const context = {
      sourceCommit: "sha123",
      version: "1.0.0",
      packages: [],
      changes: [],
      config: {}
    };

    // Prepare temp directory
    mkdirSync(join(process.cwd(), "tests/scratch"), { recursive: true });
    const targetFile = join(process.cwd(), "tests/scratch/effect-out.txt");
    try {
      rmSync(targetFile, { force: true });
    } catch {}

    // First test: execution with failure, using persistFn to capture state
    process.env.FAIL_AFTER_WRITE = "true";
    let failureTx = transaction;
    const persistFailure = async (tx: import("../src/transaction.js").ReleaseTransaction) => {
      failureTx = tx;
    };
    await expect(
      runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent, persistFailure)
    ).rejects.toThrow("Simulated failure after write");

    // Verify the failure transaction captured planned, started, and failed states
    const plannedEventFail = failureTx.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "planned");
    const startedEventFail = failureTx.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "started");
    const failedEventFail = failureTx.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "failed");

    expect(plannedEventFail).toBeDefined();
    expect(startedEventFail).toBeDefined();
    expect(failedEventFail).toBeDefined();

    // Now test a clean successful run (on a fresh file) to check completed status
    try {
      rmSync(targetFile, { force: true });
    } catch {}
    process.env.FAIL_AFTER_WRITE = "false";
    const result = await runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent);
    expect(result.transaction).toBeDefined();
    transaction = result.transaction!;

    const plannedEvent = transaction.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "planned");
    const startedEvent = transaction.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "started");
    const completedEvent = transaction.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "completed");

    expect(plannedEvent).toBeDefined();
    expect(startedEvent).toBeDefined();
    expect(completedEvent).toBeDefined();
  });

  it("uses detect function for idempotency check to avoid duplicate side effects", async () => {
    const config = parseConfig(`
plugins:
  - name: test-effect-plugin
    module: ./tests/fixtures/plugins/test-effect-plugin.js
`);
    const registry = await createPluginRegistryFromConfig(config, process.cwd());

    let transaction = createReleaseTransaction({
      version: "1.0.0",
      sourceCommit: "sha123",
      packageIds: ["root"],
      tagNames: ["v1.0.0"],
      npmEnabled: false
    });

    const context = {
      sourceCommit: "sha123",
      version: "1.0.0",
      packages: [],
      changes: [],
      config: {}
    };

    const targetFile = join(process.cwd(), "tests/scratch/effect-out.txt");
    try {
      rmSync(targetFile, { force: true });
    } catch {}

    // Manually write "executed" to target file to simulate it already completed outside SemVerge
    mkdirSync(join(process.cwd(), "tests/scratch"), { recursive: true });
    writeFileSync(targetFile, "executed\n", "utf8");

    // Execute hook. The executor's `detect` returns true, so SemVerge should mark it completed without calling execute.
    const result = await runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent);
    expect(result.transaction).toBeDefined();
    transaction = result.transaction!;

    const event = transaction.events.find(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "completed");
    expect(event).toBeDefined();
    expect(event?.detail).toContain("detected as already completed");
  });

  it("reconciles states on recovery", async () => {
    const config = parseConfig(`
plugins:
  - name: test-effect-plugin
    module: ./tests/fixtures/plugins/test-effect-plugin.js
`);
    const registry = await createPluginRegistryFromConfig(config, process.cwd());

    let transaction = createReleaseTransaction({
      version: "1.0.0",
      sourceCommit: "sha123",
      packageIds: ["root"],
      tagNames: ["v1.0.0"],
      npmEnabled: false
    });

    const context = {
      sourceCommit: "sha123",
      version: "1.0.0",
      packages: [],
      changes: [],
      config: {}
    };

    const targetFile = join(process.cwd(), "tests/scratch/effect-out.txt");
    try {
      rmSync(targetFile, { force: true });
    } catch {}

    // Run recover hook. Since it's a new transaction, it will execute recovery reconciliation
    const result = await runTransactionOwnedPluginHook(registry, "recover", context, transaction, recordReleaseTransactionEvent);
    expect(result.transaction).toBeDefined();
    transaction = result.transaction!;

    expect(transaction.events.some(e => e.key === "effect:test-effect-plugin:temp-file-key" && e.status === "completed")).toBe(true);
  });
});
