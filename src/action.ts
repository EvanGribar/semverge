import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, join, basename, sep } from "node:path";
import { formatChangeReference, parseChange, releaseChannelFromLabels } from "./changes.js";
import { channelBaseBranch, channelPolicy, parseConfig, withChannelPolicy, withOverrides } from "./config.js";
import { communicationQualityMarkdown } from "./communication-quality.js";
import { readinessMarkdown } from "./readiness.js";
import { releaseTagName, GitHubClient, type GitHubCommitSummary, type GitHubPullRequest, type GitHubRelease } from "./github.js";
import { discoverPackages } from "./packages.js";
import { buildWorkspaceReleasePlan, type WorkspaceReleasePlan } from "./workspace-release.js";
import { evaluatePostReleaseVerification, postReleaseVerificationMarkdown, versionFromReleaseTag, type PostReleaseVerificationObservation, type PostReleaseVerificationReport } from "./health.js";
import { compareVersions, parseVersion } from "./semver.js";
import { assertNpmProvenanceEnvironment, npmPublishCommand, npmVersionExists } from "./npm.js";
import { ociImageVersionDigest, ociImageVersionExists, parseOciImageRepository, publishConfigForEcosystem, publisherName, registryVersionExists, renderOciPublishCommand } from "./registries.js";
import { assertWorkspaceAtCommit } from "./workspace-integrity.js";
import { advanceReleaseTransaction, createReleaseTransaction, mergeReleaseTransactions, parseReleaseTransactionBody, recordReleaseTransactionEvent, releaseTransactionBody, updateReleaseTransactionBody, type ReleaseTransaction } from "./transaction.js";
import { createPluginRegistryFromConfig, runTransactionOwnedPluginHook, type ReleasePluginPackage } from "./plugin-sdk.js";
import { buildAiReleaseNotesPreview, type AiReleaseNotesPreview } from "./release-assistance.js";
import type { Ecosystem, SemVergeConfig } from "./types.js";

const exec = promisify(execCallback);

interface PushEvent {
  ref?: string;
  after?: string;
  head_commit?: { message?: string };
}

interface PullRequestEvent {
  action?: string;
  pull_request?: GitHubPullRequest & { merged?: boolean };
}

interface ReleaseEvent {
  action?: string;
  release?: {
    id?: number;
    tag_name: string;
    target_commitish?: string;
    published_at?: string | null;
    html_url?: string;
    body?: string | null;
    assets?: Array<{ name: string }>;
  };
}

