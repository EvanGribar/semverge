import snapshot from './public-release.json';
import { installationRepository, publicRepository, type GitHubRepository, type RepositoryBinding } from './github-repository';
import { githubQueue } from './github-queue';
import { githubReleases } from './github-releases';
import { publicRelease } from './release-data';
import { currentCommitEvidence, type EvidenceResult } from './commit-evidence';

export function loadQueue(repository: GitHubRepository = publicRepository) {
  return githubQueue(repository);
}

export function loadReleaseHistory(repository: GitHubRepository = publicRepository, includeTechnical = true) {
  return githubReleases(repository, repository === publicRepository ? publicRelease(snapshot) : undefined, includeTechnical);
}

export function connectedRepository(binding: RepositoryBinding, signal: AbortSignal, actions = false) {
  return installationRepository(binding, {
    appId: process.env.SEMVERGE_GITHUB_APP_ID ?? '',
    privateKey: process.env.SEMVERGE_GITHUB_APP_PRIVATE_KEY ?? '',
  }, signal, actions);
}

export async function loadCommitEvidence(binding?: RepositoryBinding, commit?: string): Promise<EvidenceResult> {
  try {
    const repo = binding ? await connectedRepository(binding, AbortSignal.timeout(5000), true) : publicRepository;
    return await currentCommitEvidence(repo, commit);
  } catch {
    return { status: 'unavailable', reason: 'GitHub Actions access is unavailable for this repository.' };
  }
}
