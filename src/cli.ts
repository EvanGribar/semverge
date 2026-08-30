#!/usr/bin/env node

import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, sep } from "node:path";
import { buildReleasePlan } from "./release.js";
import { suggestReleaseCommunication } from "./release-assistance.js";
import { applyMetadataBlock, metadataInferenceRequest, renderMetadataBlock, suggestReleaseMetadata } from "./metadata-inference.js";
import { parseChange } from "./changes.js";
import { parseConfig, validateConfig, validateConfigContent, type ConfigValidationIssue } from "./config.js";
import { explainReleasePlan } from "./explain.js";
import { inspectRepository, repositoryDoctorMarkdown } from "./doctor.js";
import { GitHubClient } from "./github.js";
import { inspectMigration, isMigrationTool, migrationReportMarkdown, MIGRATION_TOOLS, writeMigrationConfig } from "./migrate.js";
import { parseVersion } from "./semver.js";
import { parseReleaseTransaction, parseReleaseTransactionBody, recordReleaseTransactionEvent, releaseTransactionSummaryMarkdown, updateReleaseTransactionBody, type ReleaseTransaction } from "./transaction.js";
import { createPluginRegistryFromConfig, runTransactionOwnedPluginHook } from "./plugin-sdk.js";
import { readPackageVersion } from "./version-files.js";
import { verifyRelease, verificationReportJson, verificationReportMarkdown } from "./verification.js";

export const DEFAULT_CONFIG_TEMPLATE = `# SemVerge configuration. Remove this file to use zero-configuration defaults.
release:
  branch: semverge/release
  tagPrefix: v
  independentTagPrefix: pkg-
  # promotion: stable  # explicitly promote the current prerelease to stable
# Optional advisory AI assistance. Each feature remains disabled unless explicitly enabled.
# ai:
#   enabled: true
#   provider: openai
#   model: your-provider-supported-model
#   timeoutMs: 10000
#   releaseNotes: true
#   infer: true
#   tone: neutral
#   verbosity: standard
# Optional repository-owned version locations. Selectors are literal and fail closed.
# versionFiles:
#   - path: Dockerfile
#     format: text
#     pattern: "ARG APP_VERSION={{version}}"
`;

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

const defaultIo: CliIo = {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`)
};

function usage(): string {
  return [
    "Usage: semverge <command> [options]",
    "",
    "Commands:",
    "  init                 Create a starter .semverge.yml without overwriting it",
    "  plan [title]         Print a deterministic local release plan",
    "  explain [title]      Explain the version decision, blockers, merge path, and recovery",
    "  assist [title]       Request optional advisory release communication",
    "  infer [title]        Suggest advisory PR metadata without changing release state",
    "  migrate <tool>       Inspect a Release Please, Changesets, or semantic-release setup",
    "  doctor               Validate repository files and SemVerge configuration",
    "  recover <release-id> Inspect durable release state and print the safe next action",
    "  verify <release>      Verify a release transaction and its external publication evidence",
    "",
    "Options:",
    "  --config <path>      Read a different configuration file",
    "  --state <path>       Read a local transaction state file for recover or verify",
    "  --body <text>        Include bounded pull-request body context for infer",
    "  --labels <csv>       Include pull-request labels for infer",
    "  --files <csv>        Include safe file paths (never file contents) for infer",
    "  --write <path>       Apply a trusted infer suggestion to an existing body file",
    "  --apply <path>       Alias for --write",
    "  --json               Print a deterministic machine-readable verification report",
    "  --write              Write a migration-generated .semverge.yml (migrate only)",
    "  --detect             Let init include detected workspace and release-tool guidance",
    "  --force              Allow init to replace an existing configuration file",
    "  --help               Show this help"
  ].join("\n");
}

function option(args: string[], name: string): { value?: string; rest: string[] } {
  const index = args.indexOf(name);
  if (index < 0) {
    return { rest: args };
  }
  const value = args[index + 1];
  const rest = [...args.slice(0, index), ...args.slice(index + (value && !value.startsWith("-") ? 2 : 1))];
  return { value, rest };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function reportIssues(issues: ConfigValidationIssue[], io: CliIo): void {
  for (const issue of issues) {
    io.stderr(`${issue.severity === "error" ? "ERROR" : "WARN"} ${issue.path}: ${issue.message}`);
  }
}

function detectedInitTemplate(report: Awaited<ReturnType<typeof inspectRepository>>): string {
  const lines = [DEFAULT_CONFIG_TEMPLATE.trimEnd(), "", "# Detected repository signals (review before committing):", `# package manager: ${report.packageManager.name} (${report.packageManager.source})`];
  if (report.workspace.kind === "workspace" && report.workspace.patterns.length > 0) {
    lines.push("", "monorepo:", `  mode: ${report.workspace.strategy === "fixed" || report.workspace.strategy === "independent" ? report.workspace.strategy : "auto"}`, "  packages:", ...report.workspace.patterns.map((pattern) => `    - ${JSON.stringify(pattern)}`), "  includeRoot: true");
  }
  if (report.releaseTools.length > 0) {
    lines.push(`# release tools detected: ${report.releaseTools.map((tool) => tool.name).join(", ")}`);
    lines.push("# Run `semverge migrate <tool>` for a report before removing an existing release workflow.");
  }
  if (report.github.workflowFiles.length === 0) {
    lines.push("# No GitHub workflow was detected; add the workflow from the SemVerge README before enabling publication.");
  }
  return `${lines.join("\n")}\n`;
}

