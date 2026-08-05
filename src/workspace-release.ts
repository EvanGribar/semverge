import { basename, dirname, posix } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildReleasePlan } from "./release.js";
import { type PackageDescriptor } from "./packages.js";
import { targetFromDescriptor, updateTargetVersion } from "./version-adapters.js";
import type { PackageReleaseExplanation, PackageReleaseReason, ReadinessReport, ReleaseChange, ReleaseOutput, SemVergeConfig } from "./types.js";
import type { VersionFileChange } from "./version-files.js";

export interface PackageRelease {
  package: PackageDescriptor;
  plan: ReturnType<typeof buildReleasePlan>;
  explanation: PackageReleaseExplanation;
}

export interface WorkspaceReleasePlan {
  mode: "single" | "fixed" | "independent";
  hasRelease: boolean;
  version: string;
  channel: string;
  promotion: boolean;
  packages: PackageRelease[];
  changes: ReleaseChange[];
  releaseChanges: ReleaseChange[];
  skippedChanges: ReleaseChange[];
  readiness: ReadinessReport;
  outputs: ReleaseOutput[];
  versionChanges: VersionFileChange[];
  unchangedPackages: PackageDescriptor[];
  manifest: string;
}

export interface BuildWorkspaceReleasePlanInput {
  packages: PackageDescriptor[];
  mode: "single" | "fixed" | "independent";
  changes: ReleaseChange[];
  config: SemVergeConfig;
  files: Record<string, string>;
  date?: string;
  readinessContext?: Parameters<typeof buildReleasePlan>[0]["readinessContext"];
}

type PlannedPackageRelease = Omit<PackageRelease, "explanation">;

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function outputPath(packageItem: PackageDescriptor, relativePath: string, mode: "single" | "fixed" | "independent"): string {
  const clean = normalize(relativePath);
  return mode === "independent" && packageItem.directory ? posix.join(packageItem.directory, clean) : clean;
}

function packageNameMatches(packageItem: PackageDescriptor, scope: string | undefined): boolean {
  if (!scope) {
    return false;
  }
  const cleanScope = scope.trim().toLowerCase();
  return [packageItem.id, packageItem.name, basename(packageItem.directory)].some((candidate) => candidate.toLowerCase() === cleanScope);
}

function ownsFile(file: string, directory: string): boolean {
  return file === directory || file.startsWith(`${directory}/`);
}

function packageOwner(file: string, workspaceDirectories: readonly string[]): string | undefined {
  return [...workspaceDirectories]
    .filter((directory) => ownsFile(file, directory))
    .sort((left, right) => right.length - left.length)[0];
}

function affectsPackage(change: ReleaseChange, packageItem: PackageDescriptor, config: SemVergeConfig, workspaceDirectories: readonly string[]): boolean {
  if (packageNameMatches(packageItem, change.scope)) {
    return true;
  }
  const files = (change.files ?? []).map(normalize);
  if (files.length === 0) {
    return config.monorepo.unscopedChanges === "all";
  }
  return files.some((file) => {
    const owner = packageOwner(file, workspaceDirectories);
    return owner === (packageItem.directory || undefined) || (!owner && config.monorepo.unscopedChanges === "all");
  });
}

function packageConfig(config: SemVergeConfig, packageItem: PackageDescriptor, mode: "single" | "fixed" | "independent"): SemVergeConfig {
  const packageOutputs: SemVergeConfig["outputs"] = {
    changelog: outputPath(packageItem, config.outputs.changelog, mode),
    customerNotes: outputPath(packageItem, config.outputs.customerNotes, mode),
    migrationGuide: outputPath(packageItem, config.outputs.migrationGuide, mode),
    internalSummary: outputPath(packageItem, config.outputs.internalSummary, mode),
    manifest: outputPath(packageItem, config.outputs.manifest, mode),
    announcement: outputPath(packageItem, config.outputs.announcement, mode)
  };
  return {
    ...config,
    outputs: packageOutputs,
    readiness: {
      ...config.readiness,
      requiredLabels: [...config.readiness.requiredLabels],
      requiredFiles: [...config.readiness.requiredFiles],
      commands: [...config.readiness.commands],
      tasks: [...config.readiness.tasks]
    }
  };
}

