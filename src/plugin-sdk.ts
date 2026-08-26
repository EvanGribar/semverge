import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";

export const SEMVERGE_PLUGIN_API_VERSION = 1 as const;

export const RELEASE_PLUGIN_HOOKS = [
  "analyze",
  "plan",
  "validate",
  "prepare",
  "build",
  "publish",
  "upload",
  "announce",
  "verify",
  "recover"
] as const;

export type ReleasePluginHookName = typeof RELEASE_PLUGIN_HOOKS[number];

export interface ReleasePluginPackage {
  id: string;
  name: string;
  version: string;
  ecosystem: string;
  directory: string;
  private: boolean;
  releaseable: boolean;
}

export interface ReleasePluginChange {
  title: string;
  source: "commit" | "pull_request";
  sha?: string;
  number?: number;
  files: readonly string[];
  labels: readonly string[];
  kind?: string;
  scope?: string;
  breaking?: boolean;
  customerSummary?: string;
  migration?: string;
}

export interface ReleasePluginTransaction {
  id: string;
  version: string;
  sourceCommit: string;
  phase: string;
  packageIds: readonly string[];
  tagNames: readonly string[];
}

export interface ReleasePluginContext {
  hook: ReleasePluginHookName;
  sourceCommit: string;
  version?: string;
  packages: readonly ReleasePluginPackage[];
  changes: readonly ReleasePluginChange[];
  transaction?: Readonly<ReleasePluginTransaction>;
  config: unknown;
}

export type ReleasePluginContextInput = Omit<ReleasePluginContext, "hook">;

export interface ReleasePluginEffect {
  id: string;
  idempotencyKey: string;
  kind: string;
  target: string;
  reversible?: boolean;
  externallyDetectable?: boolean;
}

export interface ReleasePluginResult {
  summary?: string;
  effects?: readonly ReleasePluginEffect[];
  values?: Readonly<Record<string, unknown>>;
  blocked?: boolean;
}

export type ReleasePluginHook = (context: ReleasePluginContext) => ReleasePluginResult | void | Promise<ReleasePluginResult | void>;

export interface ReleasePluginEffectExecutor {
  execute(effect: ReleasePluginEffect, context: ReleasePluginContextInput): Promise<void>;
  detect?(effect: ReleasePluginEffect, context: ReleasePluginContextInput): Promise<boolean>;
}

export interface SemVergeReleasePlugin {
  apiVersion: typeof SEMVERGE_PLUGIN_API_VERSION;
  name: string;
  version?: string;
  capabilities?: readonly string[];
  hooks: Partial<Record<ReleasePluginHookName, ReleasePluginHook>>;
  executors?: Partial<Record<string, ReleasePluginEffectExecutor>>;
}

export interface ReleasePluginValidationIssue {
  path: string;
  message: string;
}

