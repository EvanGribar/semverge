import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { npmProvenanceCheck, npmVersionExists, type NpmProvenanceCheck, type NpmViewRunner } from "./npm.js";
import { ociImageVersionDigest, ociImageVersionExists, registryVersionExists, type RegistryVersionFetcher } from "./registries.js";
import { parseVersion } from "./semver.js";
import { parseReleaseTransactionBody, type ReleaseTransaction } from "./transaction.js";
import type { Ecosystem, SemVergeConfig } from "./types.js";
import { GitHubClient, type GitHubRelease, type GitHubReleaseAsset } from "./github.js";

const execFile = promisify(execFileCallback);

export type VerificationEvidenceStatus = "verified" | "mismatch" | "unavailable" | "not-applicable";
export type ReleaseVerificationStatus = "verified" | "mismatch" | "unavailable";

export interface VerificationEvidence {
  name: string;
  status: VerificationEvidenceStatus;
  detail: string;
  expected?: string;
  observed?: string;
}

export interface ReleaseVerificationReport {
  schemaVersion: 1;
  input: string;
  tag?: string;
  version?: string;
  transactionId?: string;
  status: ReleaseVerificationStatus;
  evidence: VerificationEvidence[];
}

export interface VerificationManifestPackage {
  id?: string;
  name?: string;
  directory?: string;
  ecosystem?: Ecosystem;
  version?: string;
  private?: boolean;
  releaseable?: boolean;
}

export interface VerificationManifest {
  schemaVersion?: number;
  mode?: "single" | "fixed" | "independent";
  version?: string;
  packages?: VerificationManifestPackage[];
}

export interface ReleaseVerificationTarget {
  input: string;
  tag?: string;
  version?: string;
  transactionId?: string;
  releaseId?: string;
}

export interface VerifyReleaseInput {
  target: string;
  cwd: string;
  config: SemVergeConfig;
  client?: GitHubClient;
  release?: GitHubRelease | null;
  transaction?: ReleaseTransaction | null;
  manifest?: VerificationManifest | null;
  localOnly?: boolean;
  registryFetcher?: RegistryVersionFetcher;
  npmRunner?: NpmViewRunner;
}

interface LocalTagResult {
  available: boolean;
  commit: string | null;
}

interface ManifestResult {
  manifest: VerificationManifest | null;
}

function evidence(name: string, status: VerificationEvidenceStatus, detail: string, expected?: string, observed?: string): VerificationEvidence {
  return {
    name,
    status,
    detail,
    ...(expected === undefined ? {} : { expected }),
    ...(observed === undefined ? {} : { observed })
  };
}

function valueRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function tagPrefixes(config: SemVergeConfig): string[] {
  return [
    config.release.tagPrefix,
    ...Object.values(config.release.channels).map((channel) => channel.tagPrefix ?? "")
  ].filter((prefix, index, values) => prefix.length > 0 && values.indexOf(prefix) === index).sort((left, right) => right.length - left.length);
}

function normalizedVersion(value: string): string | undefined {
  if (!parseVersion(value)) {
    return undefined;
  }
  return value.replace(/^v(?=\d)/i, "");
}

function configuredTagVersion(tag: string, config: SemVergeConfig): string | undefined {
  for (const prefix of tagPrefixes(config)) {
    if (tag.startsWith(prefix)) {
      const candidate = normalizedVersion(tag.slice(prefix.length));
      if (candidate) {
        return candidate;
      }
    }
  }
  return undefined;
}

function versionFromTag(tag: string, config: SemVergeConfig): string | undefined {
  const configured = configuredTagVersion(tag, config);
  if (configured) {
    return configured;
  }
  const candidate = tag.slice(Math.max(0, tag.lastIndexOf("@") + 1));
  return normalizedVersion(candidate);
}

