import type { Queue } from './github-queue';
import type { ReleaseSource } from './release-data';

export type RepositoryOverview = {
  name: string;
  href: string;
  queue: Queue;
  latest?: { version: string; status: string; url: string };
};

export function repositorySummary(name: string, href: string, queue: Queue, published: ReleaseSource): RepositoryOverview {
  const latest = published.kind === 'GitHub releases' ? published.releases[0] : undefined;
  return {
    name, href, queue,
    latest: latest?.url ? { version: latest.version, status: latest.readiness, url: latest.url } : undefined,
  };
}