export interface ReleasePluginInvocation {
  plugin: string;
  result: ReleasePluginResult;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function issue(path: string, message: string): ReleasePluginValidationIssue {
  return { path, message };
}

export function validateReleasePlugin(plugin: unknown): ReleasePluginValidationIssue[] {
  const value = objectValue(plugin);
  if (!value) {
    return [issue("plugin", "must be an object")];
  }
  const issues: ReleasePluginValidationIssue[] = [];
  if (value.apiVersion !== SEMVERGE_PLUGIN_API_VERSION) {
    issues.push(issue("apiVersion", `must be ${SEMVERGE_PLUGIN_API_VERSION}`));
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    issues.push(issue("name", "must be a non-empty string"));
  }
  if (value.version !== undefined && (typeof value.version !== "string" || !value.version.trim())) {
    issues.push(issue("version", "must be a non-empty string when provided"));
  }
  const hooks = objectValue(value.hooks);
  if (!hooks) {
    issues.push(issue("hooks", "must be an object with at least one lifecycle hook"));
  } else {
    const hookNames = Object.keys(hooks);
    if (hookNames.length === 0) {
      issues.push(issue("hooks", "must define at least one lifecycle hook"));
    }
    for (const hookName of hookNames) {
      if (!(RELEASE_PLUGIN_HOOKS as readonly string[]).includes(hookName)) {
        issues.push(issue(`hooks.${hookName}`, "is not a supported lifecycle hook"));
      } else if (typeof hooks[hookName] !== "function") {
        issues.push(issue(`hooks.${hookName}`, "must be a function"));
      }
    }
  }
  if (value.capabilities !== undefined && (!Array.isArray(value.capabilities) || value.capabilities.some((item) => typeof item !== "string" || !item.trim()))) {
    issues.push(issue("capabilities", "must be an array of non-empty strings when provided"));
  }
  const executors = objectValue(value.executors);
  if (value.executors !== undefined) {
    if (!executors) {
      issues.push(issue("executors", "must be an object"));
    } else {
      for (const [name, executor] of Object.entries(executors)) {
        const execObj = objectValue(executor);
        if (!execObj || typeof execObj.execute !== "function") {
          issues.push(issue(`executors.${name}`, "must be an object with an execute function"));
        }
        if (execObj && execObj.detect !== undefined && typeof execObj.detect !== "function") {
          issues.push(issue(`executors.${name}.detect`, "must be a function when provided"));
        }
      }
    }
  }
  return issues;
}

export function defineReleasePlugin(plugin: SemVergeReleasePlugin): SemVergeReleasePlugin {
  const issues = validateReleasePlugin(plugin);
  if (issues.length > 0) {
    throw new Error(`Invalid SemVerge plugin: ${issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  }
  return plugin;
}

export class ReleasePluginRegistry {
  private readonly plugins = new Map<string, SemVergeReleasePlugin>();

  register(plugin: SemVergeReleasePlugin): this {
    const defined = defineReleasePlugin(plugin);
    if (this.plugins.has(defined.name)) {
      throw new Error(`SemVerge plugin ${defined.name} is already registered.`);
    }
    this.plugins.set(defined.name, defined);
    return this;
  }

  get(name: string): SemVergeReleasePlugin | undefined {
    return this.plugins.get(name);
  }

  list(): readonly SemVergeReleasePlugin[] {
    return [...this.plugins.values()];
  }
}

function normalizePluginResult(plugin: string, hook: ReleasePluginHookName, value: ReleasePluginResult | void): ReleasePluginResult {
  if (value === undefined) {
    return {};
  }
  const result = objectValue(value);
  if (!result) {
    throw new Error(`SemVerge plugin ${plugin} returned an invalid result from ${hook}.`);
  }
  if (result.summary !== undefined && typeof result.summary !== "string") {
    throw new Error(`SemVerge plugin ${plugin} returned an invalid summary from ${hook}.`);
  }
  if (result.blocked !== undefined && typeof result.blocked !== "boolean") {
    throw new Error(`SemVerge plugin ${plugin} returned an invalid blocked flag from ${hook}.`);
  }
  if (result.values !== undefined && !objectValue(result.values)) {
    throw new Error(`SemVerge plugin ${plugin} returned invalid values from ${hook}.`);
  }
  if (result.effects !== undefined && (!Array.isArray(result.effects) || result.effects.some((effect) => {
    const value = objectValue(effect);
    return !value || typeof value.id !== "string" || !value.id || typeof value.idempotencyKey !== "string" || !value.idempotencyKey || typeof value.kind !== "string" || !value.kind || typeof value.target !== "string" || !value.target || (value.reversible !== undefined && typeof value.reversible !== "boolean") || (value.externallyDetectable !== undefined && typeof value.externallyDetectable !== "boolean");
  }))) {
    throw new Error(`SemVerge plugin ${plugin} returned invalid effects from ${hook}.`);
  }
  return value;
}

export async function runReleasePluginHook(registry: ReleasePluginRegistry, hook: ReleasePluginHookName, context: ReleasePluginContextInput): Promise<ReleasePluginInvocation[]> {
  const invocations: ReleasePluginInvocation[] = [];
  for (const plugin of registry.list()) {
    const handler = plugin.hooks[hook];
    if (!handler) {
      continue;
    }
    try {
      const result = normalizePluginResult(plugin.name, hook, await handler({ ...context, hook }));
      invocations.push({ plugin: plugin.name, result });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`SemVerge plugin ${plugin.name} returned`)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SemVerge plugin ${plugin.name} failed during ${hook}: ${message}`, { cause: error });
    }
  }
  return invocations;
}

