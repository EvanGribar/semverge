import type { GitHubRepository } from './github-repository';

export function isRepositoryFile(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024 &&
    path.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..');
}

export async function repositoryFile(repository: GitHubRepository, path: string, commit: string, signal: AbortSignal) {
  if (!isRepositoryFile(path) || !/^[a-f\d]{40}$/i.test(commit)) throw new Error('Invalid repository file reference.');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const file = await repository.read(`contents/${encoded}?ref=${commit}`, signal) as { encoding?: unknown; content?: unknown };
  if (file?.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('Repository file content is unavailable.');
  return {
    content: Buffer.from(file.content, 'base64').toString('utf8'),
    url: `https://github.com/${repository.name}/blob/${commit}/${encoded}`,
  };
}
