import assert from 'node:assert/strict';
import test from 'node:test';
import { observeDeployment } from '../app/deployment-provenance.ts';

const sha = 'a'.repeat(40);
const target = {
  repository: 'team/service', repositoryId: '42', teamId: 'team_fixture',
  projectId: 'prj_fixture', deploymentId: 'dpl_fixture', candidateSha: sha,
};

const deployment = {
  id: target.deploymentId, project: { id: target.projectId }, source: 'git',
  target: 'production', readyState: 'READY', gitSource: { type: 'github', repoId: 42, sha },
};
const readers = {
  deployment: async () => deployment,
  repository: async () => ({ id: 42, full_name: target.repository }),
  commit: async (requested) => {
    assert.equal(requested, sha);
    return { sha };
  },
};

test('binds provider Git source to the exact GitHub repository, but does not infer routing or health', async () => {
  const result = await observeDeployment(target, readers);
  assert.equal(result.status, 'identified');
  assert.equal(result.deployedSha, sha);
  assert.equal(result.candidateMatch, 'match');
  assert.equal(result.environment, 'production-target');
  assert.equal(result.routing, 'not-checked');
  assert.equal(result.health, 'not-checked');
  const mismatch = await observeDeployment({ ...target, candidateSha: 'b'.repeat(40) }, readers);
  assert.equal(mismatch.candidateMatch, 'mismatch');
  assert.equal(mismatch.deployedSha, sha);
});

test('rejects metadata-only uploads, mismatched scope, bad commit joins, and provider errors', async () => {
  const scenarios = [
    [{ deployment: async () => ({ ...deployment, source: 'cli', meta: { githubCommitSha: sha } }) }, 'github-source-unavailable'],
    [{ deployment: async () => ({ ...deployment, gitSource: undefined, meta: { githubCommitSha: sha } }) }, 'github-source-unavailable'],
    [{ deployment: async () => ({ ...deployment, project: { id: 'prj_other' } }) }, 'deployment-scope-mismatch'],
    [{ deployment: async () => ({ ...deployment, id: 'dpl_other' }) }, 'deployment-scope-mismatch'],
    [{ deployment: async () => ({ ...deployment, readyState: 'ERROR' }) }, 'deployment-not-ready'],
    [{ deployment: async () => ({ ...deployment, gitSource: { ...deployment.gitSource, repoId: 43 } }) }, 'source-repository-mismatch'],
    [{ repository: async () => ({ id: 43, full_name: target.repository }) }, 'github-repository-mismatch'],
    [{ commit: async () => ({ sha: 'c'.repeat(40) }) }, 'github-commit-mismatch'],
    [{ commit: async () => { throw new Error('rate limited'); } }, 'provider-read-unavailable'],
  ];
  for (const [override, reason] of scenarios) {
    const result = await observeDeployment(target, { ...readers, ...override });
    assert.equal(result.status, 'unavailable', reason);
    assert.equal(result.deployedSha, null, reason);
    assert.equal(result.reason, reason);
  }
});
