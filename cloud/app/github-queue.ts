import { readiness, type Release } from './release-data';

import type { GitHubRepository } from './github-repository';
import { isRepositoryFile, repositoryFile } from './github-files';

export type Queue = {
  entries: { number: number; url: string; version: string; channel: string; status: Release['readiness'] | 'Readiness unavailable'; blockers: string[] }[];
  unavailable: boolean;
};

type Pull = {
  number: number;
  body: string;
  head: { sha: string; repo: { full_name: string } };
};

function isReleasePull(value: unknown, repository: string): value is Pull {
  if (typeof value !== 'object' || value === null) return false;
  const pull = value as Partial<Pull>;
  return Number.isSafeInteger(pull.number) && typeof pull.body === 'string' &&
    typeof pull.head?.sha === 'string' && /^[a-f0-9]{40}$/.test(pull.head.sha) &&
    typeof pull.head.repo?.full_name === 'string' &&
    pull.head.repo.full_name.toLowerCase() === repository.toLowerCase() &&
    pull.body.startsWith('<!-- semverge-release ');
}

async function queueEntry(repository: GitHubRepository, pull: Pull, signal: AbortSignal): Promise<Queue['entries'][number]> {
  const url = `https://github.com/${repository.name}/pull/${pull.number}`;
  const fallback = { number: pull.number, url, version: 'Release plan', channel: '', status: 'Readiness unavailable', blockers: [] } as const;
  const unavailable = { ...fallback, blockers: [] as string[] };
  try {
    const marker = pull.body.match(/^<!-- semverge-release (.+?) -->\r?\n/);
    if (!marker) return unavailable;
    const plan = JSON.parse(marker[1]);
    const { version, manifest, channel } = plan ?? {};
    if (typeof version !== 'string' || !version || typeof channel !== 'string' ||
      !isRepositoryFile(manifest)) {
      return unavailable;
    }
    const identified = { ...unavailable, version, channel };
    try {
      const file = await repositoryFile(repository, manifest, pull.head.sha, signal);
      const parsed = JSON.parse(file.content);
      if (parsed?.version !== version || parsed.channel !== channel) return identified;
      const report = readiness(parsed.readiness);
      return { ...identified, status: report.readiness, blockers: report.blockers };
    } catch {
      return identified;
    }
  } catch {
    return unavailable;
  }
}

export async function githubQueue(repository: GitHubRepository): Promise<Queue> {
  try {
    const signal = AbortSignal.timeout(5000);
    const owner = repository.name.split('/')[0];
    const head = encodeURIComponent(`${owner}:${repository.releaseBranch}`);
    const response = await repository.read(`pulls?state=open&head=${head}&per_page=20`, signal);
    if (!Array.isArray(response)) throw new Error('Invalid GitHub pull request response');
    const entries = await Promise.all(response.filter((pull): pull is Pull => isReleasePull(pull, repository.name))
      .map((pull) => queueEntry(repository, pull, signal)));
    return { entries, unavailable: false };
  } catch {
    return { entries: [], unavailable: true };
  }
}