export function parseReleaseVerificationTarget(input: string, config: SemVergeConfig): ReleaseVerificationTarget {
  const raw = input.trim();
  if (!raw) {
    return { input: raw };
  }
  if (/^release_[A-Za-z0-9-]+$/i.test(raw)) {
    return { input: raw, transactionId: raw };
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const parts = url.pathname.split("/").filter(Boolean).map(decodePathPart);
      const releaseIndex = parts.lastIndexOf("releases");
      if (releaseIndex >= 0) {
        const kind = parts[releaseIndex + 1];
        const tag = parts[releaseIndex + 2];
        if (kind === "tag" && tag) {
          return { input: raw, tag, version: versionFromTag(tag, config) };
        }
        if (kind && /^\d+$/.test(kind)) {
          return { input: raw, releaseId: kind };
        }
      }
    } catch {
      // The regular tag parser below produces a useful unavailable report for malformed URLs.
    }
  }
  const prefixedVersion = configuredTagVersion(raw, config);
  if (prefixedVersion) {
    return { input: raw, tag: raw, version: prefixedVersion };
  }
  const directVersion = normalizedVersion(raw);
  if (directVersion) {
    return { input: raw, tag: `${config.release.tagPrefix}${directVersion}`, version: directVersion };
  }
  return { input: raw, tag: raw, version: versionFromTag(raw, config) };
}

