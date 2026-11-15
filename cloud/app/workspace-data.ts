import snapshot from './public-release.json';
import { installationRepository, publicRepository, type GitHubRepository, type RepositoryBinding } from './github-repository';
import { githubQueue } from './github-queue';
import { githubReleases } from './github-releases';
import { publicRelease } from './release-data';

export function loadQueue(repository: GitHubRepository = publicRepository) {
  return githubQueue(repository);
}

export function loadReleaseHistory(repository: GitHubRepository = publicRepository, includeTechnical = true) {
  return githubReleases(repository, repository === publicRepository ? publicRelease(snapshot) : undefined, includeTechnical);
}

export function connectedRepository(binding: RepositoryBinding, signal: AbortSignal) {
  return installationRepository(binding, {
    appId: process.env.SEMVERGE_GITHUB_APP_ID ?? '',
    privateKey: process.env.SEMVERGE_GITHUB_APP_PRIVATE_KEY ?? '',
  }, signal);
}