function buildPackagePlan(input: BuildWorkspaceReleasePlanInput, packageItem: PackageDescriptor, changes: ReleaseChange[]): ReturnType<typeof buildReleasePlan> {
  const config = packageConfig(input.config, packageItem, input.mode);
  return buildReleasePlan({
    currentVersion: packageItem.version,
    changes,
    config,
    existingChangelog: input.files[config.outputs.changelog] ?? "",
    date: input.date,
    readinessContext: input.readinessContext
  });
}

function workspaceDependencyChange(packageItem: PackageDescriptor, dependencyNames: string[]): ReleaseChange {
  const dependencies = dependencyNames.join(", ");
  return {
    title: `chore(${packageItem.name}): refresh workspace dependencies`,
    description: `Refresh workspace dependency metadata after ${dependencies} release.`,
    source: "commit",
    labels: ["ship:internal"],
    kind: "internal",
    scope: packageItem.name,
    breaking: false,
    skipped: false,
    forcedBump: "patch",
    dependencyUpdate: true,
    customerSummary: `Refresh ${packageItem.name} for the ${dependencies} release.`,
    internalSummary: `Refresh ${packageItem.name} after ${dependencies} released.`,
    readiness: []
  };
}

function packageExplanation(packageRelease: Omit<PackageRelease, "explanation">, releasedNames: ReadonlySet<string>, mode: "single" | "fixed" | "independent", releasedPackageCount: number): PackageReleaseExplanation {
  const directChanges = [...new Set(packageRelease.plan.releaseChanges.filter((change) => !change.dependencyUpdate).map((change) => change.title))];
  const dependencies = mode === "independent"
    ? [...new Set(packageRelease.package.workspaceDependencies.filter((dependency) => releasedNames.has(dependency)))]
    : [];
  const reasons: PackageReleaseReason[] = [];
  if (directChanges.length > 0) {
    reasons.push("direct-change");
  }
  if (dependencies.length > 0) {
    reasons.push("dependency-update");
  }
  if (mode === "fixed" && releasedPackageCount > 1) {
    reasons.push("fixed-workspace");
  }
  return { reasons, directChanges, dependencies };
}

function mergeReadiness(reports: ReadinessReport[]): ReadinessReport {
  return {
    passed: reports.every((report) => report.passed),
    missingLabels: [...new Set(reports.flatMap((report) => report.missingLabels))],
    missingFiles: [...new Set(reports.flatMap((report) => report.missingFiles))],
    failedCommands: [...new Set(reports.flatMap((report) => report.failedCommands))],
    missingTasks: [...new Set(reports.flatMap((report) => report.missingTasks))],
    requestedTasks: [...new Set(reports.flatMap((report) => report.requestedTasks))]
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function updateDependencyRange(range: string, version: string): string {
  const protocol = range.startsWith("workspace:") ? "workspace:" : "";
  const value = protocol ? range.slice(protocol.length) : range;
  if (value === "*" || value === "^" || value === "~") {
    return range;
  }
  const updated = value.replace(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/, version);
  return protocol ? `${protocol}${updated}` : updated;
}

function updateInternalDependencyRanges(files: Record<string, string>, packages: PackageDescriptor[], versions: Map<string, string>): VersionFileChange[] {
  const byName = new Map(packages.filter((item) => item.ecosystem === "node").map((item) => [item.name, item]));
  const changes: VersionFileChange[] = [];
  for (const packageItem of packages.filter((item) => item.ecosystem === "node")) {
    const content = files[packageItem.manifestPath];
    if (content === undefined) {
      continue;
    }
    let manifest: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(content);
      const object = objectValue(parsed);
      if (!object) {
        continue;
      }
      manifest = object;
    } catch {
      continue;
    }
    let changed = false;
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const dependencies = objectValue(manifest[field]);
      if (!dependencies) {
        continue;
      }
      for (const [name, range] of Object.entries(dependencies)) {
        const dependency = byName.get(name);
        const version = dependency ? versions.get(dependency.manifestPath) : undefined;
        if (!version || typeof range !== "string") {
          continue;
        }
        const updated = updateDependencyRange(range, version);
        if (updated !== range) {
          dependencies[name] = updated;
          changed = true;
        }
      }
    }
    if (changed) {
      changes.push({ path: packageItem.manifestPath, content: `${JSON.stringify(manifest, null, 2)}\n` });
    }
  }
  return changes;
}

