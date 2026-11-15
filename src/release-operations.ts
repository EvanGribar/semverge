import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseChange } from "./changes.js";
import { parseConfig, validateConfig, validateConfigContent, type ConfigValidationIssue } from "./config.js";
import { inspectRepository } from "./doctor.js";
import { discoverPackages } from "./packages.js";
import { buildReleasePlan } from "./release.js";
import { parseVersion } from "./semver.js";
import { parseReleaseTransaction, parseReleaseTransactionBody, summarizeReleaseTransaction, type ReleaseTransaction } from "./transaction.js";
import { readPackageVersion } from "./version-files.js";
import { readVersionFile, validateVersionFileConfig } from "./version-updaters.js";
import { buildWorkspaceReleasePlan, type WorkspaceReleasePlan } from "./workspace-release.js";
import type { ReadinessContext, ReleasePlan, SemVergeConfig } from "./types.js";

export type LocalPlan = ReleasePlan | WorkspaceReleasePlan;

export async function readOptional(path: string): Promise<string | undefined> {
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

function localVersionFilePath(cwd: string, spec: SemVergeConfig["versionFiles"][number]): string {
  const validation = validateVersionFileConfig(spec);
  if (validation.length > 0) {
    throw new Error(`Invalid version file ${spec.path}: ${validation.join("; ")}`);
  }
  const absolute = resolve(cwd, spec.path);
  const outside = relative(cwd, absolute);
  if (outside === ".." || outside.startsWith(`..${sep}`) || outside.includes(`..${sep}`)) {
    throw new Error(`Version file ${spec.path} must stay inside the working directory.`);
  }
  return absolute;
}

export async function localPlan(cwd: string, configPath: string, title: string): Promise<LocalPlan> {
  const config = parseConfig(await readOptional(join(cwd, configPath)) ?? "", configPath);
  return buildLocalPlan(cwd, config, title);
}

async function buildLocalPlan(cwd: string, config: SemVergeConfig, title: string, readinessContext?: ReadinessContext): Promise<LocalPlan> {
  const packageJson = await readOptional(join(cwd, "package.json"));
  const changes = [parseChange({ title: title || "fix: generated local preview", source: "commit" })];
  if (packageJson !== undefined || config.versionFiles.length === 0) {
    const packageContent = packageJson ?? await readFile(join(cwd, "package.json"), "utf8");
    return buildReleasePlan({
      currentVersion: readPackageVersion(packageContent),
      config,
      changes,
      readinessContext
    });
  }

  const files: Record<string, string> = {};
  for (const spec of config.versionFiles) {
    const content = await readOptional(localVersionFilePath(cwd, spec));
    if (content === undefined) {
      throw new Error(`Configured version file ${spec.path} was not found in ${cwd}.`);
    }
    files[spec.path] = content;
    readVersionFile(spec, content);
  }
  const discovered = discoverPackages(files, Object.keys(files), config);
  return buildWorkspaceReleasePlan({
    packages: discovered.packages,
    mode: discovered.mode,
    files,
    config,
    changes,
    readinessContext
  });
}

export async function analyzeLocalRepository(cwd: string, configPath: string) {
  const issues: ConfigValidationIssue[] = [];
  const packagePath = join(cwd, "package.json");
  const packageJson = await readOptional(packagePath);
  const configContent = await readOptional(join(cwd, configPath));
  let config: SemVergeConfig | undefined;
  if (configContent !== undefined) {
    const contentIssues = validateConfigContent(configContent, configPath);
    issues.push(...contentIssues);
    if (!contentIssues.some((issue) => issue.severity === "error")) {
      config = parseConfig(configContent, configPath);
      issues.push(...validateConfig(config));
    }
  }

  if (packageJson === undefined && config?.versionFiles.length) {
    for (const spec of config.versionFiles) {
      let content: string | undefined;
      try {
        content = await readOptional(localVersionFilePath(cwd, spec));
      } catch (error) {
        issues.push({ path: spec.path, severity: "error", message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      if (content === undefined) {
        issues.push({ path: `versionFiles.${spec.path}`, severity: "error", message: "configured version file was not found" });
        continue;
      }
      try {
        const version = readVersionFile(spec, content);
        if (!parseVersion(version)) {
          issues.push({ path: `${spec.path}.version`, severity: "error", message: `is not valid semantic versioning: ${version}` });
        }
      } catch (error) {
        issues.push({ path: spec.path, severity: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }
  } else if (packageJson === undefined) {
    issues.push({ path: "package.json", severity: "error", message: "file is required unless versionFiles defines a generic repository target" });
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

  return { repository: await inspectRepository(cwd), issues, configSource: configContent === undefined ? "defaults" as const : "file" as const };
}

export function parseLocalTransaction(content: string): ReleaseTransaction {
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


export function summarizeLocalPlan(plan: LocalPlan) {
  const { hasRelease, version, channel, promotion } = plan;
  const summarizeVersion = ({ previousVersion, version, bump }: ReleasePlan) => ({ previousVersion, version, bump });
  return {
    scope: "local-preview" as const,
    hasRelease, version, channel, promotion,
    ...("packages" in plan
      ? { mode: plan.mode, packages: plan.packages.map((item) => ({ id: item.package.id, ...summarizeVersion(item.plan) })) }
      : summarizeVersion(plan))
  };
}

async function checkoutFile(root: string, path: string): Promise<string | undefined> {
  const inside = (from: string, to: string) => {
    const remainder = relative(from, to);
    return remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
  };
  const candidate = resolve(root, path);
  if (!inside(root, candidate)) throw new Error("Evidence path is outside the checkout.");
  try {
    const target = await realpath(candidate);
    if (!inside(await realpath(root), target)) throw new Error("Evidence path is outside the checkout.");
    return (await stat(target)).isFile() ? target : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function checkLocalReadiness(cwd: string, configPath: string, title: string) {
  const config = parseConfig(await readOptional(join(cwd, configPath)) ?? "", configPath);
  const paths = new Set([...config.readiness.requiredFiles, ...config.readiness.tasks.flatMap((task) => task.file ? [task.file] : [])]);
  const availableFiles = new Set<string>();
  const unavailableFiles = new Set<string>();
  for (const path of paths) {
    try {
      if (await checkoutFile(cwd, path)) availableFiles.add(path);
    } catch {
      unavailableFiles.add(path);
    }
  }
  const plan = await buildLocalPlan(cwd, config, title, { availableFiles });
  const blockers = [
    ...plan.readiness.missingFiles.filter((path) => !unavailableFiles.has(path)).map((path) => ({ kind: "missing-file", name: path })),
    ...plan.readiness.missingTasks.filter((name) => {
      const task = config.readiness.tasks.find((item) => item.name.toLowerCase() === name.toLowerCase());
      return !task?.label && !(task?.file && unavailableFiles.has(task.file));
    }).map((name) => ({ kind: "incomplete-task", name }))
  ];
  const unavailableEvidence = [
    ...Array.from(unavailableFiles, (name) => ({ kind: "file", name })),
    ...plan.readiness.missingLabels.map((name) => ({ kind: "pull-request-label", name })),
    ...plan.readiness.missingTasks.filter((name) => config.readiness.tasks.some((task) => task.name.toLowerCase() === name.toLowerCase() && task.label))
      .map((name) => ({ kind: "task-label", name })),
    ...config.readiness.commands.map(({ name }) => ({ kind: "configured-command-result", name }))
  ];
  const status = !plan.hasRelease ? "no-release" : blockers.length ? "blocked" : "unverified";
  return {
    scope: "local-checkout" as const,
    status,
    proposedVersion: plan.hasRelease ? plan.version : null,
    publicationAuthorized: false as const,
    blockers,
    observedFiles: [...availableFiles],
    unavailableEvidence,
    notAssessed: ["source-commit", "hosted-ci", "artifact-provenance"],
  };
}

export async function inspectLocalRelease(cwd: string, id: string) {
  if (!/^release_[A-Za-z0-9-]{1,100}$/.test(id)) throw new Error("Expected a SemVerge transaction ID.");
  const path = await checkoutFile(cwd, join(".semverge", "release-state", id + ".json"));
  const content = path ? await readOptional(path) : undefined;
  if (content === undefined) return { status: "unavailable" as const, id, reason: "No local transaction record was found." };
  const tx = parseLocalTransaction(content);
  if (tx.id !== id) throw new Error("The local record does not match the requested transaction ID.");
  const { failure, ...summary } = summarizeReleaseTransaction(tx);
  return { status: "recorded" as const, evidence: "local-transaction" as const, transaction: { ...summary, hasFailure: failure !== undefined } };
}