export function channelBranchAllowed(branch: string, defaultBranch: string, configuredBranch?: string): boolean {
  const expectedBranch = configuredBranch?.replace(/^refs\/heads\//, "");
  return expectedBranch ? branch === expectedBranch : branch === defaultBranch;
}

export function channelFromBranch(config: SemVergeConfig, branch: string): { name: string; policy: SemVergeConfig["release"]["channels"][string] } | undefined {
  const normalizedBranch = branch.replace(/^refs\/heads\//, "");
  const match = Object.entries(config.release.channels).find(([, policy]) => policy.branch?.replace(/^refs\/heads\//, "") === normalizedBranch);
  return match ? { name: match[0], policy: match[1] } : undefined;
}

function selectedChannel(config: SemVergeConfig, changes: Array<{ labels: string[] }>, branch: string, requestedChannel: string): { name: string; policy: SemVergeConfig["release"]["channels"][string] } | undefined {
  if (requestedChannel.trim()) {
    const requested = channelPolicy(config, requestedChannel);
    if (!requested) {
      throw new Error(`Unknown SemVerge release channel: ${requestedChannel}`);
    }
    return requested;
  }
  return releaseChannelFromLabels(changes.flatMap((change) => change.labels), config.release.channels) ?? channelFromBranch(config, branch);
}

function input(name: string): string {
  const normalized = name.toUpperCase().replace(/\s+/g, "_");
  return process.env[`INPUT_${normalized}`]?.trim() ?? process.env[`INPUT_${normalized.replace(/-/g, "_")}`]?.trim() ?? "";
}

function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }
  const delimiter = `SEMVERGE_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

function log(message: string): void {
  process.stdout.write(`[semverge] ${message}\n`);
}

function readEvent(): PushEvent | PullRequestEvent | ReleaseEvent {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) {
    return {};
  }
  return JSON.parse(readFileSync(eventPath, "utf8")) as PushEvent | PullRequestEvent;
}

function isDryRun(): boolean {
  return input("dry-run").toLowerCase() === "true";
}

type TestFailurePoint = "package-publish" | "oci-publish" | "asset-upload" | "release-finalize" | "post-release-verification";

function injectTestFailure(point: TestFailurePoint): void {
  if (process.env.SEMVERGE_TEST_FAILURE === point) {
    throw new Error(`Injected SemVerge test failure at ${point}.`);
  }
}

function localWorkspaceFile(path: string, ref?: string): string | undefined {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace || (ref !== undefined && !/^[0-9a-f]{7,40}$/i.test(ref))) {
    return undefined;
  }
  const absolute = resolve(workspace, path);
  const workspaceRelative = relative(workspace, absolute);
  if (workspaceRelative === ".." || workspaceRelative.startsWith(`..${sep}`) || !existsSync(absolute)) {
    return undefined;
  }
  try {
    return statSync(absolute).isFile() ? readFileSync(absolute, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

async function fileAtHead(client: GitHubClient, path: string, ref: string): Promise<string | null> {
  return localWorkspaceFile(path, ref) ?? await client.getFile(path, ref);
}

async function localCommitFiles(sha: string | null | undefined): Promise<string[] | undefined> {
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace || !sha || !/^[0-9a-f]{7,40}$/i.test(sha) || !existsSync(join(workspace, ".git"))) {
    return undefined;
  }
  try {
    const { stdout } = await exec(`git diff-tree --no-commit-id --name-only -r -m ${sha}`, { cwd: workspace, maxBuffer: 1024 * 1024 * 2 });
    return [...new Set(stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean))];
  } catch {
    return undefined;
  }
}

async function pullRequestChange(client: GitHubClient, pr: GitHubPullRequest) {
  const localFiles = await localCommitFiles(pr.merge_commit_sha);
  return parseChange({
    title: pr.title,
    body: pr.body ?? "",
    source: "pull_request",
    number: pr.number,
    url: pr.html_url,
    labels: pr.labels.map((label) => label.name),
    mergedAt: pr.merged_at ?? undefined,
    sha: pr.merge_commit_sha ?? undefined,
    files: localFiles ?? await client.listPullRequestFiles(pr.number)
  });
}

function commitChange(commit: GitHubCommitSummary, files?: string[]) {
  return parseChange({
    title: commit.commit.message.split(/\r?\n/, 1)[0] ?? commit.commit.message,
    body: commit.commit.message,
    source: "commit",
    sha: commit.sha,
    url: commit.html_url,
    author: commit.commit.author?.name,
    mergedAt: commit.commit.author?.date,
    files
  });
}

async function limitedMap<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < values.length; index += limit) {
    results.push(...await Promise.all(values.slice(index, index + limit).map(mapper)));
  }
  return results;
}

async function changesSinceTag(client: GitHubClient, head: string, tag: string | null) {
  const commits = tag ? (await client.compare(tag, head)).commits : await client.listCommits(head);
  const pullRequests = new Map<number, GitHubPullRequest>();
  const changes = [];
  const associations = await limitedMap(commits, 8, async (commit) => ({ commit, pullRequests: await client.commitPullRequests(commit.sha) }));
  for (const { commit, pullRequests: associated } of associations) {
    if (associated.length === 0) {
      changes.push(commitChange(commit, await localCommitFiles(commit.sha)));
      continue;
    }
    for (const pr of associated) {
      if (pr.merged_at && !pullRequests.has(pr.number)) {
        pullRequests.set(pr.number, pr);
      }
    }
  }
  changes.push(...await limitedMap([...pullRequests.values()], 8, (pr) => pullRequestChange(client, pr)));
  return changes;
}

async function latestReleaseTag(client: GitHubClient, config: SemVergeConfig): Promise<string | null> {
  let selected: { name: string; version: string } | null = null;
  for (const tag of await client.listTags()) {
    const value = tag.name.startsWith(config.release.tagPrefix) ? tag.name.slice(config.release.tagPrefix.length) : tag.name;
    if (!parseVersion(value)) {
      continue;
    }
    if (!selected || compareVersions(value, selected.version) > 0) {
      selected = { name: tag.name, version: value };
    }
  }
  return selected?.name ?? null;
}

async function loadConfig(client: GitHubClient, path: string, ref: string): Promise<SemVergeConfig> {
  const content = await fileAtHead(client, path, ref);
  return content ? parseConfig(content, path) : parseConfig("");
}

function releaseGraphMarkdown(plan: WorkspaceReleasePlan): string[] {
  const lines = ["## Release graph", ""];
  for (const { package: packageItem, plan: packagePlan, explanation } of plan.packages) {
    const directChanges = packagePlan.releaseChanges.filter((change) => !change.dependencyUpdate);
    const reasons: string[] = [];
    if (directChanges.length > 0) {
      reasons.push(`direct change: ${directChanges.map(formatChangeReference).join(", ")}`);
    }
    if (explanation.dependencies.length > 0) {
      reasons.push(`dependency update after ${explanation.dependencies.map((dependency) => `**${dependency}**`).join(", ")}`);
    }
    if (explanation.reasons.includes("fixed-workspace")) {
      reasons.push("fixed workspace: follows the shared version");
    }
    lines.push(`- **${packageItem.name}** ${packageItem.version} -> **${packagePlan.version}** — ${reasons.join("; ") || "release required by the configured strategy"}`);
  }
  if (plan.unchangedPackages.length > 0) {
    lines.push("", "## Unreleased packages", "", ...plan.unchangedPackages.map((packageItem) => {
      const reason = packageItem.private && !packageItem.releaseable ? "private package is not published in this release" : "no affected release is planned by the current strategy";
      return `- **${packageItem.name}** ${packageItem.version} — ${reason}`;
    }));
  }
  return lines;
}

interface AiReleaseNotesPackagePreview {
  packageName: string;
  preview: AiReleaseNotesPreview;
}

function aiReleaseNotesMarkdown(previews: AiReleaseNotesPackagePreview[]): string[] {
  if (previews.length === 0) {
    return [];
  }
  const lines = [
    "## AI-enhanced customer notes (review draft)",
    "",
    "These notes are advisory. The deterministic customer notes above remain authoritative until a human reviews and explicitly applies a draft.",
    ""
  ];
  for (const { packageName, preview } of previews) {
    lines.push(`### ${packageName}`, "", `- Status: **${preview.status}**`);
    if (preview.status === "generated" && preview.rendered) {
      lines.push("", "#### AI draft", "", preview.rendered.trim(), "", "#### Deterministic baseline", "", preview.deterministic.trim());
    } else {
      lines.push(`- Deterministic fallback retained: **${preview.deterministic ? "yes" : "no"}**`);
      if (preview.reason) lines.push(`- Provider status: **${preview.reason}**`);
    }
    lines.push("");
  }
  return lines;
}

function releasePrBody(plan: WorkspaceReleasePlan, config: SemVergeConfig, aiReleaseNotes: AiReleaseNotesPackagePreview[] = []): string {
  const marker = JSON.stringify({ version: plan.version, manifest: config.outputs.manifest, mode: plan.mode, channel: plan.channel, promotion: plan.promotion });
  const packageLines = plan.packages.map(({ package: packageItem, plan: packagePlan }) => `- **${packageItem.name}**: ${packageItem.version} -> **${packagePlan.version}** (${packagePlan.bump}, ${packagePlan.channel}${packagePlan.promotion ? ", promotion" : ""})`);
  const notes = plan.packages.map(({ package: packageItem, plan: packagePlan }) => `### ${packageItem.name}\n\n${packagePlan.customerNotes.trim()}`).join("\n\n");
  const lines = [
    `<!-- semverge-release ${marker} -->`,
    `# SemVerge release ${plan.version}`,
    "",
    `This ${plan.mode} release prepares version changes and release communication for ${plan.packages.length} package(s).`,
    "",
    "## Release channel",
    "",
    `- Channel: **${plan.channel}**`,
    `- Promotion: **${plan.promotion ? "yes" : "no"}**`,
    "",
    "## Package versions",
    "",
    ...packageLines,
    "",
    readinessMarkdown(plan.readiness).trim(),
    "",
    ...communicationQualityMarkdown(plan.communicationQuality ?? []),
    "",
    ...releaseGraphMarkdown(plan),
    "",
    "## Customer-facing notes",
    "",
    notes || "No customer-facing updates are included in this release.",
    "",
    ...aiReleaseNotesMarkdown(aiReleaseNotes),
    "",
    "---",
    "Generated by SemVerge. Merge this pull request to publish the tag and GitHub release."
  ];
  return `${lines.join("\n").trim()}\n`;
}

function fileMapFromPlan(plan: WorkspaceReleasePlan): Record<string, string> {
  return Object.fromEntries(plan.outputs.map((output) => [output.path, output.content]));
}

async function runReadinessCommands(config: SemVergeConfig): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  for (const command of config.readiness.commands) {
    try {
      log(`Running readiness check: ${command.name}`);
      await exec(command.run, { cwd: workspace, shell: process.env.ComSpec ?? "/bin/sh", maxBuffer: 1024 * 1024 * 20 });
      results[command.name] = true;
    } catch {
      results[command.name] = false;
      log(`Readiness check failed: ${command.name}`);
    }
  }
  return results;
}

async function checkLink(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let response = await fetch(url, { method: "HEAD", redirect: "manual", signal: controller.signal });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, { method: "GET", redirect: "manual", signal: controller.signal });
    }
    return response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface PostReleaseVerificationOptions {
  delayed?: boolean;
}

