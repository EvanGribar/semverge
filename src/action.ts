import { appendFileSync, existsSync, readFileSync, statSync, readdirSync } from "node:fs";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, join, basename, sep } from "node:path";
import { parseChange } from "./changes.js";
import { parseConfig, withOverrides } from "./config.js";
import { readinessMarkdown } from "./readiness.js";
import { releaseTagName, GitHubClient, type GitHubCommitSummary, type GitHubPullRequest, type GitHubRelease } from "./github.js";
import { discoverPackages } from "./packages.js";
import { buildWorkspaceReleasePlan, type WorkspaceReleasePlan } from "./workspace-release.js";
import { evaluatePostReleaseVerification, postReleaseVerificationMarkdown, type PostReleaseVerificationObservation } from "./health.js";
import { compareVersions, parseVersion } from "./semver.js";
import type { SemVergeConfig } from "./types.js";

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
    tag_name: string;
    target_commitish?: string;
    published_at?: string | null;
    html_url?: string;
    assets?: Array<{ name: string }>;
  };
}

function input(name: string): string {
  return process.env[`INPUT_${name.toUpperCase().replace(/[\s-]+/g, "_")}`]?.trim() ?? "";
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

function commitChange(commit: GitHubCommitSummary) {
  return parseChange({
    title: commit.commit.message.split(/\r?\n/, 1)[0] ?? commit.commit.message,
    body: commit.commit.message,
    source: "commit",
    sha: commit.sha,
    url: commit.html_url,
    author: commit.commit.author?.name,
    mergedAt: commit.commit.author?.date
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
      changes.push(commitChange(commit));
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
  const content = await client.getFile(path, ref);
  return content ? parseConfig(content, path) : parseConfig("");
}

function releasePrBody(plan: WorkspaceReleasePlan, config: SemVergeConfig): string {
  const marker = JSON.stringify({ version: plan.version, manifest: config.outputs.manifest, mode: plan.mode });
  const packageLines = plan.packages.map(({ package: packageItem, plan: packagePlan }) => `- **${packageItem.name}**: ${packageItem.version} -> **${packagePlan.version}** (${packagePlan.bump})`);
  const notes = plan.packages.map(({ package: packageItem, plan: packagePlan }) => `### ${packageItem.name}\n\n${packagePlan.customerNotes.trim()}`).join("\n\n");
  const lines = [
    `<!-- semverge-release ${marker} -->`,
    `# SemVerge release ${plan.version}`,
    "",
    `This ${plan.mode} release prepares version changes and release communication for ${plan.packages.length} package(s).`,
    "",
    "## Package versions",
    "",
    ...packageLines,
    "",
    readinessMarkdown(plan.readiness).trim(),
    "",
    "## Customer-facing notes",
    "",
    notes || "No customer-facing changes were marked for this release.",
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

async function runPostReleaseVerification(client: GitHubClient, releaseEvent: NonNullable<ReleaseEvent["release"]>, config: SemVergeConfig): Promise<void> {
  if (!config.health.enabled) {
    log("Post-release verification is disabled.");
    return;
  }
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
  if (report.status === "failed") {
    throw new Error(`Post-release verification failed for ${releaseEvent.tag_name}.`);
  }
}

async function prepareRelease(client: GitHubClient, head: string, config: SemVergeConfig): Promise<void> {
  const baseCommit = await client.getCommit(head);
  const repositoryTree = await client.getTree(baseCommit.tree.sha);
  const allPaths = repositoryTree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const manifestPaths = allPaths.filter((path) => path === "package.json" || path.endsWith("/package.json") || path === "pyproject.toml" || path.endsWith("/pyproject.toml") || path === "Cargo.toml" || path.endsWith("/Cargo.toml") || path === "pnpm-workspace.yaml");
  const manifestEntries = await Promise.all(manifestPaths.map(async (path) => [path, await client.getFile(path, head)] as const));
  const manifestFiles = Object.fromEntries(manifestEntries.flatMap(([path, content]) => content === null ? [] : [[path, content]]));
  const discovered = discoverPackages(manifestFiles, allPaths, config);
  const changes = await changesSinceTag(client, head, await latestReleaseTag(client, config));
  const betaLabelPresent = changes.some((change) => change.labels.includes("ship:beta"));
  const effectiveConfig = betaLabelPresent && !config.release.prerelease ? withOverrides(config, { prerelease: "beta" }) : config;
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
  const fileEntries = await Promise.all(neededPaths.map(async (path) => [path, await client.getFile(path, head)] as const));
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
  const plan = buildWorkspaceReleasePlan({
    packages: discovered.packages,
    mode: discovered.mode,
    files,
    config: effectiveConfig,
    changes,
    readinessContext: { availableLabels, availableFiles, commandResults: await runReadinessCommands(effectiveConfig) }
  });
  setOutput("version", plan.version);
  if (!plan.hasRelease) {
    log("No release-worthy changes were found.");
    return;
  }
  log(`Planned ${plan.version} (${plan.mode}) from ${plan.releaseChanges.length} change(s).`);
  if (isDryRun()) {
    log(JSON.stringify(plan, null, 2));
    return;
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
  const body = releasePrBody(plan, effectiveConfig);
  const existing = (await client.listPullRequests({ state: "open", head: `${repository.owner.login}:${effectiveConfig.release.branch}`, base: repository.default_branch }))[0];
  const releasePr = existing ? await client.updatePullRequest(existing.number, { title, body }) : await client.createPullRequest({ title, body, head: effectiveConfig.release.branch, base: repository.default_branch });
  setOutput("release-pr", releasePr.html_url);
  log(`${existing ? "Updated" : "Created"} release PR: ${releasePr.html_url}`);
}

function isSemVergeReleasePullRequest(pr: GitHubPullRequest, config: SemVergeConfig): boolean {
  return (pr.head.ref === config.release.branch || pr.head.ref.startsWith("semverge/")) && /release/i.test(pr.title);
}

interface PublishedPackage {
  id: string;
  name: string;
  directory: string;
  version: string;
  customerNotes?: string;
  private?: boolean;
  releaseable?: boolean;
}

interface SemVergeManifest {
  schemaVersion?: number;
  mode?: "single" | "fixed" | "independent";
  version?: string;
  readiness?: { passed?: boolean };
  packages?: PublishedPackage[];
}

interface ReleaseProgress {
  schemaVersion: 1;
  version: string;
  packageIds: string[];
  tagNames: string[];
  npmEnabled: boolean;
  publishedPackages: string[];
  uploadedAssets: Record<string, string[]>;
  ready: boolean;
  published: boolean;
}

interface ReleaseExecution {
  packageItem: PublishedPackage;
  tag: string;
  customerNotes: string;
  release: GitHubRelease;
}

const RELEASE_PROGRESS_MARKER = "<!-- semverge-progress ";

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

function initialReleaseProgress(version: string, publishablePackages: PublishedPackage[], releaseTags: string[], config: SemVergeConfig): ReleaseProgress {
  const packageIds = publishablePackages.map(packageKey);
  return {
    schemaVersion: 1,
    version,
    packageIds,
    tagNames: releaseTags,
    npmEnabled: config.publishing.npm.enabled,
    publishedPackages: config.publishing.npm.enabled ? [] : [...packageIds],
    uploadedAssets: Object.fromEntries(releaseTags.map((tag) => [tag, []])),
    ready: false,
    published: false
  };
}

function parseReleaseProgress(body: string | null | undefined): ReleaseProgress | null {
  const match = body?.match(/<!-- semverge-progress ([\s\S]*?) -->/);
  if (!match) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(match[1] ?? "");
  } catch (error) {
    throw new Error(`SemVerge found an invalid release progress marker: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SemVerge found an invalid release progress marker.");
  }
  const record = value as Record<string, unknown>;
  const uploadedAssets = record.uploadedAssets;
  if (record.schemaVersion !== 1 || typeof record.version !== "string" || !Array.isArray(record.packageIds) || !record.packageIds.every((item) => typeof item === "string") || !Array.isArray(record.tagNames) || !record.tagNames.every((item) => typeof item === "string") || typeof record.npmEnabled !== "boolean" || !Array.isArray(record.publishedPackages) || !record.publishedPackages.every((item) => typeof item === "string") || !uploadedAssets || typeof uploadedAssets !== "object" || Array.isArray(uploadedAssets) || typeof record.ready !== "boolean" || typeof record.published !== "boolean") {
    throw new Error("SemVerge found an invalid release progress marker.");
  }
  const normalizedAssets: Record<string, string[]> = {};
  for (const [tag, assets] of Object.entries(uploadedAssets as Record<string, unknown>)) {
    if (!Array.isArray(assets) || !assets.every((asset) => typeof asset === "string")) {
      throw new Error(`SemVerge found invalid uploaded asset state for ${tag}.`);
    }
    normalizedAssets[tag] = [...new Set(assets)];
  }
  return {
    schemaVersion: 1,
    version: record.version,
    packageIds: [...new Set(record.packageIds as string[])],
    tagNames: [...new Set(record.tagNames as string[])],
    npmEnabled: record.npmEnabled,
    publishedPackages: [...new Set(record.publishedPackages as string[])],
    uploadedAssets: normalizedAssets,
    ready: record.ready,
    published: record.published
  };
}

function releaseBody(customerNotes: string, progress: ReleaseProgress): string {
  return `${RELEASE_PROGRESS_MARKER}${JSON.stringify(progress)} -->\n\n${customerNotes.trim()}\n`;
}

function sameValues(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validateReleaseProgress(progress: ReleaseProgress, expected: ReleaseProgress): void {
  if (progress.version !== expected.version || progress.npmEnabled !== expected.npmEnabled || !sameValues(progress.packageIds, expected.packageIds) || !sameValues(progress.tagNames, expected.tagNames)) {
    throw new Error("SemVerge found release progress for a different release or publishing configuration; verify the draft releases before retrying.");
  }
}

function mergeReleaseProgress(states: Array<ReleaseProgress | null>, expected: ReleaseProgress): ReleaseProgress {
  const present = states.filter((state): state is ReleaseProgress => state !== null);
  const merged: ReleaseProgress = {
    ...expected,
    publishedPackages: [...expected.publishedPackages],
    uploadedAssets: Object.fromEntries(expected.tagNames.map((tag) => [tag, [...(expected.uploadedAssets[tag] ?? [])]])),
    ready: false,
    published: false
  };
  for (const state of present) {
    validateReleaseProgress(state, expected);
    merged.publishedPackages = [...new Set([...merged.publishedPackages, ...state.publishedPackages])];
    merged.ready ||= state.ready;
    merged.published ||= state.published;
    for (const tag of expected.tagNames) {
      merged.uploadedAssets[tag] = [...new Set([...(merged.uploadedAssets[tag] ?? []), ...(state.uploadedAssets[tag] ?? [])])];
    }
  }
  if (present.length === 0) {
    return expected;
  }
  return merged;
}

async function persistReleaseProgress(client: GitHubClient, executions: ReleaseExecution[], progress: ReleaseProgress, finalize = false): Promise<void> {
  for (const execution of executions) {
    if (execution.release.draft !== true) {
      continue;
    }
    const updated = await client.updateRelease(execution.release.id, {
      body: releaseBody(execution.customerNotes, progress),
      ...(finalize ? { draft: false } : {})
    });
    execution.release = { ...execution.release, ...updated, draft: finalize ? false : (updated.draft ?? execution.release.draft ?? true) };
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

async function publishRelease(client: GitHubClient, pr: GitHubPullRequest, config: SemVergeConfig): Promise<void> {
  const mergeSha = pr.merge_commit_sha;
  if (!mergeSha) {
    throw new Error("The SemVerge release PR does not have a merge commit SHA.");
  }
  const manifestContent = await client.getFile(config.outputs.manifest, mergeSha);
  const manifest: SemVergeManifest = manifestContent ? JSON.parse(manifestContent) as SemVergeManifest : {};
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

  // Build and validate every artifact before creating a tag or draft release. A failed
  // build must not leave any release-side state behind for the next retry.
  const artifactCommand = input("artifact-command") || config.artifacts.command;
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  if (artifactCommand) {
    log(`Running artifact command: ${artifactCommand}`);
    await exec(artifactCommand, { cwd: workspace, shell: process.env.ComSpec ?? "/bin/sh", maxBuffer: 1024 * 1024 * 20 });
  }
  const artifactFiles = config.artifacts.paths.flatMap((path) => collectFiles(path, workspace));

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

  const version = manifest.version ?? packages.map((packageItem) => `${packageItem.name}@${packageItem.version}`).join(", ");
  const expectedProgress = initialReleaseProgress(version, publishablePackages, releaseInputs.map((item) => item.tag), config);
  const progress = mergeReleaseProgress(releaseInputs.map((item) => item.existingProgress), expectedProgress);
  const executions: ReleaseExecution[] = [];

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
    log(`${item.existingRelease ? "Resuming" : "Prepared draft"} GitHub release for ${item.packageItem.name}: ${release.html_url}`);
  }

  // The release body is the durable transaction record. Updating it after every
  // successful side effect lets a later run resume only the unfinished steps.
  await persistReleaseProgress(client, executions, progress);

  const packageIds = new Map(publishablePackages.map((packageItem, index) => [packageKey(packageItem, index), packageItem]));
  for (const [id, packageItem] of packageIds) {
    if (progress.publishedPackages.includes(id)) {
      continue;
    }
    const packageWorkspace = packageItem.directory ? resolve(workspace, packageItem.directory) : workspace;
    log(`Publishing ${packageItem.name} with npm command.`);
    await exec(config.publishing.npm.command, { cwd: packageWorkspace, shell: process.env.ComSpec ?? "/bin/sh", maxBuffer: 1024 * 1024 * 20 });
    progress.publishedPackages = [...new Set([...progress.publishedPackages, id])];
    await persistReleaseProgress(client, executions, progress);
  }

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
        log(`Release artifact already attached for ${execution.tag}: ${assetName}`);
        continue;
      }
      await client.uploadReleaseAsset(execution.release, file);
      uploaded.add(assetName);
      log(`Uploaded release artifact for ${execution.tag}: ${assetName}`);
      progress.uploadedAssets[execution.tag] = [...uploaded];
      await persistReleaseProgress(client, executions, progress);
    }
    progress.uploadedAssets[execution.tag] = [...uploaded];
  }

  progress.ready = true;
  await persistReleaseProgress(client, executions, progress);
  progress.published = true;
  await persistReleaseProgress(client, executions, progress, true);

  if (mode === "independent") {
    const versions = publishablePackages.map((packageItem) => packageItem.version).filter((value) => parseVersion(value));
    const anchor = versions.sort((left, right) => (parseVersion(right)?.major ?? 0) - (parseVersion(left)?.major ?? 0) || (parseVersion(right)?.minor ?? 0) - (parseVersion(left)?.minor ?? 0) || (parseVersion(right)?.patch ?? 0) - (parseVersion(left)?.patch ?? 0))[0];
    if (anchor) {
      const anchorTag = releaseTagName(config.release.tagPrefix, anchor);
      const existingAnchor = await client.getRef(`tags/${anchorTag}`);
      if (!existingAnchor) {
        await client.createRef(`tags/${anchorTag}`, mergeSha);
      } else if (existingAnchor.object.sha !== mergeSha) {
        throw new Error(`Release anchor tag ${anchorTag} already points to a different commit.`);
      }
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

  if (eventName === "release" && "release" in event && event.release && event.action === "published") {
    await runPostReleaseVerification(client, event.release, config);
    return;
  }
  if (eventName === "pull_request" && "pull_request" in event && event.pull_request && event.action === "closed" && event.pull_request.merged && isSemVergeReleasePullRequest(event.pull_request, config)) {
    await publishRelease(client, event.pull_request, config);
    return;
  }
  if (eventName !== "push") {
    log(`Ignoring event ${eventName || "unknown"}; SemVerge runs on pushes, merged pull requests, and published releases.`);
    return;
  }
  const repositoryInfo = await client.repositoryInfo();
  const push = event as PushEvent;
  const expectedRef = `refs/heads/${repositoryInfo.default_branch}`;
  if (push.ref && push.ref !== expectedRef) {
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
  await prepareRelease(client, push.after || process.env.GITHUB_SHA || "", config);
}

if (process.env.NODE_ENV !== "test") {
  run().catch((error: unknown) => {
    process.stderr.write(`[semverge] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
