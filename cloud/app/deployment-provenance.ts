// Provider observations are point-in-time; they carry no authority to ship.
export type DeploymentTarget = {
  repository: string;
  repositoryId: string;
  teamId: string;
  projectId: string;
  deploymentId: string;
  candidateSha?: string;
};

export type ProvenanceReaders = {
  deployment(id: string): Promise<unknown>;
  repository(): Promise<unknown>;
  commit(sha: string): Promise<unknown>;
};

const sha = /^[a-f0-9]{40}$/;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const id = (value: unknown) =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : null;

export function validateTarget(target: DeploymentTarget) {
  if (!/^[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(target.repository) ||
    target.repository.split('/').some((part) => part === '.' || part === '..') ||
    !/^[1-9][0-9]*$/.test(target.repositoryId) || !/^team_[a-z0-9]+$/i.test(target.teamId) ||
    !/^prj_[a-z0-9]+$/i.test(target.projectId) || !/^dpl_[a-z0-9]+$/i.test(target.deploymentId) ||
    (target.candidateSha !== undefined && !sha.test(target.candidateSha))) {
    throw new Error('Expected a GitHub repository, numeric repository ID, Vercel team/project/deployment IDs, and optional full candidate SHA.');
  }
}

export async function observeDeployment(target: DeploymentTarget, readers: ProvenanceReaders) {
  validateTarget(target);
  const startedAt = new Date().toISOString();
  const evidence = {
    target, startedAt,
    source: { deployment: 'vercel-deployment-api', repository: 'github-repository-and-commit-api' },
    routing: 'not-checked', health: 'not-checked',
  } as const;
  const unavailable = (reason: string) => ({
    ...evidence, observedAt: new Date().toISOString(), status: 'unavailable' as const, reason, deployedSha: null,
  });

  try {
    const deployment = record(await readers.deployment(target.deploymentId));
    const project = record(deployment.project);
    if (deployment.id !== target.deploymentId ||
      (deployment.projectId ?? project.id) !== target.projectId ||
      (project.id != null && project.id !== target.projectId) ||
      (deployment.teamId != null && deployment.teamId !== target.teamId)) {
      return unavailable('deployment-scope-mismatch');
    }
    if (deployment.readyState !== 'READY') return unavailable('deployment-not-ready');

    // A CLI or upload can attach Git-looking deployment metadata. Never use meta.git*.
    const git = record(deployment.gitSource);
    if (deployment.source !== 'git' || git.type !== 'github' ||
      typeof git.sha !== 'string' || !sha.test(git.sha) || id(git.repoId) === null) {
      return unavailable('github-source-unavailable');
    }
    if (id(git.repoId) !== target.repositoryId) return unavailable('source-repository-mismatch');

    const repository = record(await readers.repository());
    if (id(repository.id) !== target.repositoryId || typeof repository.full_name !== 'string' ||
      repository.full_name.toLowerCase() !== target.repository.toLowerCase()) {
      return unavailable('github-repository-mismatch');
    }
    const commit = record(await readers.commit(git.sha));
    if (commit.sha !== git.sha) return unavailable('github-commit-mismatch');
    const environment = deployment.target === 'production' ? 'production-target' :
      deployment.target === null && deployment.customEnvironment == null && deployment.customEnvironmentId == null ?
        'preview' : 'unclassified';

    return {
      ...evidence, observedAt: new Date().toISOString(), status: 'identified' as const, deployedSha: git.sha, environment,
      candidateMatch: target.candidateSha === undefined ? 'not-requested' as const :
        target.candidateSha === git.sha ? 'match' as const : 'mismatch' as const,
    };
  } catch {
    return unavailable('provider-read-unavailable');
  }
}
