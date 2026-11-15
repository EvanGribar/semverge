import { publishedTechnicalNotes } from './github-changelog';
import type { ReleaseSource } from './release-data';
import { readReleaseRecord } from './release-verification';

import type { GitHubRepository } from './github-repository';
const releaseCount = 20;

type GitHubRelease = {
  tag_name: string;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
};

function isPublishedRelease(value: unknown): value is GitHubRelease {
  if (typeof value !== 'object' || value === null) return false;
  const release = value as Partial<GitHubRelease>;
  return release.draft === false && typeof release.tag_name === 'string' &&
    typeof release.prerelease === 'boolean' && typeof release.published_at === 'string' &&
    Number.isFinite(Date.parse(release.published_at)) &&
    (typeof release.body === 'string' || release.body === null);
}

export async function githubReleases(repository: GitHubRepository, example?: ReleaseSource, includeTechnical = true): Promise<ReleaseSource> {
  try {
    const releaseUrl = (tag: string) => `https://github.com/${repository.name}/releases/tag/${encodeURIComponent(tag)}`;
    const data = await repository.read(`releases?per_page=${releaseCount}`, AbortSignal.timeout(5000));
    if (!Array.isArray(data)) throw new Error('Invalid GitHub release response');
    const releases = data.filter(isPublishedRelease)
      .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at));
    const latest = releases[0];
    if (!latest) throw new Error('No published releases returned');

    const { transaction, verification } = readReleaseRecord(latest.body, latest.tag_name);
    const technical = transaction && includeTechnical ? await publishedTechnicalNotes(repository, latest.tag_name, transaction) : undefined;
    const current = example?.releases.find((release) => `v${release.version}` === latest.tag_name);
    const earlier = releases.find((release) => release.prerelease === latest.prerelease && release.tag_name !== latest.tag_name);
    const history = releases.map((release) => ({
      tag: release.tag_name,
      date: release.published_at.slice(0, 10),
      url: releaseUrl(release.tag_name),
    }));
    return {
      name: repository.name,
      kind: 'GitHub releases',
      history,
      releases: [{
        name: repository.name,
        version: latest.tag_name.replace(/^v(?=\d)/, ''),
        previousVersion: technical?.previousVersion ?? current?.previousVersion ?? earlier?.tag_name.replace(/^v(?=\d)/, ''),
        channel: latest.prerelease ? 'prerelease' : 'stable',
        readiness: 'Published',
        verification,
        blockers: [],
        url: releaseUrl(latest.tag_name),
        customerNotes: (latest.body ?? '').replace(/<!-- semverge-progress [\s\S]*? -->/g, '').split(/^### SemVerge transaction$/m)[0].trim(),
        technicalNotes: technical?.notes ?? current?.technicalNotes ?? '',
        technicalSources: technical?.sources,
        changelog: '',
      }],
    };
  } catch {
    return example
      ? { ...example, notice: 'GitHub release history is unavailable. Showing the checked-in release snapshot.' }
      : { name: repository.name, kind: 'GitHub releases', releases: [], notice: 'GitHub release history is unavailable.' };
  }
}