async function appendMonitoringComment(client: GitHubClient, releaseEvent: NonNullable<ReleaseEvent["release"]>, targetCommit: string, config: SemVergeConfig, report: PostReleaseVerificationReport): Promise<void> {
  if (!config.health.monitoring?.comment || !targetCommit) {
    return;
  }
  const releasePullRequest = (await client.commitPullRequests(targetCommit)).find((pullRequest) => isSemVergeReleasePullRequest(pullRequest, config));
  if (!releasePullRequest) {
    log(`Could not find the SemVerge release PR for delayed monitoring of ${releaseEvent.tag_name}; no history comment was added.`);
    return;
  }
  const runId = process.env.GITHUB_RUN_ID?.trim() || targetCommit;
  const marker = `<!-- semverge-monitor ${releaseEvent.tag_name} ${runId} -->`;
  const comments = await client.listIssueComments(releasePullRequest.number);
  if (comments.some((comment) => comment.body?.includes(marker))) {
    log(`Delayed monitoring comment already exists for ${releaseEvent.tag_name} run ${runId}.`);
    return;
  }
  const markdown = postReleaseVerificationMarkdown(report).trim();
  await client.createIssueComment(releasePullRequest.number, `${marker}\n\n${markdown}\n\nObserved by the explicit SemVerge delayed-monitoring workflow.`);
  log(`Recorded delayed monitoring history for ${releaseEvent.tag_name} on release PR #${releasePullRequest.number}.`);
}

async function recordMonitoringCheckRun(client: GitHubClient, releaseEvent: NonNullable<ReleaseEvent["release"]>, targetCommit: string, config: SemVergeConfig, report: PostReleaseVerificationReport): Promise<void> {
  if (!config.health.monitoring?.checkRun || !targetCommit) {
    return;
  }
  const name = "SemVerge delayed monitoring";
  const runId = process.env.GITHUB_RUN_ID?.trim() || targetCommit;
  const externalId = `semverge-monitor:${releaseEvent.tag_name}:${runId}`;
  const existing = await client.listCheckRuns(targetCommit, name);
  if (existing.some((checkRun) => checkRun.external_id === externalId)) {
    log(`Delayed monitoring check run already exists for ${releaseEvent.tag_name} run ${runId}.`);
    return;
  }
  const conclusion = report.status === "healthy" ? "success" : report.status === "failed" ? "failure" : "neutral";
  await client.createCheckRun({
    name,
    headSha: targetCommit,
    externalId,
    conclusion,
    title: `Delayed release monitoring: ${report.status}`,
    summary: postReleaseVerificationMarkdown(report).trim()
  });
  log(`Recorded delayed monitoring check run for ${releaseEvent.tag_name}.`);
}

async function runPostReleaseVerification(client: GitHubClient, releaseEvent: NonNullable<ReleaseEvent["release"]>, config: SemVergeConfig, options: PostReleaseVerificationOptions = {}): Promise<void> {
  if (!config.health.enabled) {
    log("Post-release verification is disabled.");
    return;
  }
  injectTestFailure("post-release-verification");
  const releaseDetails = await client.getReleaseByTag(releaseEvent.tag_name);
  const targetCommit = releaseDetails?.target_commitish || releaseEvent.target_commitish || process.env.GITHUB_SHA || "";
  const workflowRuns = targetCommit ? await client.listWorkflowRuns(targetCommit) : [];
  const workflowObservations = workflowRuns.map((run) => ({ name: run.name, status: run.status, conclusion: run.conclusion, url: run.html_url }));
  const links = await Promise.all(config.health.requiredLinks.map(async (url) => ({ url, status: await checkLink(url) })));
  const observation: PostReleaseVerificationObservation = {
    tag: releaseEvent.tag_name,
    assets: (releaseDetails?.assets ?? releaseEvent.assets ?? []).map((asset) => asset.name),
    workflows: workflowObservations,
    links
  };
  const report = evaluatePostReleaseVerification(config.health, observation);
  const markdown = postReleaseVerificationMarkdown(report);
  log(markdown.trim());
  setOutput("post-release-verification", JSON.stringify(report));
  setOutput("health", JSON.stringify(report));
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, `${markdown}\n`, "utf8");
  }
  const transactionBody = releaseDetails?.body ?? releaseEvent.body;
  const transaction = parseReleaseTransactionBody(transactionBody);
  const releaseId = releaseDetails?.id ?? releaseEvent.id;
  if (transaction && typeof releaseId === "number") {
    let next = transaction;
    if (report.status === "failed") {
      next = recordReleaseTransactionEvent(next, {
        key: `verification:${releaseEvent.tag_name}`,
        kind: "post-release-verification",
        target: releaseEvent.tag_name,
        status: "failed",
        detail: "Post-release verification reported a failed check."
      });
    } else {
      const verification = {
        key: `verification:${releaseEvent.tag_name}`,
        kind: "post-release-verification",
        target: releaseEvent.tag_name,
        detail: `Post-release verification completed with status ${report.status}.`
      };
      next = next.phase === "completed" ? recordReleaseTransactionEvent(next, verification) : advanceReleaseTransaction(next, "verified", verification);
      const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
      const pluginRegistry = await createPluginRegistryFromConfig(config, workspace);
      const verifyRes = await runTransactionOwnedPluginHook(
        pluginRegistry,
        "verify",
        { sourceCommit: targetCommit, version: transaction.version, packages: [], changes: [], config },
        next,
        recordReleaseTransactionEvent
      );
      if (verifyRes.transaction) next = verifyRes.transaction;
      if (next.phase !== "completed") {
        next = advanceReleaseTransaction(next, "completed", {
          key: `completion:${releaseEvent.tag_name}`,
          kind: "release-completed",
          target: releaseEvent.tag_name,
          detail: "The release transaction has completed its configured verification steps."
        });
      }
    }
    await client.updateRelease(releaseId, {
      body: updateReleaseTransactionBody(transactionBody ?? "", next)
    });
    setOutput("transaction", JSON.stringify(next));
  }
  if (options.delayed) {
    await appendMonitoringComment(client, releaseEvent, targetCommit, config, report);
    await recordMonitoringCheckRun(client, releaseEvent, targetCommit, config, report);
  }
  if (report.status === "failed") {
    throw new Error(`Post-release verification failed for ${releaseEvent.tag_name}.`);
  }
}