export function parseVerificationManifest(content: string): VerificationManifest | null {
  try {
    const value = JSON.parse(content) as unknown;
    const record = valueRecord(value);
    if (!record || (record.packages !== undefined && (!Array.isArray(record.packages) || record.packages.some((item) => !valueRecord(item))))) {
      return null;
    }
    const packages = Array.isArray(record.packages)
      ? record.packages.map((item) => {
        const packageRecord = valueRecord(item) ?? {};
        return {
          ...(typeof packageRecord.id === "string" ? { id: packageRecord.id } : {}),
          ...(typeof packageRecord.name === "string" ? { name: packageRecord.name } : {}),
          ...(typeof packageRecord.directory === "string" ? { directory: packageRecord.directory } : {}),
          ...(packageRecord.ecosystem === "node" || packageRecord.ecosystem === "python" || packageRecord.ecosystem === "rust" ? { ecosystem: packageRecord.ecosystem } : {}),
          ...(typeof packageRecord.version === "string" ? { version: packageRecord.version } : {}),
          ...(typeof packageRecord.private === "boolean" ? { private: packageRecord.private } : {}),
          ...(typeof packageRecord.releaseable === "boolean" ? { releaseable: packageRecord.releaseable } : {})
        } satisfies VerificationManifestPackage;
      })
      : undefined;
    return {
      ...(typeof record.schemaVersion === "number" ? { schemaVersion: record.schemaVersion } : {}),
      ...(record.mode === "single" || record.mode === "fixed" || record.mode === "independent" ? { mode: record.mode } : {}),
      ...(typeof record.version === "string" ? { version: record.version } : {}),
      ...(packages === undefined ? {} : { packages })
    };
  } catch {
    return null;
  }
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function localPath(cwd: string, path: string): string | null {
  const root = resolve(cwd);
  const absolute = resolve(root, path);
  const relative = absolute.slice(root.length);
  if (relative && relative !== sep && !relative.startsWith(sep)) {
    return null;
  }
  return absolute;
}

async function localFileBytes(cwd: string, path: string): Promise<{ status: "found" | "missing" | "unavailable"; bytes?: Uint8Array }> {
  const absolute = localPath(cwd, path);
  if (!absolute) {
    return { status: "unavailable" };
  }
  try {
    return { status: "found", bytes: await readFile(absolute) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    return code === "ENOENT" ? { status: "missing" } : { status: "unavailable" };
  }
}

async function localTagCommit(cwd: string, tag: string): Promise<LocalTagResult> {
  try {
    await execFile("git", ["rev-parse", "--git-dir"], { cwd, encoding: "utf8" });
  } catch {
    return { available: false, commit: null };
  }
  try {
    const result = await execFile("git", ["rev-parse", "--verify", `${tag}^{commit}`], { cwd, encoding: "utf8" });
    const commit = String(result.stdout).trim();
    return { available: true, commit: commit || null };
  } catch {
    return { available: true, commit: null };
  }
}

function packageKey(packageItem: VerificationManifestPackage, index: number): string {
  return packageItem.id || packageItem.name || packageItem.directory || `package-${index + 1}`;
}

function packageMatchesTransaction(packageItem: VerificationManifestPackage, index: number, transaction: ReleaseTransaction): boolean {
  if (transaction.packageIds.length === 0) {
    return true;
  }
  const key = packageKey(packageItem, index);
  return transaction.packageIds.includes(key) || (packageItem.name ? transaction.packageIds.includes(packageItem.name) : false);
}

function packagePublicationWasSkipped(packageItem: VerificationManifestPackage, index: number, transaction: ReleaseTransaction): boolean {
  const key = packageKey(packageItem, index);
  return transaction.events.some((event) => event.key === `package:${key}` && event.kind === "package-publication-skipped" && event.status === "completed");
}

function releaseAsset(release: GitHubRelease, path: string): GitHubReleaseAsset | undefined {
  const name = basename(path);
  return (release.assets ?? []).find((asset) => asset.name === name);
}

function transactionIdInRelease(release: GitHubRelease): string | undefined {
  try {
    return parseReleaseTransactionBody(release.body)?.id;
  } catch {
    return undefined;
  }
}

async function loadManifest(input: VerifyReleaseInput, transaction: ReleaseTransaction): Promise<ManifestResult> {
  if (input.manifest !== undefined) {
    return { manifest: input.manifest };
  }
  if (input.client && transaction.sourceCommit !== "unknown") {
    try {
      const content = await input.client.getFile(input.config.outputs.manifest, transaction.sourceCommit);
      if (content === null) {
        return { manifest: null };
      }
      const manifest = parseVerificationManifest(content);
      return { manifest };
    } catch {
      return { manifest: null };
    }
  }
  const local = await localFileBytes(input.cwd, input.config.outputs.manifest);
  if (local.status === "found" && local.bytes) {
    const content = Buffer.from(local.bytes).toString("utf8");
    const manifest = parseVerificationManifest(content);
    return { manifest };
  }
  if (local.status === "unavailable") {
    return { manifest: null };
  }
  return { manifest: null };
}

function providerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function verificationStatus(evidenceItems: VerificationEvidence[]): ReleaseVerificationStatus {
  if (evidenceItems.some((item) => item.status === "mismatch")) {
    return "mismatch";
  }
  if (evidenceItems.some((item) => item.status === "unavailable")) {
    return "unavailable";
  }
  if (evidenceItems.length === 0 || evidenceItems.every((item) => item.status === "not-applicable")) {
    return "unavailable";
  }
  return "verified";
}

function releaseSubject(report: ReleaseVerificationReport): string {
  return report.tag ?? (report.version ? `${report.version}` : report.input || "release");
}

export function verificationReportJson(report: ReleaseVerificationReport): string {
  return JSON.stringify(report, null, 2);
}

function statusIcon(status: VerificationEvidenceStatus): string {
  if (status === "verified") return "✓";
  if (status === "mismatch") return "✗";
  if (status === "unavailable") return "!";
  return "-";
}

export function verificationReportMarkdown(report: ReleaseVerificationReport): string {
  const subject = releaseSubject(report);
  const lines = [
    `Release verification: ${subject}`,
    "",
    ...report.evidence.map((item) => `${statusIcon(item.status)} ${item.name}: ${item.detail}`),
    ""
  ];
  if (report.status === "verified") {
    lines.push(`Release ${subject} is verified.`);
  } else if (report.status === "mismatch") {
    lines.push(`Release ${subject} failed verification.`);
  } else {
    lines.push(`Release ${subject} could not be fully verified because evidence is unavailable.`);
  }
  return lines.join("\n");
}

async function checkArtifacts(
  input: VerifyReleaseInput,
  transaction: ReleaseTransaction,
  release: GitHubRelease | null | undefined,
  items: VerificationEvidence[]
): Promise<void> {
  const artifactEntries = Object.entries(transaction.artifactDigests).sort(([left], [right]) => left.localeCompare(right));
  if (artifactEntries.length === 0) {
    items.push(evidence("Release artifacts", "not-applicable", "No artifact SHA-256 digests were recorded in the transaction."));
    return;
  }
  const assetNameCounts = new Map<string, number>();
  for (const [path] of artifactEntries) {
    const name = basename(path);
    assetNameCounts.set(name, (assetNameCounts.get(name) ?? 0) + 1);
  }
  const artifactEvidenceStart = items.length;
  for (const [path, expectedDigest] of artifactEntries) {
    const asset = release ? releaseAsset(release, path) : undefined;
    if (release) {
      if ((assetNameCounts.get(basename(path)) ?? 0) > 1) {
        items.push(evidence(`Artifact ${path}`, "unavailable", `The GitHub release asset name ${basename(path)} is ambiguous for multiple recorded artifact paths.`));
        continue;
      }
      if (!asset) {
        items.push(evidence(`Artifact ${path}`, "mismatch", `The GitHub release does not contain the recorded artifact ${basename(path)}.`, basename(path)));
        continue;
      }
      if (!input.client) {
        items.push(evidence(`Artifact ${path}`, "unavailable", `The release asset exists, but no GitHub client is available to download it.`, expectedDigest, asset.name));
        continue;
      }
      try {
        const bytes = await input.client.downloadReleaseAsset(asset);
        if (!bytes) {
          items.push(evidence(`Artifact ${path}`, "mismatch", `The GitHub release asset ${asset.name} could not be downloaded.`, expectedDigest));
          continue;
        }
        const observedDigest = hashBytes(bytes);
        items.push(observedDigest === expectedDigest
          ? evidence(`Artifact ${path}`, "verified", `GitHub release asset ${asset.name} matches the recorded SHA-256 digest.`, expectedDigest, observedDigest)
          : evidence(`Artifact ${path}`, "mismatch", `GitHub release asset ${asset.name} does not match the recorded SHA-256 digest.`, expectedDigest, observedDigest));
      } catch (error) {
        items.push(evidence(`Artifact ${path}`, "unavailable", `GitHub release asset ${asset.name} could not be verified: ${providerError(error)}`, expectedDigest));
      }
      continue;
    }
    const local = await localFileBytes(input.cwd, path);
    if (local.status === "missing") {
      items.push(evidence(`Artifact ${path}`, "unavailable", `The local artifact ${path} is not present; verify it from the published release assets.`, expectedDigest));
    } else if (local.status === "unavailable" || !local.bytes) {
      items.push(evidence(`Artifact ${path}`, "unavailable", `The local artifact ${path} could not be read.`, expectedDigest));
    } else {
      const observedDigest = hashBytes(local.bytes);
      items.push(observedDigest === expectedDigest
        ? evidence(`Artifact ${path}`, "verified", "The local artifact matches the recorded SHA-256 digest.", expectedDigest, observedDigest)
        : evidence(`Artifact ${path}`, "mismatch", "The local artifact does not match the recorded SHA-256 digest.", expectedDigest, observedDigest));
    }
  }
  const artifactEvidence = items.slice(artifactEvidenceStart);
  const verified = artifactEvidence.filter((item) => item.status === "verified").length;
  const mismatched = artifactEvidence.filter((item) => item.status === "mismatch").length;
  const unavailable = artifactEvidence.filter((item) => item.status === "unavailable").length;
  const aggregateStatus: VerificationEvidenceStatus = mismatched > 0 ? "mismatch" : unavailable > 0 ? "unavailable" : "verified";
  const aggregateDetail = aggregateStatus === "verified"
    ? `${verified}/${artifactEntries.length} release artifacts match recorded SHA-256 digests.`
    : `${verified}/${artifactEntries.length} release artifacts match recorded SHA-256 digests; ${mismatched} mismatch(es), ${unavailable} unavailable.`;
  items.push(evidence("Release artifact digests", aggregateStatus, aggregateDetail));
}

async function fallbackManifest(input: VerifyReleaseInput, transaction: ReleaseTransaction): Promise<VerificationManifest | null> {
  const manifestResult = await loadManifest(input, transaction);
  if (manifestResult.manifest) {
    return manifestResult.manifest;
  }
  if (input.manifest !== undefined) {
    return null;
  }
  if (input.client && transaction.sourceCommit !== "unknown") {
    return null;
  }
  const packageJson = await localFileBytes(input.cwd, "package.json");
  if (packageJson.status !== "found" || !packageJson.bytes) {
    return null;
  }
  try {
    const value = valueRecord(JSON.parse(Buffer.from(packageJson.bytes).toString("utf8")) as unknown);
    if (!value || typeof value.name !== "string") {
      return null;
    }
    return { mode: "single", version: transaction.version, packages: [{ id: "root", name: value.name, directory: "", ecosystem: "node", version: transaction.version }] };
  } catch {
    return null;
  }
}

function selectedPackages(manifest: VerificationManifest, transaction: ReleaseTransaction): VerificationManifestPackage[] {
  return (manifest.packages ?? []).filter((packageItem, index) => !packageItem.private && packageItem.releaseable !== false && packageMatchesTransaction(packageItem, index, transaction) && !packagePublicationWasSkipped(packageItem, index, transaction)).sort((left, right) => packageKey(left, 0).localeCompare(packageKey(right, 0)));
}

async function checkPackageTarget(
  input: VerifyReleaseInput,
  transaction: ReleaseTransaction,
  manifest: VerificationManifest | null,
  target: "npm" | "python" | "rust",
  items: VerificationEvidence[]
): Promise<void> {
  if (!manifest) {
    items.push(evidence(`${target} publication`, "unavailable", `The release manifest is unavailable, so recorded ${target} package targets cannot be checked.`));
    return;
  }
  const packages = selectedPackages(manifest, transaction).filter((packageItem) => (packageItem.ecosystem ?? "node") === (target === "npm" ? "node" : target));
  if (packages.length === 0) {
    items.push(evidence(`${target} publication`, "unavailable", `The release manifest contains no releaseable package for the recorded ${target} target.`));
    return;
  }
  for (const [index, packageItem] of packages.entries()) {
    const name = packageItem.name;
    const version = packageItem.version ?? transaction.version;
    const label = `${name ?? packageKey(packageItem, index)}@${version}`;
    if (!name || !version) {
      items.push(evidence(`${target} ${label}`, "unavailable", "The release manifest does not contain a package name and version."));
      continue;
    }
    const packageWorkspace = localPath(input.cwd, packageItem.directory ?? "");
    if (!packageWorkspace) {
      items.push(evidence(`${target} ${label}`, "unavailable", "The release manifest points outside the verification workspace."));
      continue;
    }
    try {
      const exists = target === "npm"
        ? await npmVersionExists(name, version, packageWorkspace, input.npmRunner)
        : await registryVersionExists(target, name, version, input.registryFetcher);
      items.push(exists
        ? evidence(`${target} ${label}`, "verified", `The ${target} registry contains the recorded package version.`)
        : evidence(`${target} ${label}`, "mismatch", `The ${target} registry does not contain the recorded package version.`));
    } catch (error) {
      items.push(evidence(`${target} ${label}`, "unavailable", `The ${target} registry could not be checked: ${providerError(error)}`));
    }
  }
}

async function checkNpmProvenance(
  input: VerifyReleaseInput,
  transaction: ReleaseTransaction,
  manifest: VerificationManifest | null,
  items: VerificationEvidence[]
): Promise<void> {
  if (!transaction.npmProvenance) {
    items.push(evidence("npm provenance", "not-applicable", "npm provenance was not requested for this transaction."));
    return;
  }
  if (!manifest) {
    items.push(evidence("npm provenance", "unavailable", "The release manifest is unavailable, so npm provenance claims cannot be checked."));
    return;
  }
  const packages = selectedPackages(manifest, transaction).filter((packageItem) => (packageItem.ecosystem ?? "node") === "node");
  if (packages.length === 0) {
    items.push(evidence("npm provenance", "unavailable", "The release manifest contains no releaseable Node package for the recorded provenance claim."));
    return;
  }
  for (const [index, packageItem] of packages.entries()) {
    const name = packageItem.name;
    const version = packageItem.version ?? transaction.version;
    const label = `${name ?? packageKey(packageItem, index)}@${version}`;
    if (!name || !version) {
      items.push(evidence(`npm provenance ${label}`, "unavailable", "The release manifest does not contain a package name and version."));
      continue;
    }
    const packageWorkspace = localPath(input.cwd, packageItem.directory ?? "");
    if (!packageWorkspace) {
      items.push(evidence(`npm provenance ${label}`, "unavailable", "The release manifest points outside the verification workspace."));
      continue;
    }
    let result: NpmProvenanceCheck;
    try {
      result = await npmProvenanceCheck(name, version, packageWorkspace, input.npmRunner);
    } catch (error) {
      result = { status: "unavailable", detail: providerError(error) };
    }
    items.push(evidence(`npm provenance ${label}`, result.status, result.detail));
  }
}

async function checkOciTarget(
  input: VerifyReleaseInput,
  transaction: ReleaseTransaction,
  target: string,
  items: VerificationEvidence[]
): Promise<void> {
  const image = target.slice("oci:".length);
  if (!image) {
    items.push(evidence("OCI publication", "unavailable", "The transaction recorded an empty OCI image target."));
    return;
  }
  if (!transaction.publishedOciImages.includes(image)) {
    items.push(evidence(`OCI ${image}`, "mismatch", `The transaction did not record ${image} as published.`));
    return;
  }
  const expectedDigest = transaction.ociDigests?.[image];
  if (!expectedDigest) {
    items.push(evidence(`OCI ${image}`, "unavailable", "The transaction does not contain a recorded OCI content digest, so the published image cannot be fully verified."));
    return;
  }
  const version = transaction.version;
  try {
    const exists = await ociImageVersionExists(image, version, input.registryFetcher);
    if (!exists) {
      items.push(evidence(`OCI ${image}:${version}`, "mismatch", "The OCI registry does not contain the recorded image tag.", expectedDigest));
      return;
    }
    const observedDigest = await ociImageVersionDigest(image, version, input.registryFetcher);
    if (!observedDigest) {
      items.push(evidence(`OCI ${image}:${version}`, "unavailable", "The OCI registry confirmed the image tag but did not return a content digest.", expectedDigest));
      return;
    }
    items.push(observedDigest.toLowerCase() === expectedDigest.toLowerCase()
      ? evidence(`OCI ${image}:${version}`, "verified", "The OCI manifest digest matches the recorded publication target.", expectedDigest, observedDigest)
      : evidence(`OCI ${image}:${version}`, "mismatch", "The OCI manifest digest does not match the recorded publication target.", expectedDigest, observedDigest));
  } catch (error) {
    items.push(evidence(`OCI ${image}:${version}`, "unavailable", `The OCI registry could not be checked: ${providerError(error)}`, expectedDigest));
  }
}

export async function verifyRelease(input: VerifyReleaseInput): Promise<ReleaseVerificationReport> {
  let target = parseReleaseVerificationTarget(input.target, input.config);
  let release = input.release;
  let releaseLookupAttempted = input.release !== undefined;
  let releaseLookupError: string | undefined;

  if (release === undefined && input.client) {
    releaseLookupAttempted = true;
    try {
      if (target.releaseId) {
        release = await input.client.getRelease(target.releaseId);
      } else if (target.transactionId) {
        const releases = await input.client.listReleases();
        release = releases.find((candidate) => transactionIdInRelease(candidate) === target.transactionId) ?? null;
      } else if (target.tag) {
        release = await input.client.getReleaseByTag(target.tag);
      } else {
        release = null;
      }
    } catch (error) {
      release = null;
      releaseLookupError = providerError(error);
    }
  }

  if (release) {
    target = {
      ...target,
      tag: target.tag ?? release.tag_name,
      version: target.version ?? versionFromTag(release.tag_name, input.config)
    };
  }

  let transaction = input.transaction;
  let transactionParseError: string | undefined;
  if (transaction === undefined && release) {
    try {
      transaction = parseReleaseTransactionBody(release.body);
    } catch (error) {
      transaction = null;
      transactionParseError = providerError(error);
    }
  }

  const items: VerificationEvidence[] = [];
  if (releaseLookupError) {
    items.push(evidence("GitHub release", "unavailable", `The GitHub release could not be loaded: ${releaseLookupError}`));
  } else if (releaseLookupAttempted) {
    if (!release) {
      items.push(evidence("GitHub release", "mismatch", "The requested GitHub release was not found."));
    } else {
      const expectedTag = target.tag ?? transaction?.tagNames[0];
      const recordedTags = transaction?.tagNames ?? [];
      if (recordedTags.length > 0 && !recordedTags.includes(release.tag_name)) {
        items.push(evidence("GitHub release", "mismatch", "The GitHub release tag is not recorded by the transaction.", recordedTags.join(", "), release.tag_name));
      } else if (expectedTag && release.tag_name !== expectedTag) {
        items.push(evidence("GitHub release", "mismatch", `The GitHub release tag does not match the requested release.`, expectedTag, release.tag_name));
      } else {
        items.push(evidence("GitHub release", "verified", `GitHub release ${release.tag_name} was found.`));
      }
    }
  } else {
    items.push(evidence("GitHub release", "not-applicable", "No GitHub client was supplied; using local release evidence."));
  }

  if (!transaction) {
    items.push(evidence("Release transaction", release ? "mismatch" : "unavailable", transactionParseError ? `The release transaction marker is invalid: ${transactionParseError}` : release ? "The GitHub release does not contain a SemVerge transaction marker." : "No SemVerge release transaction was supplied."));
  } else {
    if (target.transactionId && transaction.id !== target.transactionId) {
      items.push(evidence("Release transaction", "mismatch", "The supplied transaction ID does not match the requested release.", target.transactionId, transaction.id));
    } else if (transaction.phase !== "completed" || !transaction.ready || !transaction.published || transaction.failure) {
      items.push(evidence("Release transaction", "mismatch", `The transaction is not complete (state: ${transaction.phase}).`, "completed", transaction.phase));
    } else {
      items.push(evidence("Release transaction", "verified", `Release transaction ${transaction.id} completed successfully.`, "completed", transaction.phase));
    }
  }

  if (transaction) {
    if (target.version && transaction.version !== target.version) {
      items.push(evidence("Release version", "mismatch", "The transaction version does not match the requested release.", target.version, transaction.version));
    } else {
      items.push(evidence("Release version", "verified", `Release version ${transaction.version} is recorded in the transaction.`, target.version ?? transaction.version, transaction.version));
    }
    if (target.transactionId || transaction.id) {
      target = { ...target, transactionId: transaction.id };
    }
  } else if (target.version) {
    items.push(evidence("Release version", "unavailable", "The release transaction is unavailable, so the release version cannot be bound to durable state.", target.version));
  }

  if (transaction) {
    const recordedTags = transaction.tagNames;
    const requestedTagMismatch = Boolean(target.tag && recordedTags.length > 0 && !recordedTags.includes(target.tag));
    const tag = recordedTags.includes(target.tag ?? "") ? target.tag : recordedTags[0] ?? target.tag;
    if (!tag) {
      items.push(evidence("Git tag and source commit", "mismatch", "The transaction does not record a Git tag."));
    } else {
      let observedCommit: string | null = null;
      let tagStatus: VerificationEvidenceStatus = "unavailable";
      let tagDetail = "The Git tag could not be checked.";
      try {
        if (input.client && !input.localOnly) {
          observedCommit = await input.client.resolveTagCommit(tag);
          tagStatus = observedCommit ? "verified" : "mismatch";
          tagDetail = observedCommit ? `Git tag ${tag} resolves to a commit.` : `Git tag ${tag} was not found.`;
        } else {
          const local = await localTagCommit(input.cwd, tag);
          observedCommit = local.commit;
          if (!local.available) {
            tagStatus = "unavailable";
            tagDetail = "The local workspace is not a Git repository.";
          } else if (!observedCommit) {
            tagStatus = "mismatch";
            tagDetail = `Git tag ${tag} was not found in the local repository.`;
          } else {
            tagStatus = "verified";
            tagDetail = `Local Git tag ${tag} resolves to a commit.`;
          }
        }
      } catch (error) {
        tagStatus = "unavailable";
        tagDetail = `The Git tag could not be checked: ${providerError(error)}`;
      }
      if (requestedTagMismatch) {
        tagStatus = "mismatch";
        tagDetail = `Requested Git tag ${target.tag} is not recorded by the transaction.`;
      } else if (observedCommit && transaction.sourceCommit !== "unknown" && observedCommit !== transaction.sourceCommit) {
        tagStatus = "mismatch";
        tagDetail = `Git tag ${tag} resolves to ${observedCommit}, not the recorded source commit.`;
      } else if (observedCommit && transaction.sourceCommit === "unknown") {
        tagStatus = "unavailable";
        tagDetail = `Git tag ${tag} resolves to ${observedCommit}, but the transaction has no trusted source commit.`;
      } else if (tagStatus === "verified" && transaction.sourceCommit === "unknown") {
        tagStatus = "unavailable";
        tagDetail = `Git tag ${tag} was found, but the transaction has no trusted source commit.`;
      } else if (tagStatus === "verified") {
        tagDetail = `Git tag ${tag} matches the recorded source commit ${transaction.sourceCommit}.`;
      }
      const targetCommitish = release?.target_commitish?.trim();
      if (targetCommitish && /^[0-9a-f]{7,64}$/i.test(targetCommitish) && transaction.sourceCommit !== "unknown" && targetCommitish !== transaction.sourceCommit) {
        tagStatus = "mismatch";
        tagDetail = `GitHub release target ${targetCommitish} does not match the recorded source commit ${transaction.sourceCommit}.`;
      }
      items.push(evidence("Git tag and source commit", tagStatus, tagDetail, transaction.sourceCommit === "unknown" ? undefined : transaction.sourceCommit, observedCommit ?? undefined));
    }
  } else {
    items.push(evidence("Git tag and source commit", "unavailable", "The release transaction is unavailable, so the tag cannot be bound to its source commit."));
  }

  if (transaction) {
    await checkArtifacts(input, transaction, release, items);
    const publishingTargets = [...new Set(transaction.publishingTargets)].sort();
    if (publishingTargets.length === 0) {
      items.push(evidence("Publication targets", "not-applicable", "No external publication targets were recorded in the transaction."));
    } else {
      const needsManifest = publishingTargets.some((targetName) => targetName === "npm" || targetName === "python" || targetName === "rust");
      const manifest = needsManifest ? await fallbackManifest(input, transaction) : null;
      for (const targetName of publishingTargets) {
        if (targetName === "npm" || targetName === "python" || targetName === "rust") {
          await checkPackageTarget(input, transaction, manifest, targetName, items);
        } else if (targetName.startsWith("oci:")) {
          await checkOciTarget(input, transaction, targetName, items);
        } else {
          items.push(evidence(`Publication target ${targetName}`, "unavailable", "SemVerge does not have a verifier for this recorded provider target."));
        }
      }
      if (publishingTargets.includes("npm")) {
        await checkNpmProvenance(input, transaction, manifest, items);
      }
    }
  }

  const report: ReleaseVerificationReport = {
    schemaVersion: 1,
    input: input.target,
    ...(target.tag ? { tag: target.tag } : {}),
    ...(target.version ? { version: target.version } : {}),
    ...(target.transactionId ? { transactionId: target.transactionId } : {}),
    status: verificationStatus(items),
    evidence: items
  };
  return report;
}
