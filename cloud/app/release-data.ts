type RecordValue = Record<string, unknown>;

export type Release = {
  name: string;
  version: string;
  previousVersion?: string;
  channel: string;
  readiness: 'Passed' | 'Blocked' | 'No release' | 'Published' | 'Verified' | 'Verification failed';
  url?: string;
  blockers: string[];
  customerNotes: string;
  technicalNotes: string;
  technicalSources?: { path: string; url: string }[];
  changelog: string;
  migrationGuide?: string;
};

export type ReleaseSource = {
  name: string;
  kind: 'Public example' | 'Local plan' | 'GitHub releases';
  notice?: string;
  history?: { tag: string; date: string; url: string }[];
  releases: Release[];
};

function record(value: unknown): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a SemVerge release plan object.');
  }
  return value as RecordValue;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}.`);
  return value;
}

function notes(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readiness(value: unknown, hasRelease = true) {
  const report = record(value);
  if (typeof report.passed !== 'boolean') throw new Error('Missing the readiness result.');
  const fields = [
    ['missingLabels', 'Missing label'],
    ['missingFiles', 'Missing file'],
    ['failedCommands', 'Command did not pass'],
    ['missingTasks', 'Missing task'],
  ] as const;
  const blockers = fields.flatMap(([key, label]) => {
    const entries = report[key];
    if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === 'string')) {
      throw new Error(`Invalid readiness field ${key}.`);
    }
    return entries.map((entry) => `${label} — ${entry}`);
  });
  const status = !hasRelease ? 'No release' : report.passed ? 'Passed' : 'Blocked';
  return { readiness: status as Release['readiness'], blockers };
}

function packagePlan(plan: RecordValue, name: string): Release {
  if (typeof plan.hasRelease !== 'boolean' || !Array.isArray(plan.outputs)) {
    throw new Error('Expected a plan from semverge plan.');
  }
  // The release engine emits the changelog first, including when its path is configured.
  const changelog = plan.outputs.length ? notes(record(plan.outputs[0]).content) : '';
  return {
    name,
    version: requiredText(plan.version, 'release version'),
    previousVersion: notes(plan.previousVersion),
    channel: requiredText(plan.channel, 'release channel'),
    ...readiness(plan.readiness, plan.hasRelease),
    customerNotes: notes(plan.customerNotes),
    technicalNotes: notes(plan.internalSummary),
    changelog,
    migrationGuide: notes(plan.migrationGuide),
  };
}

export function importPlan(value: unknown, filename: string): ReleaseSource {
  const plan = record(value);
  const name = filename.replace(/\.json$/i, '');
  const releases = Array.isArray(plan.packages)
    ? plan.packages.map((entry: unknown) => {
        const item = record(entry);
        const release = packagePlan(record(item.plan), requiredText(record(item.package).name, 'package name'));
        const workspace = readiness(plan.readiness, plan.hasRelease !== false);
        return {
          ...release,
          readiness: workspace.readiness === 'Passed' ? release.readiness : workspace.readiness,
          blockers: [...new Set([...workspace.blockers, ...release.blockers])],
        };
      })
    : [packagePlan(plan, name)];
  if (!releases.length) {
    if (plan.hasRelease !== false) throw new Error('The plan contains no packages.');
    releases.push({
      name,
      version: requiredText(plan.version, 'release version'),
      channel: requiredText(plan.channel, 'release channel'),
      ...readiness(plan.readiness, false),
      customerNotes: '',
      technicalNotes: '',
      changelog: '',
    });
  }
  return { name, kind: 'Local plan', releases };
}

export function publicRelease(snapshot: {
  manifest: { packages: { name: string; version: string; previousVersion: string }[]; channel: string; readiness: unknown };
  customerNotes: string;
  changelog: string;
}): ReleaseSource {
  const sections = snapshot.changelog.split(/(?=^## \[)/m);
  const releases = snapshot.manifest.packages.map((item) => ({
    name: item.name,
    version: item.version,
    previousVersion: item.previousVersion,
    channel: snapshot.manifest.channel,
    ...readiness(snapshot.manifest.readiness),
    customerNotes: snapshot.customerNotes,
    technicalNotes: sections.find((section) => section.startsWith(`## [${item.version}]`)) ?? '',
    changelog: snapshot.changelog,
  }));
  return { name: 'EvanGribar / semverge', kind: 'Public example', releases };
}