async function init(cwd: string, force: boolean, detect: boolean, io: CliIo): Promise<number> {
  const path = join(cwd, ".semverge.yml");
  if (!force && await exists(path)) {
    io.stderr(`${path} already exists; pass --force to replace it.`);
    return 1;
  }
  const template = detect ? detectedInitTemplate(await inspectRepository(cwd)) : DEFAULT_CONFIG_TEMPLATE;
  await writeFile(path, template, { encoding: "utf8", flag: force ? "w" : "wx" });
  io.stdout(`Created ${path}`);
  return 0;
}

async function localPlan(cwd: string, configPath: string, title: string) {
  const packageJson = await readFile(join(cwd, "package.json"), "utf8");
  const configContent = await readOptional(join(cwd, configPath)) ?? "";
  const config = parseConfig(configContent, configPath);
  const currentVersion = readPackageVersion(packageJson);
  return buildReleasePlan({
    currentVersion,
    config,
    changes: [parseChange({ title: title || "fix: generated local preview", source: "commit" })]
  });
}

async function plan(cwd: string, configPath: string, title: string, io: CliIo): Promise<number> {
  io.stdout(JSON.stringify(await localPlan(cwd, configPath, title), null, 2));
  return 0;
}

async function assist(cwd: string, configPath: string, title: string, io: CliIo): Promise<number> {
  const configContent = await readOptional(join(cwd, configPath)) ?? "";
  const config = parseConfig(configContent, configPath);
  if (!config.ai?.enabled) {
    io.stdout("AI assistance is disabled; no provider request was made.");
    return 0;
  }
  const plan = await localPlan(cwd, configPath, title);
  const suggestion = await suggestReleaseCommunication(plan, config.ai, {
    fallback: (error) => {
      io.stderr(`AI assistance unavailable: ${error.message}`);
      return null;
    }
  });
  if (!suggestion) {
    io.stdout("No AI advisory was produced; the deterministic release plan is unchanged.");
    return 0;
  }
  io.stdout(JSON.stringify({
    feature: "release-communication",
    version: plan.version,
    advisory: suggestion
  }, null, 2));
  return 0;
}

function splitList(value: string | undefined): string[] {
  return value?.split(/[\r\n,]/).map((item) => item.trim()).filter(Boolean) ?? [];
}

