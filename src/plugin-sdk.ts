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
  config: Readonly<Record<string, unknown>>;
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

export interface SemVergeReleasePlugin {
  apiVersion: typeof SEMVERGE_PLUGIN_API_VERSION;
  name: string;
  version?: string;
  capabilities?: readonly string[];
  hooks: Partial<Record<ReleasePluginHookName, ReleasePluginHook>>;
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