function updatePnpmLock(content: string, packages: PackageDescriptor[], versions: Map<string, string>): string | null {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return null;
  }
  const lock = objectValue(parsed);
  const importers = objectValue(lock?.importers);
  if (!lock || !importers) {
    return null;
  }
  const byName = new Map(packages.filter((item) => item.ecosystem === "node").map((item) => [item.name, item]));
  const byDirectory = new Map(packages.filter((item) => item.ecosystem === "node").map((item) => [item.directory || ".", item]));
  let changed = false;
  for (const [directory, importerValue] of Object.entries(importers)) {
    const importer = objectValue(importerValue);
    if (!importer) {
      continue;
    }
    const packageItem = byDirectory.get(directory);
    if (packageItem) {
      const version = versions.get(packageItem.manifestPath);
      if (version && typeof importer.version === "string") {
        const updated = updateDependencyRange(importer.version, version);
        if (updated !== importer.version) {
          importer.version = updated;
          changed = true;
        }
      }
    }
    for (const field of ["specifiers", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const dependencies = objectValue(importer[field]);
      if (!dependencies) {
        continue;
      }
      for (const [name, value] of Object.entries(dependencies)) {
        const dependency = byName.get(name);
        const version = dependency ? versions.get(dependency.manifestPath) : undefined;
        if (!version) {
          continue;
        }
        if (typeof value === "string") {
          const updated = updateDependencyRange(value, version);
          if (updated !== value) {
            dependencies[name] = updated;
            changed = true;
          }
          continue;
        }
        const dependencyRecord = objectValue(value);
        if (!dependencyRecord) {
          continue;
        }
        for (const key of ["specifier", "version"]) {
          const current = dependencyRecord[key];
          if (typeof current !== "string") {
            continue;
          }
          const updated = updateDependencyRange(current, version);
          if (updated !== current) {
            dependencyRecord[key] = updated;
            changed = true;
          }
        }
      }
    }
  }
  return changed ? stringifyYaml(lock) : null;
}

function updateNodeLocks(files: Record<string, string>, packages: PackageDescriptor[], versions: Map<string, string>): VersionFileChange[] {
  const changes: VersionFileChange[] = [];
  const lockPaths = new Set(["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml"]);
  for (const packageItem of packages.filter((item) => item.ecosystem === "node" && item.directory)) {
    lockPaths.add(`${packageItem.directory}/package-lock.json`);
    lockPaths.add(`${packageItem.directory}/npm-shrinkwrap.json`);
  }
  for (const path of lockPaths) {
    const content = files[path];
    if (content === undefined) {
      continue;
    }
    if (path === "pnpm-lock.yaml") {
      const updated = updatePnpmLock(content, packages, versions);
      if (updated && updated !== content) {
        changes.push({ path, content: updated });
      }
      continue;
    }
    let lock: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(content);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      lock = value as Record<string, unknown>;
    } catch {
      continue;
    }
    const lockDirectory = path.includes("/") ? dirname(path).replace(/\\/g, "/") : "";
    const root = packages.find((item) => item.directory === lockDirectory) ?? packages.find((item) => item.directory === "");
    if (root && versions.has(root.manifestPath)) {
      lock.version = versions.get(root.manifestPath);
    }
    const entries = lock.packages;
    if (entries && typeof entries === "object" && !Array.isArray(entries)) {
      const packageEntries = entries as Record<string, unknown>;
      const rootEntry = packageEntries[""];
      const rootVersion = root ? versions.get(root.manifestPath) : undefined;
      if (rootVersion && rootEntry && typeof rootEntry === "object" && !Array.isArray(rootEntry)) {
        (rootEntry as Record<string, unknown>).version = rootVersion;
      }
      for (const packageItem of lockDirectory ? [] : packages) {
        const version = versions.get(packageItem.manifestPath);
        if (!version) {
          continue;
        }
        const keys = [packageItem.directory, packageItem.directory ? `node_modules/${packageItem.name}` : "", `node_modules/${packageItem.name}`];
        for (const key of keys) {
          const entry = packageEntries[key];
          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            (entry as Record<string, unknown>).version = version;
          }
        }
      }
    }
    changes.push({ path, content: `${JSON.stringify(lock, null, 2)}\n` });
  }
  return changes;
}

