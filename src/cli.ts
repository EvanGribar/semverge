#!/usr/bin/env node

import { access, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { buildReleasePlan } from "./release.js";
import { parseChange } from "./changes.js";
import { parseConfig, validateConfig, validateConfigContent, type ConfigValidationIssue } from "./config.js";
import { explainReleasePlan } from "./explain.js";
import { inspectRepository, repositoryDoctorMarkdown } from "./doctor.js";
import { GitHubClient } from "./github.js";
import { inspectMigration, isMigrationTool, migrationReportMarkdown, MIGRATION_TOOLS, writeMigrationConfig } from "./migrate.js";
import { parseVersion } from "./semver.js";
import { parseReleaseTransaction, parseReleaseTransactionBody, recordReleaseTransactionEvent, releaseTransactionSummaryMarkdown } from "./transaction.js";
import { createPluginRegistryFromConfig, runTransactionOwnedPluginHook } from "./plugin-sdk.js";
import { readPackageVersion } from "./version-files.js";

export const DEFAULT_CONFIG_TEMPLATE = `# SemVerge configuration. Remove this file to use zero-configuration defaults.
release:
  branch: semverge/release
  tagPrefix: v
  independentTagPrefix: pkg-
  # promotion: stable  # explicitly promote the current prerelease to stable
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
    "  migrate <tool>       Inspect a Release Please, Changesets, or semantic-release setup",
    "  doctor               Validate repository files and SemVerge configuration",
    "  recover <release-id> Inspect durable release state and print the safe next action",
    "",
    "Options:",
    "  --config <path>      Read a different configuration file",
    "  --state <path>       Read a local transaction state file for recover",
    "  --write              Write a migration-generated .semverge.yml (migrate only)",
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

async function init(cwd: string, force: boolean, io: CliIo): Promise<number> {
  const path = join(cwd, ".semverge.yml");
  if (!force && await exists(path)) {
    io.stderr(`${path} already exists; pass --force to replace it.`);
    return 1;
  }
  await writeFile(path, DEFAULT_CONFIG_TEMPLATE, { encoding: "utf8", flag: force ? "w" : "wx" });
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
  if (repository && !statePath) {
    const client = new GitHubClient(token, repository);
    const releases = await client.listReleases();
    for (const release of releases) {
      const transaction = parseReleaseTransactionBody(release.body);
      if (transaction?.id === id) {
        io.stdout(`${release.html_url}\n${releaseTransactionSummaryMarkdown(transaction)}`);
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
  const configContent = await readOptional(join(cwd, ".semverge.yml")) ?? "";
  const config = parseConfig(configContent, ".semverge.yml");
  const registry = createPluginRegistryFromConfig(config);
  const recoverRes = await runTransactionOwnedPluginHook(
    registry,
    "recover",
    { sourceCommit: transaction.sourceCommit, version: transaction.version, packages: [], changes: [], config },
    transaction,
    recordReleaseTransactionEvent
  );
  if (recoverRes.transaction) transaction = recoverRes.transaction;
  io.stdout(releaseTransactionSummaryMarkdown(transaction));
  return 0;
}

export async function runCli(argv = process.argv.slice(2), cwd = process.cwd(), io: CliIo = defaultIo): Promise<number> {
  const commandNames = new Set(["init", "plan", "explain", "migrate", "doctor", "recover", "help"]);
  const command = argv[0] && commandNames.has(argv[0]) ? argv[0] : "plan";
  const commandArgs = command === "plan" && argv[0] !== "plan" ? argv : argv.slice(1);
  if (command === "help" || command === "--help" || argv.includes("--help")) {
    io.stdout(usage());
    return 0;
  }
  const configOption = option(commandArgs, "--config");
  const configPath = configOption.value || ".semverge.yml";
  const stateOption = option(configOption.rest, "--state");
  const force = commandArgs.includes("--force");
  const write = commandArgs.includes("--write");
  const remaining = stateOption.rest.filter((arg) => arg !== "--force" && arg !== "--write");

  try {
    if (command === "init") {
      return await init(cwd, force, io);
    }
    if (command === "doctor") {
      return await doctor(cwd, configPath, io);
    }
    if (command === "recover") {
      return await recover(cwd, remaining[0] ?? "", stateOption.value, io);
    }
    if (command === "plan") {
      return await plan(cwd, configPath, remaining.join(" "), io);
    }
    if (command === "explain") {
      return await explain(cwd, configPath, remaining.join(" "), io);
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
