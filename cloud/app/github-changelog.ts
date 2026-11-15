import type { GitHubRepository } from './github-repository';
import { isRepositoryFile, repositoryFile } from './github-files.ts';

type Package = {
  id: string;
  name: string;
  version: string;
  previousVersion?: string;
  changelog: string;
};

function isPackage(value: unknown): value is Package {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<Package>;
  return typeof item.id === 'string' && typeof item.name === 'string' &&
    typeof item.version === 'string' && /^[\w.+-]+$/.test(item.version) && isRepositoryFile(item.changelog);
}

function changelogSection(markdown: string, version: string) {
  return markdown.split(/(?=^## \[)/m).find((section) =>
    section.startsWith(`## [${version}]`))?.trim();
}

export async function publishedTechnicalNotes(repository: GitHubRepository, tag: string, transaction: {
  sourceCommit: string; version: string; packageIds: string[];
}) {
  const signal = AbortSignal.timeout(5000);
  try {
    const manifest = await repositoryFile(repository, 'release-manifest.json', transaction.sourceCommit, signal);
    const parsed = JSON.parse(manifest.content);
    if (parsed?.schemaVersion !== 2 || parsed.version !== transaction.version || !Array.isArray(parsed.packages)) return;
    const candidates: Package[] = parsed.packages.filter(isPackage).filter((item: Package) => transaction.packageIds.includes(item.id));
    const matching = candidates.filter((item) => parsed.mode === 'independent'
      ? tag.endsWith(`${item.name.replace(/^@/, '').replace(/[\\/]/g, '-')}@${item.version}`)
      : item.version === transaction.version);
    if (!matching.length || (parsed.mode === 'independent' && matching.length !== 1)) return;

    const unique = [...new Map(matching.map((item) => [item.changelog, item])).values()];
    const sources: { content: string; url: string; path: string }[] = [];
    for (let offset = 0; offset < unique.length && !signal.aborted; offset += 4) {
      const blocks = await Promise.allSettled(unique.slice(offset, offset + 4).map(async (item) => {
        const file = await repositoryFile(repository, item.changelog, transaction.sourceCommit, signal);
        const content = changelogSection(file.content, item.version);
        return content ? { content, url: file.url, path: item.changelog } : undefined;
      }));
      sources.push(...blocks.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []));
    }
    if (!sources.length) return;
    const previous = matching[0].previousVersion;
    return {
      notes: sources.map(({ content }) => content).join('\n\n'),
      sources: sources.map(({ url, path }) => ({ url, path })),
      previousVersion: typeof previous === 'string' && matching.every((item) => item.previousVersion === previous) ? previous : undefined,
    };
  } catch {
    return;
  }
}