function manifestContent(plan: WorkspaceReleasePlan): string {
  return `${JSON.stringify({
    schemaVersion: 2,
    mode: plan.mode,
    version: plan.version,
    channel: plan.channel,
    promotion: plan.promotion,
    generatedAt: new Date().toISOString(),
    packages: plan.packages.map(({ package: packageItem, plan: packagePlan, explanation }) => ({
      id: packageItem.id,
      name: packageItem.name,
      directory: packageItem.directory,
      ecosystem: packageItem.ecosystem,
      previousVersion: packageItem.version,
      version: packagePlan.version,
      bump: packagePlan.bump,
      channel: packagePlan.channel,
      promotion: packagePlan.promotion,
      changelog: packagePlan.outputs.find((output) => output.path.toLowerCase().endsWith("changelog.md"))?.path,
      customerNotes: packagePlan.outputs.find((output) => output.path.toLowerCase().endsWith("release_notes.md") || output.path.toLowerCase().endsWith("release-notes.md"))?.path,
      private: packageItem.private,
      releaseable: packageItem.releaseable,
      dependencyUpdate: packagePlan.releaseChanges.some((change) => change.dependencyUpdate),
      reasons: explanation.reasons,
      directChanges: explanation.directChanges,
      dependencies: explanation.dependencies
    })),
    unchangedPackages: plan.unchangedPackages.map((packageItem) => ({
      id: packageItem.id,
      name: packageItem.name,
      directory: packageItem.directory,
      ecosystem: packageItem.ecosystem,
      version: packageItem.version,
      private: packageItem.private,
      releaseable: packageItem.releaseable
    })),
    readiness: plan.readiness
  }, null, 2)}\n`;
}