async function infer(
  cwd: string,
  configPath: string,
  title: string,
  body: string | undefined,
  labels: string | undefined,
  files: string | undefined,
  writeRequested: boolean,
  writeTarget: string | undefined,
  json: boolean,
  io: CliIo
): Promise<number> {
  const configContent = await readOptional(join(cwd, configPath)) ?? "";
  const config = parseConfig(configContent, configPath);
  if (!config.ai?.enabled || config.ai.infer === false) {
    io.stdout("AI metadata inference is disabled; no provider request was made.");
    return 0;
  }
  if (!title.trim()) {
    io.stderr("infer requires a pull-request title.");
    return 1;
  }
  const input = {
    title,
    ...(body !== undefined ? { body } : {}),
    ...(labels !== undefined ? { labels: splitList(labels) } : {}),
    ...(files !== undefined ? { files: splitList(files) } : {})
  };
  try {
    const request = metadataInferenceRequest(input);
    const suggestion = await suggestReleaseMetadata(input, config.ai);
    if (!suggestion) {
      io.stderr("AI metadata inference did not produce a suggestion; no file was changed.");
      return 1;
    }
    const metadataBlock = renderMetadataBlock(suggestion.metadata);
    const result: Record<string, unknown> = {
      feature: "metadata-inference",
      status: "advisory",
      input: request.input,
      suggestion,
      metadataBlock
    };
    if (writeRequested) {
      if (!writeTarget?.trim()) {
        io.stderr("infer --write/--apply requires a body file path.");
        return 1;
      }
      const absolute = resolve(cwd, writeTarget);
      const outside = relative(cwd, absolute);
      if (outside === ".." || outside.startsWith(`..${sep}`) || outside.includes(`..${sep}`)) {
        io.stderr("infer body file must stay inside the working directory.");
        return 1;
      }
      const existing = await readOptional(absolute);
      if (existing === undefined) {
        io.stderr(`${absolute} does not exist; no file was changed.`);
        return 1;
      }
      await writeFile(absolute, applyMetadataBlock(existing, suggestion.metadata), "utf8");
      result.writtenTo = absolute;
    }
    if (json) {
      io.stdout(JSON.stringify(result, null, 2));
    } else {
      io.stdout(`Advisory metadata suggestion (${suggestion.confidence} confidence):`);
      io.stdout(JSON.stringify(suggestion.metadata, null, 2));
      if (suggestion.ambiguity.length > 0) {
        io.stdout(`Ambiguity: ${suggestion.ambiguity.join(" ")}`);
      }
      io.stdout("Copy/apply this block only after review:");
      io.stdout(metadataBlock);
      if (result.writtenTo) io.stdout(`Applied to ${String(result.writtenTo)}`);
    }
    return 0;
  } catch (error) {
    io.stderr(`AI metadata inference unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function explain(cwd: string, configPath: string, title: string, io: CliIo): Promise<number> {
  io.stdout(explainReleasePlan(await localPlan(cwd, configPath, title)));
  return 0;
}

async function migrate(cwd: string, toolName: string, write: boolean, force: boolean, io: CliIo): Promise<number> {
  if (!isMigrationTool(toolName)) {
    io.stderr(`migrate requires one of: ${MIGRATION_TOOLS.join(", ")}.`);
    return 1;
  }
  const report = await inspectMigration(cwd, toolName);
  io.stdout(migrationReportMarkdown(report));
  if (write) {
    const path = await writeMigrationConfig(cwd, report, force);
    io.stdout(`Wrote ${path}`);
  }
  return 0;
}

async function doctor(cwd: string, configPath: string, io: CliIo): Promise<number> {
  const issues: ConfigValidationIssue[] = [];
  const packagePath = join(cwd, "package.json");
  const packageJson = await readOptional(packagePath);
  if (packageJson === undefined) {
    issues.push({ path: "package.json", severity: "error", message: "file is required for the local plan" });
  } else {
    try {
      const version = readPackageVersion(packageJson);
      if (!parseVersion(version)) {
        issues.push({ path: "package.json.version", severity: "error", message: `is not valid semantic versioning: ${version}` });
      }
    } catch (error) {
      issues.push({ path: "package.json", severity: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const configContent = await readOptional(join(cwd, configPath));
  if (configContent === undefined) {
    io.stdout(`INFO ${configPath}: not found; using zero-configuration defaults.`);
  } else {
    const contentIssues = validateConfigContent(configContent, configPath);
    issues.push(...contentIssues);
    if (!contentIssues.some((issue) => issue.severity === "error")) {
      const config = parseConfig(configContent, configPath);
      issues.push(...validateConfig(config));
    }
  }

  io.stdout(repositoryDoctorMarkdown(await inspectRepository(cwd)));
  reportIssues(issues, io);
  if (issues.some((issue) => issue.severity === "error")) {
    return 1;
  }
  io.stdout(`OK ${cwd}: SemVerge configuration is usable.`);
  return 0;
}

async function recover(cwd: string, id: string, statePath: string | undefined, io: CliIo): Promise<number> {
  if (!id || id.startsWith("-")) {
    io.stderr("recover requires a release transaction id, such as release_01J...");
    return 1;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN ?? process.env.INPUT_GITHUB_TOKEN ?? "";
  const configContent = await readOptional(join(cwd, ".semverge.yml")) ?? "";
  const config = parseConfig(configContent, ".semverge.yml");
  const registry = await createPluginRegistryFromConfig(config, cwd);

  if (repository && !statePath) {
    const client = new GitHubClient(token, repository);
    const releases = await client.listReleases();
    for (const release of releases) {
      const transaction = parseReleaseTransactionBody(release.body);
      if (transaction?.id === id) {
        const persist = async (tx: import("./transaction.js").ReleaseTransaction) => {
          await client.updateRelease(release.id, {
            body: updateReleaseTransactionBody(release.body ?? "", tx)
          });
        };
        const recoverRes = await runTransactionOwnedPluginHook(
          registry,
          "recover",
          { sourceCommit: transaction.sourceCommit, version: transaction.version, packages: [], changes: [], config },
          transaction,
          recordReleaseTransactionEvent,
          persist
        );
        const finalTx = recoverRes.transaction ?? transaction;
        io.stdout(`${release.html_url}\n${releaseTransactionSummaryMarkdown(finalTx)}`);
        return 0;
      }
    }
    io.stderr(`No SemVerge release transaction named ${id} was found in ${repository}.`);
    return 1;
  }

  const path = statePath ? resolve(cwd, statePath) : join(cwd, ".semverge", "release-state", `${id}.json`);
  const content = await readOptional(path);
  if (content === undefined) {
    io.stderr(`Could not find ${id}. Set GITHUB_REPOSITORY for remote recovery or provide --state <path>.`);
    return 1;
  }
  let transaction;
  try {
    const value: unknown = JSON.parse(content);
    transaction = parseReleaseTransaction(value);
  } catch {
    transaction = parseReleaseTransactionBody(content);
  }
  if (!transaction || transaction.id !== id) {
    io.stderr(`The transaction state at ${path} does not contain ${id}.`);
    return 1;
  }

  const persist = async (tx: import("./transaction.js").ReleaseTransaction) => {
    try {
      JSON.parse(content);
      await writeFile(path, JSON.stringify(tx, null, 2), "utf8");
    } catch {
      await writeFile(path, updateReleaseTransactionBody(content, tx), "utf8");
    }
  };

  const recoverRes = await runTransactionOwnedPluginHook(
    registry,
    "recover",
    { sourceCommit: transaction.sourceCommit, version: transaction.version, packages: [], changes: [], config },
    transaction,
    recordReleaseTransactionEvent,
    persist
  );
  const finalTx = recoverRes.transaction ?? transaction;
  io.stdout(releaseTransactionSummaryMarkdown(finalTx));
  return 0;
}

function parseLocalTransaction(content: string): ReleaseTransaction {
  let transaction: ReleaseTransaction | null = null;
  try {
    transaction = parseReleaseTransaction(JSON.parse(content) as unknown);
  } catch {
    transaction = parseReleaseTransactionBody(content);
  }
  if (!transaction) {
    throw new Error("The local state does not contain a valid SemVerge release transaction marker.");
  }
  return transaction;
}

async function verify(cwd: string, target: string, statePath: string | undefined, configPath: string, json: boolean, io: CliIo): Promise<number> {
  if (!target || target.startsWith("-")) {
    io.stderr("verify requires a release version, tag, transaction id, or GitHub release URL.");
    return 1;
  }
  const configContent = await readOptional(join(cwd, configPath)) ?? "";
  const config = parseConfig(configContent, configPath);
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN ?? process.env.INPUT_GITHUB_TOKEN ?? "";
  let transaction: ReleaseTransaction | null | undefined;
  let localOnly = Boolean(statePath);
  const localStatePath = statePath
    ? resolve(cwd, statePath)
    : /^release_[A-Za-z0-9-]+$/i.test(target)
      ? join(cwd, ".semverge", "release-state", `${target}.json`)
      : undefined;
  if (localStatePath) {
    const content = await readOptional(localStatePath);
    if (content !== undefined) {
      transaction = parseLocalTransaction(content);
      localOnly = true;
    } else if (statePath) {
      transaction = null;
      localOnly = true;
    }
  }
  const client = repository && !localOnly ? new GitHubClient(token, repository) : undefined;
  const report = await verifyRelease({ target, cwd, config, client, transaction, localOnly });
  io.stdout(json ? verificationReportJson(report) : verificationReportMarkdown(report));
  return report.status === "verified" ? 0 : report.status === "mismatch" ? 1 : 2;
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd(), io: CliIo = defaultIo): Promise<number> {
  const commandNames = new Set(["init", "plan", "explain", "assist", "infer", "migrate", "doctor", "recover", "verify", "help"]);
  const command = argv[0] && commandNames.has(argv[0]) ? argv[0] : "plan";
  const commandArgs = command === "plan" && argv[0] !== "plan" ? argv : argv.slice(1);
  if (command === "help" || command === "--help" || argv.includes("--help")) {
    io.stdout(usage());
    return 0;
  }
  const configOption = option(commandArgs, "--config");
  const configPath = configOption.value || ".semverge.yml";
  const stateOption = option(configOption.rest, "--state");
  const bodyOption = option(stateOption.rest, "--body");
  const labelsOption = option(bodyOption.rest, "--labels");
  const filesOption = option(labelsOption.rest, "--files");
  const applyOption = option(filesOption.rest, "--apply");
  const writeOption = option(applyOption.rest, "--write");
  const force = commandArgs.includes("--force");
  const detect = commandArgs.includes("--detect");
  const write = commandArgs.includes("--write");
  const apply = commandArgs.includes("--apply");
  const json = commandArgs.includes("--json");
  const remaining = writeOption.rest.filter((arg) => arg !== "--force" && arg !== "--write" && arg !== "--json");
  const inferWriteTarget = applyOption.value ?? (write ? writeOption.value : undefined);

  try {
    if (command === "init") {
      return await init(cwd, force, detect, io);
    }
    if (command === "doctor") {
      return await doctor(cwd, configPath, io);
    }
    if (command === "recover") {
      return await recover(cwd, remaining[0] ?? "", stateOption.value, io);
    }
    if (command === "verify") {
      return await verify(cwd, remaining[0] ?? "", stateOption.value, configPath, json, io);
    }
    if (command === "plan") {
      return await plan(cwd, configPath, remaining.join(" "), io);
    }
    if (command === "explain") {
      return await explain(cwd, configPath, remaining.join(" "), io);
    }
    if (command === "assist") {
      return await assist(cwd, configPath, remaining.join(" "), io);
    }
    if (command === "infer") {
      return await infer(cwd, configPath, remaining.join(" "), bodyOption.value, labelsOption.value, filesOption.value, write || apply, inferWriteTarget, json, io);
    }
    if (command === "migrate") {
      return await migrate(cwd, remaining[0] ?? "", write, force, io);
    }
    io.stderr(`Unknown command: ${command}\n\n${usage()}`);
    return 1;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
