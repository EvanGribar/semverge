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

  it("treats a completed effect event as terminal even when earlier attempts remain in history", async () => {
    let hookCalls = 0;
    let effectExecutions = 0;
    const effectKey = "effect:historical-effect-plugin:delivery-v1.0.0";
    const plugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "historical-effect-plugin",
      hooks: {
        publish: () => {
          hookCalls += 1;
          return { effects: [{ id: "delivery", idempotencyKey: "delivery-v1.0.0", kind: "deliver", target: "staging" }] };
        }
      },
      executors: {
        deliver: {
          execute: async () => {
            effectExecutions += 1;
          }
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
    for (const status of ["planned", "started", "completed"] as const) {
      transaction = recordReleaseTransactionEvent(transaction, {
        key: effectKey,
        kind: "plugin-effect-deliver",
        target: "staging",
        status
      });
    }

    const context = {
      sourceCommit: "sha123",
      version: "1.0.0",
      packages: [],
      changes: [],
      config: {}
    };
    const result = await runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent);

    expect(result.transaction).toBeDefined();
    expect(hookCalls).toBe(1);
    expect(effectExecutions).toBe(0);
    expect(result.transaction!.events.filter((event) => event.key === effectKey).map((event) => event.status)).toEqual(["planned", "started", "completed"]);

    const retry = await runTransactionOwnedPluginHook(registry, "publish", context, result.transaction, recordReleaseTransactionEvent);
    expect(hookCalls).toBe(1);
    expect(effectExecutions).toBe(0);
    expect(retry.invocations[0]?.result.summary).toContain("Skipped publish");
    expect(retry.transaction!.events.filter((event) => event.key === effectKey).map((event) => event.status)).toEqual(["planned", "started", "completed"]);
  });

  it("retries failed effects and skips them after a later completed attempt", async () => {
    let hookCalls = 0;
    let effectExecutions = 0;
    let failExecution = true;
    const effectKey = "effect:retry-effect-plugin:delivery-v1.0.0";
    const plugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "retry-effect-plugin",
      hooks: {
        publish: () => {
          hookCalls += 1;
          return { effects: [{ id: "delivery", idempotencyKey: "delivery-v1.0.0", kind: "deliver", target: "staging" }] };
        }
      },
      executors: {
        deliver: {
          execute: async () => {
            effectExecutions += 1;
            if (failExecution) {
              throw new Error("temporary delivery failure");
            }
          }
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
    const persisted: Array<typeof transaction> = [];
    const persist = async (state: typeof transaction) => {
      persisted.push(state);
    };

    await expect(
      runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent, persist)
    ).rejects.toThrow("temporary delivery failure");
    const failedTransaction = persisted[persisted.length - 1];
    expect(failedTransaction).toBeDefined();
    expect(failedTransaction!.events.filter((event) => event.key === effectKey).map((event) => event.status)).toEqual(["planned", "started", "failed"]);

    failExecution = false;
    const recovered = await runTransactionOwnedPluginHook(registry, "publish", context, failedTransaction, recordReleaseTransactionEvent);
    expect(recovered.transaction).toBeDefined();
    expect(hookCalls).toBe(2);
    expect(effectExecutions).toBe(2);
    expect(recovered.transaction!.events.filter((event) => event.key === effectKey).map((event) => event.status)).toEqual(["planned", "started", "failed", "started", "completed"]);

    const retry = await runTransactionOwnedPluginHook(registry, "publish", context, recovered.transaction, recordReleaseTransactionEvent);
    expect(hookCalls).toBe(2);
    expect(effectExecutions).toBe(2);
    expect(retry.invocations[0]?.result.summary).toContain("Skipped publish");
    expect(retry.transaction!.events.filter((event) => event.key === effectKey).map((event) => event.status)).toEqual(["planned", "started", "failed", "started", "completed"]);
  });

  it("completes a hook only after all effects finish and retries only incomplete effects", async () => {
    let hookCalls = 0;
    let firstEffectExecutions = 0;
    let secondEffectExecutions = 0;
    let failSecondEffect = true;
    const plugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "multi-effect-plugin",
      hooks: {
        publish: () => {
          hookCalls += 1;
          return {
            effects: [
              { id: "first", idempotencyKey: "first", kind: "test-effect", target: "first" },
              { id: "second", idempotencyKey: "second", kind: "test-effect", target: "second" }
            ]
          };
        }
      },
      executors: {
        "test-effect": {
          execute: async (effect) => {
            if (effect.id === "first") {
              firstEffectExecutions += 1;
              return;
            }
            secondEffectExecutions += 1;
            if (failSecondEffect) {
              throw new Error("later effect failed");
            }
          }
        }
      }
    });

    const registry = new ReleasePluginRegistry();
    registry.register(plugin);
    const transaction = createReleaseTransaction({
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
    const snapshots: Array<typeof transaction> = [];
    let simulateRestart = true;
    const persist = async (state: typeof transaction) => {
      snapshots.push(state);
      if (simulateRestart && state.events.some((event) => event.key === "effect:multi-effect-plugin:first" && event.status === "planned") && !state.events.some((event) => event.status === "started")) {
        simulateRestart = false;
        throw new Error("simulated process restart");
      }
    };

    await expect(
      runTransactionOwnedPluginHook(registry, "publish", context, transaction, recordReleaseTransactionEvent, persist)
    ).rejects.toThrow("simulated process restart");

    const hookCompleted = (state: typeof transaction) => state.events.some((event) => event.key === "plugin:multi-effect-plugin:publish" && event.status === "completed");
    const effectCompleted = (state: typeof transaction, key: string) => state.events.some((event) => event.key === `effect:multi-effect-plugin:${key}` && event.status === "completed");
    const restartTransaction = snapshots[0];

    expect(restartTransaction).toBeDefined();
    expect(hookCompleted(restartTransaction!)).toBe(false);

    snapshots.length = 0;
    await expect(
      runTransactionOwnedPluginHook(registry, "publish", context, restartTransaction, recordReleaseTransactionEvent, persist)
    ).rejects.toThrow("later effect failed");

    const failedTransaction = snapshots[snapshots.length - 1];
    expect(failedTransaction).toBeDefined();
    expect(hookCompleted(failedTransaction!)).toBe(false);
    expect(effectCompleted(failedTransaction!, "first")).toBe(true);
    expect(failedTransaction!.events.some((event) => event.key === "effect:multi-effect-plugin:second" && event.status === "failed")).toBe(true);

    failSecondEffect = false;
    const retry = await runTransactionOwnedPluginHook(registry, "publish", context, failedTransaction!, recordReleaseTransactionEvent);

    expect(retry.transaction).toBeDefined();
    expect(hookCalls).toBe(3);
    expect(firstEffectExecutions).toBe(1);
    expect(secondEffectExecutions).toBe(2);
    expect(effectCompleted(retry.transaction!, "first")).toBe(true);
    expect(effectCompleted(retry.transaction!, "second")).toBe(true);
    expect(hookCompleted(retry.transaction!)).toBe(true);
  });

  it("reconciles unfinished effects from a transaction with an earlier hook completion", async () => {
    let hookCalls = 0;
    let effectExecutions = 0;
    const plugin: SemVergeReleasePlugin = defineReleasePlugin({
      apiVersion: 1,
      name: "legacy-effect-plugin",
      hooks: {
        publish: () => {
          hookCalls += 1;
          return { effects: [{ id: "unfinished", idempotencyKey: "unfinished", kind: "test-effect", target: "unfinished" }] };
        }
      },
      executors: {
        "test-effect": {
          execute: async () => {
            effectExecutions += 1;
          }
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
    transaction = recordReleaseTransactionEvent(transaction, {
      key: "plugin:legacy-effect-plugin:publish",
      kind: "plugin-hook-publish",
      target: "legacy-effect-plugin",
      status: "completed"
    });
    transaction = recordReleaseTransactionEvent(transaction, {
      key: "effect:legacy-effect-plugin:unfinished",
      kind: "plugin-effect-test-effect",
      target: "unfinished",
      status: "planned"
    });

    const result = await runTransactionOwnedPluginHook(registry, "publish", {
      sourceCommit: "sha123",
      version: "1.0.0",
      packages: [],
      changes: [],
      config: {}
    }, transaction, recordReleaseTransactionEvent);

    expect(result.transaction).toBeDefined();
    expect(hookCalls).toBe(1);
    expect(effectExecutions).toBe(1);
    expect(result.transaction!.events.some((event) => event.key === "effect:legacy-effect-plugin:unfinished" && event.status === "completed")).toBe(true);
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