export function buildWorkspaceReleasePlan(input: BuildWorkspaceReleasePlanInput): WorkspaceReleasePlan {
  const releaseable = input.packages.filter((packageItem) => packageItem.releaseable || input.mode === "fixed" || input.mode === "single");
  const skippedChanges = input.changes.filter((change) => change.skipped);
  const plans: PlannedPackageRelease[] = [];

  if (input.mode === "fixed" || input.mode === "single") {
    const packageItem = releaseable[0] ?? input.packages[0];
    if (!packageItem) {
      throw new Error("SemVerge found no releaseable package.");
    }
    const packageConfig: SemVergeConfig = {
      ...input.config,
      outputs: { ...input.config.outputs },
      readiness: { ...input.config.readiness, requiredLabels: [...input.config.readiness.requiredLabels], requiredFiles: [...input.config.readiness.requiredFiles], commands: [...input.config.readiness.commands], tasks: [...input.config.readiness.tasks] }
    };
    const plan = buildReleasePlan({
      currentVersion: packageItem.version,
      changes: input.changes,
      config: packageConfig,
      existingChangelog: input.files[input.config.outputs.changelog] ?? "",
      date: input.date,
      readinessContext: input.readinessContext
    });
    plans.push(...releaseable.map((releasePackage) => ({ package: releasePackage, plan })));
  } else {
    const packagePlans = new Map<string, PlannedPackageRelease>();
    const workspaceDirectories = input.packages.flatMap((packageItem) => packageItem.directory ? [packageItem.directory] : []);
    for (const packageItem of releaseable) {
      const packageChanges = input.changes.filter((change) => affectsPackage(change, packageItem, input.config, workspaceDirectories));
      const plan = buildPackagePlan(input, packageItem, packageChanges);
      if (plan.hasRelease) {
        packagePlans.set(packageItem.id, { package: packageItem, plan });
      }
    }

    let addedDependencyRelease = true;
    while (addedDependencyRelease) {
      addedDependencyRelease = false;
      const releasedNames = new Set([...packagePlans.values()].flatMap(({ package: packageItem }) => [packageItem.id, packageItem.name]));
      for (const packageItem of releaseable) {
        if (packagePlans.has(packageItem.id)) {
          continue;
        }
        const dependencyNames = packageItem.workspaceDependencies.filter((dependency) => releasedNames.has(dependency));
        if (dependencyNames.length === 0) {
          continue;
        }
        const packageChanges = input.changes.filter((change) => affectsPackage(change, packageItem, input.config, workspaceDirectories));
        const plan = buildPackagePlan(input, packageItem, [...packageChanges, workspaceDependencyChange(packageItem, dependencyNames)]);
        if (plan.hasRelease) {
          packagePlans.set(packageItem.id, { package: packageItem, plan });
          addedDependencyRelease = true;
        }
      }
    }
    for (const packageItem of releaseable) {
      const packagePlan = packagePlans.get(packageItem.id);
      if (packagePlan) {
        plans.push(packagePlan);
      }
    }
  }

  const releasedPlans = plans.filter((item) => item.plan.hasRelease);
  const releasedNames = new Set(releasedPlans.flatMap(({ package: packageItem }) => [packageItem.id, packageItem.name]));
  const packageReleases = plans.map((packageRelease) => ({
    ...packageRelease,
    explanation: packageExplanation(packageRelease, releasedNames, input.mode, releasedPlans.length)
  }));
  const unchangedPackages = input.packages.filter((packageItem) => !releasedPlans.some((release) => release.package.manifestPath === packageItem.manifestPath));
  const hasRelease = releasedPlans.length > 0;
  const releaseChanges = input.mode === "independent" ? [...new Map(packageReleases.flatMap((item) => item.plan.releaseChanges.map((change) => [change.title, change] as const))).values()] : input.changes.filter((change) => !change.skipped);
  const readiness = mergeReadiness(packageReleases.length > 0 ? packageReleases.map((item) => item.plan.readiness) : [input.readinessContext ? { passed: true, missingLabels: [], missingFiles: [], failedCommands: [], missingTasks: [], requestedTasks: [] } : { passed: true, missingLabels: [], missingFiles: [], failedCommands: [], missingTasks: [], requestedTasks: [] }]);
  const version = input.mode === "independent" ? releasedPlans.map((item) => `${item.package.name}@${item.plan.version}`).join(", ") : plans[0]?.plan.version ?? input.packages[0]?.version ?? "0.0.0";
  const channel = input.mode === "independent"
    ? [...new Set(packageReleases.map((item) => item.plan.channel))].join(", ") || "stable"
    : plans[0]?.plan.channel ?? "stable";
  const promotion = packageReleases.some((item) => item.plan.promotion);
  const versionChangeMap = new Map<string, VersionFileChange>();
  const versionMap = new Map<string, string>();
  for (const item of packageReleases) {
    const nextVersion = item.plan.version;
    versionMap.set(item.package.manifestPath, nextVersion);
    const manifest = input.files[item.package.manifestPath];
    if (manifest !== undefined) {
      const change = updateTargetVersion(targetFromDescriptor(item.package), manifest, nextVersion);
      versionChangeMap.set(change.path, change);
    }
  }
  if (input.mode === "fixed" || input.mode === "single") {
    const fixedPlan = packageReleases[0];
    if (fixedPlan?.plan.hasRelease) {
      for (const packageItem of input.packages) {
        if (packageItem.manifestPath === fixedPlan.package.manifestPath) {
          continue;
        }
        const manifest = input.files[packageItem.manifestPath];
        if (manifest !== undefined) {
          versionMap.set(packageItem.manifestPath, fixedPlan.plan.version);
          const change = updateTargetVersion(targetFromDescriptor(packageItem), manifest, fixedPlan.plan.version);
          versionChangeMap.set(change.path, change);
        }
      }
    }
  }
  const dependencyFiles: Record<string, string> = { ...input.files };
  for (const [path, change] of versionChangeMap) {
    dependencyFiles[path] = change.content;
  }
  for (const change of updateInternalDependencyRanges(dependencyFiles, input.packages, versionMap)) {
    versionChangeMap.set(change.path, change);
  }
  for (const change of updateNodeLocks(input.files, input.packages, versionMap)) {
    versionChangeMap.set(change.path, change);
  }
  const versionChanges = [...versionChangeMap.values()];

  const outputMap = new Map<string, string>();
  for (const item of packageReleases) {
    for (const output of item.plan.outputs) {
      if (output.path !== (input.mode === "independent" ? outputPath(item.package, input.config.outputs.manifest, input.mode) : input.config.outputs.manifest)) {
        outputMap.set(output.path, output.content);
      }
    }
  }
  const provisional: WorkspaceReleasePlan = {
    mode: input.mode,
    hasRelease,
    version,
    channel,
    promotion,
    packages: packageReleases,
    changes: input.changes,
    releaseChanges,
    skippedChanges,
    readiness,
    outputs: [...outputMap].map(([path, content]) => ({ path, content })),
    versionChanges,
    unchangedPackages,
    manifest: ""
  };
  const manifest = manifestContent(provisional);
  provisional.manifest = manifest;
  if (hasRelease) {
    provisional.outputs.push({ path: input.config.outputs.manifest, content: manifest });
  } else {
    provisional.outputs = [];
    provisional.versionChanges = [];
  }
  return provisional;
}