export function runReleasePluginHookSync(registry: ReleasePluginRegistry, hook: ReleasePluginHookName, context: ReleasePluginContextInput): ReleasePluginInvocation[] {
  const invocations: ReleasePluginInvocation[] = [];
  for (const plugin of registry.list()) {
    const handler = plugin.hooks[hook];
    if (!handler) {
      continue;
    }
    try {
      const res = handler({ ...context, hook });
      if (res && typeof (res as Promise<unknown>).then === "function") {
        throw new Error(`SemVerge plugin ${plugin.name} returned a Promise from synchronous hook ${hook}.`);
      }
      const result = normalizePluginResult(plugin.name, hook, res as ReleasePluginResult | void);
      invocations.push({ plugin: plugin.name, result });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`SemVerge plugin ${plugin.name} returned`)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SemVerge plugin ${plugin.name} failed during ${hook}: ${message}`, { cause: error });
    }
  }
  return invocations;
}

export async function loadPlugin(descriptor: unknown, workspace: string): Promise<SemVergeReleasePlugin> {
  let pluginName = "";
  let resolvedPath = "";

  if (typeof descriptor === "string") {
    const target = descriptor.trim();
    if (target.startsWith(".") || target.startsWith("/") || target.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(target)) {
      // Local module
      resolvedPath = resolve(workspace, target);
    } else {
      // Pinned package
      const workspaceRequire = createRequire(join(workspace, "package.json"));
      resolvedPath = workspaceRequire.resolve(target);
    }
  } else if (descriptor && typeof descriptor === "object") {
    const obj = descriptor as Record<string, unknown>;
    if (typeof obj.package === "string") {
      const workspaceRequire = createRequire(join(workspace, "package.json"));
      resolvedPath = workspaceRequire.resolve(obj.package.trim());
    } else if (typeof obj.module === "string") {
      resolvedPath = resolve(workspace, obj.module.trim());
    } else {
      throw new Error('Plugin descriptor must specify either "package" or "module".');
    }
    if (typeof obj.name === "string") {
      pluginName = obj.name.trim();
    }
  } else {
    throw new Error("Invalid plugin descriptor; must be a string or object.");
  }

  const moduleUrl = pathToFileURL(resolvedPath).toString();
  const loadedModule = await import(moduleUrl);
  const pluginObject = loadedModule.default ?? loadedModule;

  const finalPlugin = {
    ...pluginObject,
    ...(pluginName ? { name: pluginName } : {})
  } as SemVergeReleasePlugin;

  const issues = validateReleasePlugin(finalPlugin);
  if (issues.length > 0) {
    throw new Error(`Invalid loaded plugin from ${resolvedPath}: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`);
  }

  return finalPlugin;
}

export async function createPluginRegistryFromConfig(config?: { plugins?: Array<unknown> }, workspace = process.cwd()): Promise<ReleasePluginRegistry> {
  const registry = new ReleasePluginRegistry();
  if (config?.plugins && Array.isArray(config.plugins)) {
    for (const item of config.plugins) {
      if (item && typeof item === "object" && "name" in item && "hooks" in item) {
        registry.register(item as SemVergeReleasePlugin);
      } else {
        const plugin = await loadPlugin(item, workspace);
        registry.register(plugin);
      }
    }
  }
  return registry;
}

export function createPluginRegistryFromConfigSync(config?: { plugins?: Array<unknown> }): ReleasePluginRegistry {
  const registry = new ReleasePluginRegistry();
  if (config?.plugins && Array.isArray(config.plugins)) {
    for (const item of config.plugins) {
      if (item && typeof item === "object" && "name" in item && "hooks" in item) {
        registry.register(item as SemVergeReleasePlugin);
      }
    }
  }
  return registry;
}

function hasUncompletedPluginEffect(state: import("./transaction.js").ReleaseTransaction, pluginName: string): boolean {
  // Transactions written by older versions may contain a completed hook with unfinished effects.
  const effectPrefix = `effect:${pluginName}:`;
  const completedKeys = new Set<string>();
  const incompleteKeys = new Set<string>();
  for (const event of state.events) {
    if (!event.key.startsWith(effectPrefix)) {
      continue;
    }
    if (event.status === "completed") {
      completedKeys.add(event.key);
    } else {
      incompleteKeys.add(event.key);
    }
  }
  return [...incompleteKeys].some((key) => !completedKeys.has(key));
}

export async function runTransactionOwnedPluginHook(
  registry: ReleasePluginRegistry,
  hook: ReleasePluginHookName,
  context: ReleasePluginContextInput,
  transaction?: import("./transaction.js").ReleaseTransaction,
  recordEventFn?: typeof import("./transaction.js").recordReleaseTransactionEvent,
  persistFn?: (tx: import("./transaction.js").ReleaseTransaction) => Promise<void>
): Promise<{ invocations: ReleasePluginInvocation[]; transaction?: import("./transaction.js").ReleaseTransaction }> {
  let currentState = transaction;
  const invocations: ReleasePluginInvocation[] = [];
  const persist = persistFn ?? (async (tx) => { currentState = tx; });

  for (const plugin of registry.list()) {
    const handler = plugin.hooks[hook];
    if (!handler) {
      continue;
    }
    const hookKey = `plugin:${plugin.name}:${hook}`;
    if (currentState && currentState.events.some((e) => e.key === hookKey && e.status === "completed") && !hasUncompletedPluginEffect(currentState, plugin.name)) {
      invocations.push({ plugin: plugin.name, result: { summary: `Skipped ${hook} (already completed in transaction)` } });
      continue;
    }

    try {
      const result = normalizePluginResult(plugin.name, hook, await handler({ ...context, hook, transaction: currentState ? { id: currentState.id, version: currentState.version, sourceCommit: currentState.sourceCommit, phase: currentState.phase, packageIds: currentState.packageIds, tagNames: currentState.tagNames } : undefined }));
      invocations.push({ plugin: plugin.name, result });

      if (currentState && recordEventFn) {
        if (result.blocked) {
          currentState = recordEventFn(currentState, {
            key: hookKey,
            kind: `plugin-hook-${hook}`,
            target: plugin.name,
            status: "failed",
            detail: result.summary ?? `Plugin ${plugin.name} blocked execution during ${hook}.`
          });
          await persist(currentState);
        } else {
          if (result.effects && result.effects.length > 0) {
            // First record all as planned
            for (const effect of result.effects) {
              const effectKey = `effect:${plugin.name}:${effect.idempotencyKey}`;
              if (!currentState.events.some((e) => e.key === effectKey)) {
                currentState = recordEventFn(currentState, {
                  key: effectKey,
                  kind: `plugin-effect-${effect.kind}`,
                  target: effect.target,
                  status: "planned",
                  detail: `Plugin effect ${effect.id} planned.`
                });
              }
            }
            await persist(currentState);

            // Execute each effect
            for (const effect of result.effects) {
              const effectKey = `effect:${plugin.name}:${effect.idempotencyKey}`;
              if (currentState.events.some((e) => e.key === effectKey && e.status === "completed")) {
                continue;
              }

              const executor = plugin.executors?.[effect.kind];
              if (!executor) {
                throw new Error(`No executor registered for effect kind "${effect.kind}" in plugin "${plugin.name}".`);
              }

              // Try external detection
              if (executor.detect) {
                try {
                  const detected = await executor.detect(effect, context);
                  if (detected) {
                    currentState = recordEventFn(currentState, {
                      key: effectKey,
                      kind: `plugin-effect-${effect.kind}`,
                      target: effect.target,
                      status: "completed",
                      detail: `Plugin effect ${effect.id} detected as already completed.`
                    });
                    await persist(currentState);
                    continue;
                  }
                } catch (err) {
                  // If detection fails, proceed to execute
                }
              }

              // Mark as started
              currentState = recordEventFn(currentState, {
                key: effectKey,
                kind: `plugin-effect-${effect.kind}`,
                target: effect.target,
                status: "started",
                detail: `Plugin effect ${effect.id} execution started.`
              });
              await persist(currentState);

              // Run execute
              try {
                await executor.execute(effect, context);
                currentState = recordEventFn(currentState, {
                  key: effectKey,
                  kind: `plugin-effect-${effect.kind}`,
                  target: effect.target,
                  status: "completed",
                  detail: `Plugin effect ${effect.id} completed.`
                });
                await persist(currentState);
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                currentState = recordEventFn(currentState, {
                  key: effectKey,
                  kind: `plugin-effect-${effect.kind}`,
                  target: effect.target,
                  status: "failed",
                  detail: message
                });
                await persist(currentState);
                throw err;
              }
            }
          }

          currentState = recordEventFn(currentState, {
            key: hookKey,
            kind: `plugin-hook-${hook}`,
            target: plugin.name,
            status: "completed",
            detail: result.summary ?? `Plugin ${plugin.name} completed ${hook}.`
          });
          await persist(currentState);
        }
      }

      if (result.blocked) {
        throw new Error(`SemVerge plugin ${plugin.name} blocked the release during ${hook}: ${result.summary ?? "release blocked"}`);
      }
    } catch (error) {
      if (currentState && recordEventFn && !(error instanceof Error && error.message.startsWith(`SemVerge plugin ${plugin.name} blocked`))) {
        currentState = recordEventFn(currentState, {
          key: hookKey,
          kind: `plugin-hook-${hook}`,
          target: plugin.name,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error)
        });
        await persist(currentState);
      }
      throw error;
    }
  }

  return { invocations, transaction: currentState };
}