async function monitorReleases(client: GitHubClient, config: SemVergeConfig, tagOverride: string): Promise<void> {
  const monitoring = config.health.monitoring;
  if (!config.health.enabled || !monitoring?.enabled) {
    log("Delayed release monitoring is disabled; no release history was changed.");
    return;
  }
  const requestedTag = tagOverride.trim();
  const releases = requestedTag
    ? [await client.getReleaseByTag(requestedTag)]
    : (await client.listReleases()).filter((release) => {
      if (release.draft === true || !versionFromReleaseTag(release.tag_name, config.release.tagPrefix)) {
        return false;
      }
      const publishedAt = release.published_at ?? release.created_at;
      const timestamp = publishedAt ? Date.parse(publishedAt) : Number.NaN;
      return Number.isFinite(timestamp) && Date.now() - timestamp <= monitoring.windowHours * 60 * 60 * 1000;
    });
  if (requestedTag && !releases[0]) {
    throw new Error(`SemVerge could not find the release ${requestedTag} for delayed monitoring.`);
  }
  const targets = releases.filter((release): release is NonNullable<typeof release> => Boolean(release));
  if (targets.length === 0) {
    log("No published semantic release was found inside the delayed-monitoring window.");
    return;
  }
  const failures: string[] = [];
  for (const release of targets) {
    try {
      await runPostReleaseVerification(client, release, config, { delayed: true });
    } catch (error) {
      failures.push(`${release.tag_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Delayed release monitoring failed:\n${failures.join("\n")}`);
  }
}

async function prepareRelease(client: GitHubClient, head: string, config: SemVergeConfig, branch: string, defaultBranch: string, requestedChannel = ""): Promise<void> {
  const baseCommit = await client.getCommit(head);
  const repositoryTree = await client.getTree(baseCommit.tree.sha);
  const allPaths = repositoryTree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const manifestPaths = allPaths.filter((path) => path === "package.json" || path.endsWith("/package.json") || path === "pyproject.toml" || path.endsWith("/pyproject.toml") || path === "Cargo.toml" || path.endsWith("/Cargo.toml") || path === "pnpm-workspace.yaml");
  const manifestEntries = await Promise.all(manifestPaths.map(async (path) => [path, await fileAtHead(client, path, head)] as const));
  const manifestFiles = Object.fromEntries(manifestEntries.flatMap(([path, content]) => content === null ? [] : [[path, content]]));
  const discovered = discoverPackages(manifestFiles, allPaths, config);
  let changes = await changesSinceTag(client, head, await latestReleaseTag(client, config));
  let channel = selectedChannel(config, changes, branch, requestedChannel);
  let effectiveConfig = channel ? withChannelPolicy(config, channel.name) : config;
  if (channel && effectiveConfig.release.tagPrefix !== config.release.tagPrefix) {
    changes = await changesSinceTag(client, head, await latestReleaseTag(client, effectiveConfig));
    channel = selectedChannel(config, changes, branch, requestedChannel) ?? channel;
    effectiveConfig = withChannelPolicy(config, channel.name);
  }
  const channelBranch = channel?.policy.branch?.replace(/^refs\/heads\//, "");
  if (!channelBranchAllowed(branch, defaultBranch, channelBranch)) {
    log(`Ignoring push to ${branch}; ${channel ? `${channel.name} channel requires ${channelBranch ?? defaultBranch}` : `release preparation runs on ${defaultBranch}`}.`);
    return;
  }
  const baseBranch = channelBaseBranch(config, channel?.name, defaultBranch);
  const packageOutputPaths = discovered.packages.flatMap((packageItem) => {
    const prefix = discovered.mode === "independent" && packageItem.directory ? `${packageItem.directory}/` : "";
    return Object.values(effectiveConfig.outputs).map((path) => prefix + path);
  });
  const neededPaths = [...new Set([
    ...Object.keys(manifestFiles),
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    ...discovered.packages.filter((packageItem) => packageItem.ecosystem === "node" && packageItem.directory).flatMap((packageItem) => [`${packageItem.directory}/package-lock.json`, `${packageItem.directory}/npm-shrinkwrap.json`]),
    ...Object.values(effectiveConfig.outputs),
    ...packageOutputPaths,
    ...effectiveConfig.readiness.requiredFiles,
    ...effectiveConfig.readiness.tasks.flatMap((task) => task.file ? [task.file] : [])
  ])];
  const fileEntries = await Promise.all(neededPaths.map(async (path) => [path, await fileAtHead(client, path, head)] as const));
  const files: Record<string, string> = {
    ...manifestFiles,
    ...Object.fromEntries(fileEntries.flatMap(([path, content]) => content === null ? [] : [[path, content]]))
  };
  const availableLabels = new Set(changes.flatMap((change) => change.labels));
  const availableFiles = new Set<string>();
  for (const requiredFile of [...effectiveConfig.readiness.requiredFiles, ...effectiveConfig.readiness.tasks.flatMap((task) => task.file ? [task.file] : [])]) {
    if (files[requiredFile] !== undefined) {
      availableFiles.add(requiredFile);
    }
  }
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const registry = await createPluginRegistryFromConfig(effectiveConfig, workspace);
  const plan = buildWorkspaceReleasePlan({
    packages: discovered.packages,
    mode: discovered.mode,
    files,
    config: effectiveConfig,
    changes,
    readinessContext: { availableLabels, availableFiles, commandResults: await runReadinessCommands(effectiveConfig) },
    registry
  });
  setOutput("version", plan.version);
  setOutput("release-channel", plan.channel);
  setOutput("release-promotion", String(plan.promotion));
  if (!plan.hasRelease) {
    log("No release-worthy changes were found.");
    return;
  }
  log(`Planned ${plan.version} (${plan.mode}, ${plan.channel}${plan.promotion ? " promotion" : ""}) from ${plan.releaseChanges.length} change(s).`);
  if (isDryRun()) {
    log(JSON.stringify(plan, null, 2));
    return;
  }

  const aiReleaseNotes: AiReleaseNotesPackagePreview[] = effectiveConfig.ai?.enabled && effectiveConfig.ai.releaseNotes === true
    ? await Promise.all(plan.packages.map(async ({ package: packageItem, plan: packagePlan }) => ({
      packageName: packageItem.name,
      preview: await buildAiReleaseNotesPreview(packagePlan, effectiveConfig.ai)
    })))
    : [];
  for (const { packageName, preview } of aiReleaseNotes) {
    if (preview.status === "unavailable") {
      log(`AI release-notes draft unavailable for ${packageName} (${preview.reason ?? "provider"}); deterministic notes were retained.`);
    }
  }

  const repository = await client.repositoryInfo();
  const entries = new Map<string, string>(Object.entries(fileMapFromPlan(plan)));
  for (const change of plan.versionChanges) {
    entries.set(change.path, change.content);
  }
  const releaseTree = await client.createTree(baseCommit.tree.sha, [...entries].map(([path, content]) => ({ path, mode: "100644", type: "blob", content })));
  const commit = await client.createCommit(`chore(release): prepare ${plan.version}`, releaseTree.sha, head);
  const branchRef = `heads/${effectiveConfig.release.branch}`;
  if (await client.getRef(branchRef)) {
    await client.updateRef(branchRef, commit.sha, true);
  } else {
    await client.createRef(branchRef, commit.sha);
  }

  const titleVersion = plan.mode === "independent" ? plan.version : releaseTagName(effectiveConfig.release.tagPrefix, plan.version);
  const title = `chore(release): ${titleVersion}`;
  const body = releasePrBody(plan, effectiveConfig, aiReleaseNotes);
  const existing = (await client.listPullRequests({ state: "open", head: `${repository.owner.login}:${effectiveConfig.release.branch}`, base: baseBranch }))[0];
  const releasePr = existing ? await client.updatePullRequest(existing.number, { title, body }) : await client.createPullRequest({ title, body, head: effectiveConfig.release.branch, base: baseBranch });
  setOutput("release-pr", releasePr.html_url);
  log(`${existing ? "Updated" : "Created"} release PR: ${releasePr.html_url}`);
}

function isSemVergeReleasePullRequest(pr: GitHubPullRequest, config: SemVergeConfig): boolean {
  const releaseBranches = new Set([
    config.release.branch,
    ...Object.values(config.release.channels).flatMap((policy) => policy.releaseBranch ? [policy.releaseBranch.replace(/^refs\/heads\//, "")] : [])
  ]);
  return (releaseBranches.has(pr.head.ref) || pr.head.ref.startsWith("semverge/")) && /release/i.test(pr.title);
}

interface PublishedPackage {
  id: string;
  name: string;
  directory: string;
  version: string;
  ecosystem?: Ecosystem;
  customerNotes?: string;
  private?: boolean;
  releaseable?: boolean;
}

interface SemVergeManifest {
  schemaVersion?: number;
  mode?: "single" | "fixed" | "independent";
  version?: string;
  channel?: string;
  promotion?: boolean;
  readiness?: { passed?: boolean };
  packages?: PublishedPackage[];
}

type ReleaseProgress = ReleaseTransaction;

interface ReleaseExecution {
  packageItem: PublishedPackage;
  tag: string;
  customerNotes: string;
  release: GitHubRelease;
}

function independentTagName(config: SemVergeConfig, packageItem: PublishedPackage): string {
  const safeName = packageItem.name.replace(/^@/, "").replace(/[\\/]/g, "-");
  return `${config.release.independentTagPrefix}${safeName}@${packageItem.version}`;
}

function packageTagName(config: SemVergeConfig, mode: SemVergeManifest["mode"], packageItem: PublishedPackage): string {
  return mode === "independent" ? independentTagName(config, packageItem) : releaseTagName(config.release.tagPrefix, packageItem.version);
}

function packageKey(packageItem: PublishedPackage, index: number): string {
  return packageItem.id || packageItem.name || packageItem.directory || `package-${index + 1}`;
}

function packageEcosystem(packageItem: PublishedPackage): Ecosystem {
  return packageItem.ecosystem ?? "node";
}

function ociReleaseVersion(mode: SemVergeManifest["mode"], version: string): string {
  const normalized = version.trim();
  if (mode === "independent") {
    throw new Error("SemVerge OCI image publication requires a single or fixed workspace release; independent workspaces need package-specific image mappings.");
  }
  if (!parseVersion(normalized) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(normalized)) {
    throw new Error(`SemVerge cannot use ${version} as an OCI image tag; release-level OCI publication requires a SemVer-compatible Docker tag.`);
  }
  return normalized;
}

function initialReleaseProgress(version: string, sourceCommit: string, publishablePackages: PublishedPackage[], releaseTags: string[], artifactDigestMap: Record<string, string>, config: SemVergeConfig): ReleaseProgress {
  const packageIds = publishablePackages.map(packageKey);
  const packagePublishingTargets = publishablePackages
    .map(packageEcosystem)
    .filter((ecosystem) => publishConfigForEcosystem(config, ecosystem).enabled)
    .map((ecosystem) => ecosystem === "node" ? "npm" : ecosystem);
  const ociImages = config.publishing.oci.enabled ? [...config.publishing.oci.images] : [];
  const publishingTargets = [...new Set([...packagePublishingTargets, ...ociImages.map((image) => `oci:${image}`)])];
  const alreadyPublishedPackageIds = publishablePackages
    .filter((packageItem) => !publishConfigForEcosystem(config, packageEcosystem(packageItem)).enabled)
    .map(packageKey);
  let transaction = createReleaseTransaction({ version, sourceCommit, packageIds, tagNames: releaseTags, publishingTargets, ociImages, alreadyPublishedPackageIds, artifactDigests: artifactDigestMap, npmEnabled: config.publishing.npm.enabled, npmProvenance: config.publishing.npm.provenance });
  transaction = advanceReleaseTransaction(transaction, "approved", { key: "approval", kind: "approval-verified", target: sourceCommit, detail: "Release PR merge commit verified." });
  transaction = advanceReleaseTransaction(transaction, "prepared", { key: "release-inputs", kind: "release-plan-prepared", target: version, detail: "Release manifest, package set, and tags validated." });
  return advanceReleaseTransaction(transaction, "built", { key: "artifact-build", kind: "artifacts-built", target: sourceCommit, detail: "Workspace and configured artifacts passed pre-publication validation." });
}

function parseReleaseProgress(body: string | null | undefined): ReleaseProgress | null {
  return parseReleaseTransactionBody(body);
}

function releaseBody(customerNotes: string, progress: ReleaseProgress): string {
  return releaseTransactionBody(customerNotes, progress);
}

function mergeReleaseProgress(states: Array<ReleaseProgress | null>, expected: ReleaseProgress): ReleaseProgress {
  return mergeReleaseTransactions(states, expected);
}

async function recordOciDigest(progress: ReleaseProgress, image: string, version: string, idempotency: "registry" | "declared" | undefined): Promise<ReleaseProgress> {
  if (idempotency !== "registry") {
    return progress;
  }
  try {
    const digest = await ociImageVersionDigest(image, version);
    if (digest) {
      progress.ociDigests ??= {};
      progress.ociDigests[image] = digest;
    }
  } catch (error) {
    log(`Could not record the OCI digest for ${image}:${version}; release verification will report the digest evidence as unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return progress;
}

async function persistReleaseProgress(client: GitHubClient, executions: ReleaseExecution[], progress: ReleaseProgress, finalize = false): Promise<void> {
  for (const execution of executions) {
    if (execution.release.draft !== true) {
      continue;
    }
    const updated = await client.updateRelease(execution.release.id, {
      body: releaseBody(execution.customerNotes, progress),
      tag_name: execution.tag,
      ...(finalize ? { draft: false } : {})
    });
    execution.release = { ...execution.release, ...updated, draft: finalize ? false : (updated.draft ?? execution.release.draft ?? true) };
  }
}

async function persistFinalTransactionState(client: GitHubClient, executions: ReleaseExecution[], progress: ReleaseProgress): Promise<void> {
  for (const execution of executions) {
    const updated = await client.updateRelease(execution.release.id, {
      body: updateReleaseTransactionBody(execution.release.body ?? releaseBody(execution.customerNotes, progress), progress),
      tag_name: execution.tag
    });
    execution.release = { ...execution.release, ...updated, body: updated.body ?? execution.release.body };
  }
}

function collectFiles(target: string, root: string): string[] {
  const absolute = resolve(root, target);
  const relativePath = relative(root, absolute);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Artifact path must stay inside the workspace: ${target}`);
  }
  if (!existsSync(absolute)) {
    throw new Error(`Expected artifact does not exist: ${target}`);
  }
  if (statSync(absolute).isFile()) {
    return [absolute];
  }
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => collectFiles(join(target, entry.name), root));
}

function artifactDigests(files: string[], workspace: string): Record<string, string> {
  return Object.fromEntries(files.map((file) => {
    const path = relative(workspace, file).split(sep).join("/");
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return [path, digest];
  }));
}

async function publishRelease(client: GitHubClient, pr: GitHubPullRequest, config: SemVergeConfig): Promise<void> {
  const mergeSha = pr.merge_commit_sha;
  if (!mergeSha) {
    throw new Error("The SemVerge release PR does not have a merge commit SHA.");
  }
  const manifestContent = await client.getFile(config.outputs.manifest, mergeSha);
  const manifest: SemVergeManifest = manifestContent ? JSON.parse(manifestContent) as SemVergeManifest : {};
  if (manifest.channel && manifest.channel.trim().toLowerCase() !== "stable") {
    config = withChannelPolicy(config, manifest.channel);
  }
  setOutput("release-channel", manifest.channel ?? "stable");
  setOutput("release-promotion", String(manifest.promotion === true));
  if (manifest.readiness?.passed === false) {
    throw new Error("Release readiness checks are incomplete; SemVerge did not publish the release.");
  }

  let packages = manifest.packages ?? [];
  if (packages.length === 0) {
    const packageJson = await client.getFile("package.json", mergeSha);
    if (!packageJson) {
      throw new Error("The merged SemVerge release PR does not contain a release manifest or package.json.");
    }
    const value: unknown = JSON.parse(packageJson);
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as Record<string, unknown>).version !== "string") {
      throw new Error("The merged package.json does not contain a valid version.");
    }
    packages = [{ id: "root", name: typeof (value as Record<string, unknown>).name === "string" ? (value as Record<string, unknown>).name as string : "root", directory: "", version: (value as Record<string, unknown>).version as string, customerNotes: config.outputs.customerNotes }];
  }
  const mode = manifest.mode ?? "single";
  const publishablePackages = mode === "single" ? packages : packages.filter((packageItem) => !packageItem.private && packageItem.releaseable !== false);
  const releasePackages = mode === "fixed" ? [publishablePackages[0] ?? packages[0]].filter((packageItem): packageItem is PublishedPackage => Boolean(packageItem)) : publishablePackages;
  if (releasePackages.length === 0) {
    throw new Error("SemVerge found no packages to publish.");
  }
  const version = manifest.version ?? packages.map((packageItem) => `${packageItem.name}@${packageItem.version}`).join(", ");
  const ociConfig = config.publishing.oci;
  if (ociConfig.enabled) {
    if (ociConfig.images.length === 0) {
      throw new Error("SemVerge OCI publishing requires at least one image repository.");
    }
    if (!ociConfig.idempotency) {
      throw new Error("SemVerge requires publishing.oci.idempotency for custom commands; choose registry or declared.");
    }
    for (const image of ociConfig.images) {
      parseOciImageRepository(image);
    }
  }
  const ociVersion = ociConfig.enabled ? ociReleaseVersion(mode, version) : "";
  for (const ecosystem of ["node", "python", "rust"] as const) {
    const publisher = publishConfigForEcosystem(config, ecosystem);
    if (publisher.enabled && !publisher.idempotency) {
      throw new Error(`SemVerge requires publishing.${ecosystem}.idempotency for custom commands; choose registry or declared.`);
    }
  }
  assertNpmProvenanceEnvironment(config.publishing.npm);
  const publishingEnabled = ociConfig.enabled || releasePackages.some((packageItem) => publishConfigForEcosystem(config, packageEcosystem(packageItem)).enabled);

  // Build and validate every artifact before creating a tag or draft release. A failed
  // build must not leave any release-side state behind for the next retry.
  const artifactCommand = input("artifact-command") || config.artifacts.command;
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  if (artifactCommand || config.artifacts.paths.length > 0 || publishingEnabled) {
    await assertWorkspaceAtCommit(workspace, mergeSha);
  }
  if (artifactCommand) {
    log(`Running artifact command: ${artifactCommand}`);
    await exec(artifactCommand, { cwd: workspace, shell: process.env.ComSpec ?? "/bin/sh", maxBuffer: 1024 * 1024 * 20 });
  }
  const artifactFiles = config.artifacts.paths.flatMap((path) => collectFiles(path, workspace));
  const artifactDigestMap = artifactDigests(artifactFiles, workspace);

  const releaseInputs = await Promise.all(releasePackages.map(async (packageItem) => {
    const tag = packageTagName(config, mode, packageItem);
    const existingTag = await client.getRef(`tags/${tag}`);
    if (existingTag && existingTag.object.sha !== mergeSha) {
      throw new Error(`Release tag ${tag} already points to ${existingTag.object.sha}, not the merged release commit ${mergeSha}.`);
    }
    const existingRelease = await client.getReleaseByTag(tag);
    const existingProgress = parseReleaseProgress(existingRelease?.body);
    if (existingRelease?.draft === true && !existingProgress) {
      throw new Error(`Draft release ${tag} is missing SemVerge transaction state; verify it before retrying.`);
    }
    if (existingRelease && existingRelease.draft !== true && existingProgress?.published !== true) {
      throw new Error(`Release ${tag} already exists outside SemVerge's transactional state; verify it before retrying.`);
    }
    const customerNotesPath = packageItem.customerNotes ?? (packageItem.directory ? `${packageItem.directory}/${config.outputs.customerNotes}` : config.outputs.customerNotes);
    const customerNotes = await client.getFile(customerNotesPath, mergeSha) ?? `Release ${packageItem.version}`;
    return { packageItem, tag, customerNotes, existingRelease, existingProgress };
  }));

  const expectedProgress = initialReleaseProgress(version, mergeSha, publishablePackages, releaseInputs.map((item) => item.tag), artifactDigestMap, config);
  let progress = mergeReleaseProgress(releaseInputs.map((item) => item.existingProgress), expectedProgress);
  const pluginRegistry = await createPluginRegistryFromConfig(config, workspace);
  const pluginContextInput = {
    sourceCommit: mergeSha,
    version,
    packages: publishablePackages.map((p) => ({ id: p.id, name: p.name, version: p.version, ecosystem: p.ecosystem ?? "node", directory: p.directory, private: p.private ?? false, releaseable: p.releaseable ?? true })),
    changes: [],
    config
  };
  const executions: ReleaseExecution[] = [];
  const persist = async (tx: ReleaseTransaction) => {
    progress = tx;
    if (executions.length > 0) {
      await persistReleaseProgress(client, executions, progress);
    }
  };
  const validateRes = await runTransactionOwnedPluginHook(pluginRegistry, "validate", pluginContextInput, progress, recordReleaseTransactionEvent, persist);
  if (validateRes.transaction) progress = validateRes.transaction;
  const prepareRes = await runTransactionOwnedPluginHook(pluginRegistry, "prepare", pluginContextInput, progress, recordReleaseTransactionEvent, persist);
  if (prepareRes.transaction) progress = prepareRes.transaction;

  const buildRes = await runTransactionOwnedPluginHook(pluginRegistry, "build", pluginContextInput, progress, recordReleaseTransactionEvent, persist);
  if (buildRes.transaction) progress = buildRes.transaction;

  for (const item of releaseInputs) {
    let release = item.existingRelease;
    if (!release) {
      release = await client.createRelease({
        tag_name: item.tag,
        target_commitish: mergeSha,
        name: item.tag,
        body: releaseBody(item.customerNotes, progress),
        prerelease: Boolean(item.packageItem.version.includes("-")),
        draft: true
      });
      release = { ...release, draft: true };
    }
    executions.push({ packageItem: item.packageItem, tag: item.tag, customerNotes: item.customerNotes, release });
    progress = recordReleaseTransactionEvent(progress, {
      key: `draft:${item.tag}`,
      kind: "release-draft-prepared",
      target: item.tag,
      detail: item.existingRelease ? "Existing SemVerge draft detected; resume is safe." : "Draft GitHub release created for transactional publication."
    });
    log(`${item.existingRelease ? "Resuming" : "Prepared draft"} GitHub release for ${item.packageItem.name}: ${release.html_url}`);
  }

  // The release body is the durable transaction record. Updating it after every
  // successful side effect lets a later run resume only the unfinished steps.
  await persistReleaseProgress(client, executions, progress);

  const publishRes = await runTransactionOwnedPluginHook(pluginRegistry, "publish", pluginContextInput, progress, recordReleaseTransactionEvent, persist);
  if (publishRes.transaction) progress = publishRes.transaction;

  const packageIds = new Map(publishablePackages.map((packageItem, index) => [packageKey(packageItem, index), packageItem]));
  for (const [id, packageItem] of packageIds) {
    if (progress.publishedPackages.includes(id)) {
      continue;
    }
    const packageWorkspace = packageItem.directory ? resolve(workspace, packageItem.directory) : workspace;
    const ecosystem = packageEcosystem(packageItem);
    const publisher = publishConfigForEcosystem(config, ecosystem);
    if (!publisher.enabled) {
      progress.publishedPackages = [...new Set([...progress.publishedPackages, id])];
      progress = recordReleaseTransactionEvent(progress, { key: `package:${id}`, kind: "package-publication-skipped", target: packageItem.name, detail: `No ${publisherName(ecosystem)} publisher is enabled for this package; SemVerge recorded it as intentionally unmanaged.` });
      await persistReleaseProgress(client, executions, progress);
      continue;
    }
    const alreadyPublished = publisher.idempotency === "registry"
      ? ecosystem === "node"
        ? await npmVersionExists(packageItem.name, packageItem.version, packageWorkspace)
        : await registryVersionExists(ecosystem, packageItem.name, packageItem.version)
      : false;
    if (alreadyPublished) {
      log(`Found ${packageItem.name}@${packageItem.version} in the ${publisherName(ecosystem)} registry; treating publication as already complete.`);
      progress.publishedPackages = [...new Set([...progress.publishedPackages, id])];
      progress = recordReleaseTransactionEvent(progress, { key: `package:${id}`, kind: "package-published", target: packageItem.name, detail: `${publisherName(ecosystem)} already contains the requested version; no duplicate publish was attempted.` });
      await persistReleaseProgress(client, executions, progress);
      continue;
    }
    const publishCommand = ecosystem === "node" ? npmPublishCommand(config.publishing.npm) : publisher.command;
    log(`Publishing ${packageItem.name} with ${publisherName(ecosystem)} command.`);
    try {
      injectTestFailure("package-publish");
      await exec(publishCommand, { cwd: packageWorkspace, shell: process.env.ComSpec ?? "/bin/sh", maxBuffer: 1024 * 1024 * 20 });
    } catch (error) {
      progress = recordReleaseTransactionEvent(progress, { key: `package:${id}`, kind: "package-published", target: packageItem.name, status: "failed", detail: "Package publication failed; inspect runner logs before retrying." });
      await persistReleaseProgress(client, executions, progress);
      throw error;
    }
    progress.publishedPackages = [...new Set([...progress.publishedPackages, id])];
    progress = recordReleaseTransactionEvent(progress, { key: `package:${id}`, kind: "package-published", target: packageItem.name });
    await persistReleaseProgress(client, executions, progress);
  }

  if (ociConfig.enabled) {
    for (const image of ociConfig.images) {
      if (progress.publishedOciImages.includes(image)) {
        continue;
      }
      const alreadyPublished = ociConfig.idempotency === "registry" ? await ociImageVersionExists(image, ociVersion) : false;
      if (alreadyPublished) {
        log(`Found ${image}:${ociVersion} in the OCI registry; treating publication as already complete.`);
        progress.publishedOciImages = [...new Set([...progress.publishedOciImages, image])];
        progress = await recordOciDigest(progress, image, ociVersion, ociConfig.idempotency);
        progress = recordReleaseTransactionEvent(progress, { key: `oci:${image}`, kind: "oci-image-published", target: `${image}:${ociVersion}`, detail: "The OCI registry already contains the requested image tag; no duplicate push was attempted." });
        await persistReleaseProgress(client, executions, progress);
        continue;
      }
      const publishCommand = renderOciPublishCommand(ociConfig.command, image, ociVersion);
      log(`Publishing OCI image ${image}:${ociVersion}.`);
      try {
        injectTestFailure("oci-publish");
        await exec(publishCommand, { cwd: workspace, shell: process.env.ComSpec ?? "/bin/sh", maxBuffer: 1024 * 1024 * 20 });
      } catch (error) {
        progress = recordReleaseTransactionEvent(progress, { key: `oci:${image}`, kind: "oci-image-published", target: `${image}:${ociVersion}`, status: "failed", detail: "OCI image publication failed; inspect runner logs before retrying." });
        await persistReleaseProgress(client, executions, progress);
        throw error;
      }
      progress.publishedOciImages = [...new Set([...progress.publishedOciImages, image])];
      progress = await recordOciDigest(progress, image, ociVersion, ociConfig.idempotency);
      progress = recordReleaseTransactionEvent(progress, { key: `oci:${image}`, kind: "oci-image-published", target: `${image}:${ociVersion}` });
      await persistReleaseProgress(client, executions, progress);
    }
  }

  const uploadRes = await runTransactionOwnedPluginHook(pluginRegistry, "upload", pluginContextInput, progress, recordReleaseTransactionEvent, persist);
  if (uploadRes.transaction) progress = uploadRes.transaction;

  for (const execution of executions) {
    if (execution.release.draft !== true) {
      continue;
    }
    const uploaded = new Set(progress.uploadedAssets[execution.tag] ?? []);
    const existingAssets = new Set((execution.release.assets ?? []).map((asset) => asset.name));
    for (const file of artifactFiles) {
      const assetName = basename(file);
      if (existingAssets.has(assetName)) {
        uploaded.add(assetName);
        progress = recordReleaseTransactionEvent(progress, { key: `asset:${execution.tag}:${assetName}`, kind: "asset-detected", target: assetName, detail: "Release already contains this asset; no duplicate upload was attempted." });
        log(`Release artifact already attached for ${execution.tag}: ${assetName}`);
        continue;
      }
      try {
        injectTestFailure("asset-upload");
        await client.uploadReleaseAsset(execution.release, file);
      } catch (error) {
        progress = recordReleaseTransactionEvent(progress, { key: `asset:${execution.tag}:${assetName}`, kind: "asset-uploaded", target: assetName, status: "failed", detail: "Release asset upload failed; inspect runner logs before retrying." });
        await persistReleaseProgress(client, executions, progress);
        throw error;
      }
      uploaded.add(assetName);
      log(`Uploaded release artifact for ${execution.tag}: ${assetName}`);
      progress.uploadedAssets[execution.tag] = [...uploaded];
      progress = recordReleaseTransactionEvent(progress, { key: `asset:${execution.tag}:${assetName}`, kind: "asset-uploaded", target: assetName });
      await persistReleaseProgress(client, executions, progress);
    }
    progress.uploadedAssets[execution.tag] = [...uploaded];
  }

  progress.ready = true;
  progress = recordReleaseTransactionEvent(progress, { key: "release-ready", kind: "release-ready", target: version, detail: "All package, OCI image, and release asset steps completed." });
  await persistReleaseProgress(client, executions, progress);
  progress.published = true;
  progress = advanceReleaseTransaction(progress, "published", { key: "release-published", kind: "release-published", target: version, detail: "All transactional side effects completed; GitHub release drafts are being finalized." });
  injectTestFailure("release-finalize");
  await persistReleaseProgress(client, executions, progress, true);

  const announceRes = await runTransactionOwnedPluginHook(pluginRegistry, "announce", pluginContextInput, progress, recordReleaseTransactionEvent, persist);
  if (announceRes.transaction) progress = announceRes.transaction;

  if (mode === "independent") {
    const versions = publishablePackages.map((packageItem) => packageItem.version).filter((value) => parseVersion(value));
    const anchor = versions.sort((left, right) => (parseVersion(right)?.major ?? 0) - (parseVersion(left)?.major ?? 0) || (parseVersion(right)?.minor ?? 0) - (parseVersion(left)?.minor ?? 0) || (parseVersion(right)?.patch ?? 0) - (parseVersion(left)?.patch ?? 0))[0];
    if (anchor) {
      const anchorTag = releaseTagName(config.release.tagPrefix, anchor);
      try {
        const existingAnchor = await client.getRef(`tags/${anchorTag}`);
        if (!existingAnchor) {
          await client.createRef(`tags/${anchorTag}`, mergeSha);
          progress = recordReleaseTransactionEvent(progress, { key: `tag:${anchorTag}`, kind: "anchor-tag-created", target: anchorTag, detail: "Independent release anchor tag created at the merged release commit." });
        } else if (existingAnchor.object.sha !== mergeSha) {
          throw new Error(`Release anchor tag ${anchorTag} already points to a different commit.`);
        } else {
          progress = recordReleaseTransactionEvent(progress, { key: `tag:${anchorTag}`, kind: "anchor-tag-detected", target: anchorTag, detail: "Independent release anchor tag already points to the merged release commit." });
        }
      } catch (error) {
        progress = recordReleaseTransactionEvent(progress, { key: `tag:${anchorTag}`, kind: "anchor-tag-created", target: anchorTag, status: "failed", detail: "Independent release anchor tag could not be created or did not point to the merged release commit." });
        try {
          await persistFinalTransactionState(client, executions, progress);
        } catch {
          log(`Could not persist the failed anchor-tag state for ${anchorTag}; inspect the release body and runner logs before retrying.`);
        }
        throw error;
      }
      await persistFinalTransactionState(client, executions, progress);
    }
  }

  if (!config.health.enabled) {
    progress = advanceReleaseTransaction(progress, "completed", {
      key: "transaction-completed",
      kind: "release-completed",
      target: version,
      detail: "Post-release verification is disabled; all configured transactional steps completed."
    });
    await persistFinalTransactionState(client, executions, progress);
    setOutput("transaction", JSON.stringify(progress));
  }

  // GITHUB_TOKEN-created releases do not recursively trigger a release event.
  // Verify the published release in this transaction as well, while retaining
  // the release event path for providers or manually published releases.
  if (config.health.enabled) {
    for (const execution of executions) {
      await runPostReleaseVerification(client, execution.release, config);
    }
  }

  setOutput("version", version);
  setOutput("release-url", JSON.stringify(executions.map((execution) => ({ tag: execution.tag, url: execution.release.html_url }))));
  log("Published all transactional release drafts.");
}

export async function run(): Promise<void> {
  const token = input("github-token") || process.env.GITHUB_TOKEN || "";
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required.");
  }
  const client = new GitHubClient(token, repository);
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const event = readEvent();
  const configPath = input("config") || ".semverge.yml";
  const pullRequestMergeSha = "pull_request" in event ? event.pull_request?.merge_commit_sha ?? undefined : undefined;
  const releaseTarget = "release" in event ? event.release?.target_commitish ?? undefined : undefined;
  const ref = pullRequestMergeSha || releaseTarget || process.env.GITHUB_SHA || ("after" in event ? event.after : undefined) || "HEAD";
  const config = withOverrides(await loadConfig(client, configPath, ref), {
    prerelease: input("prerelease"),
    artifactCommand: input("artifact-command")
  });
  const requestedChannel = input("release-channel");

  if (eventName === "release" && "release" in event && event.release && event.action === "published") {
    await runPostReleaseVerification(client, event.release, config);
    return;
  }
  if (eventName === "pull_request" && "pull_request" in event && event.pull_request && event.action === "closed" && event.pull_request.merged && isSemVergeReleasePullRequest(event.pull_request, config)) {
    await publishRelease(client, event.pull_request, config);
    return;
  }
  if (eventName === "schedule" || eventName === "workflow_dispatch") {
    if (requestedChannel) {
      const repositoryInfo = await client.repositoryInfo();
      const configuredRef = process.env.GITHUB_REF_NAME || process.env.GITHUB_REF || repositoryInfo.default_branch;
      const branch = configuredRef.replace(/^refs\/heads\//, "");
      const head = process.env.GITHUB_SHA?.trim();
      if (!head) {
        throw new Error("GITHUB_SHA is required for scheduled or manually dispatched channel preparation.");
      }
      await prepareRelease(client, head, config, branch, repositoryInfo.default_branch, requestedChannel);
    } else {
      await monitorReleases(client, config, input("monitor-tag"));
    }
    return;
  }
  if (eventName !== "push") {
    log(`Ignoring event ${eventName || "unknown"}; SemVerge runs on pushes, merged pull requests, and published releases.`);
    return;
  }
  const repositoryInfo = await client.repositoryInfo();
  const push = event as PushEvent;
  const expectedRef = `refs/heads/${repositoryInfo.default_branch}`;
  const channelRefs = Object.values(config.release.channels)
    .flatMap((policy) => policy.branch ? [`refs/heads/${policy.branch.replace(/^refs\/heads\//, "")}`] : []);
  const allowedRefs = new Set([expectedRef, ...channelRefs]);
  if (push.ref && !allowedRefs.has(push.ref)) {
    log(`Ignoring push to ${push.ref}; release preparation runs on ${expectedRef}.`);
    return;
  }
  if (push.after) {
    const mergedPullRequests = await client.commitPullRequests(push.after);
    if (mergedPullRequests.some((pullRequest) => pullRequest.merged_at && isSemVergeReleasePullRequest(pullRequest, config))) {
      log("Ignoring push for a merged SemVerge release PR; the closed-pull-request event owns publication.");
      return;
    }
  }
  const branch = (push.ref ?? process.env.GITHUB_REF_NAME ?? expectedRef.replace(/^refs\/heads\//, "")).replace(/^refs\/heads\//, "");
  await prepareRelease(client, push.after || process.env.GITHUB_SHA || "", config, branch, repositoryInfo.default_branch, requestedChannel);
}

if (process.env.NODE_ENV !== "test") {
  run().catch((error: unknown) => {
    process.stderr.write(`[semverge] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
