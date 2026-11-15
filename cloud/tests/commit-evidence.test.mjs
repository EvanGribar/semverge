import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { currentCommitEvidence, evidenceWorkflow } from '../app/commit-evidence.ts';

const workflow = Buffer.from(readFileSync(new URL('../../' + evidenceWorkflow, import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
const workflowBlob = createHash('sha1').update('blob ' + workflow.length + '\0').update(workflow).digest('hex');
const commit = 'a'.repeat(40);
const nextCommit = 'b'.repeat(40);
const configBlob = 'c'.repeat(40);
const name = 'team/service';
const branch = 'semverge/release';
const now = Date.parse('2026-11-15T12:05:00Z');
const evaluatedAt = '2026-11-15T12:00:00Z';

function fixture(change) {
  const run = {
    id: 56, run_attempt: 2, head_sha: commit, head_branch: branch, path: evidenceWorkflow + '@' + branch,
    event: 'push', status: 'completed', conclusion: 'success', updated_at: evaluatedAt, repository: { id: 42 }, head_repository: { id: 42 },
  };
  const job = {
    name: 'SemVerge evidence v1', run_id: 56, head_sha: commit, status: 'completed', conclusion: 'success',
    steps: ['Verify release engine', 'Validate release configuration'].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
  };
  const data = {
    head: commit, endHead: undefined, run, job, latestRun: run, workflowBlob, runs: [run], denied: false,
  };
  change?.(data);
  let headReads = 0;
  return { name, releaseBranch: branch, async read(path, _signal, fresh) {
    assert.equal(fresh, true);
    if (path === './') return { id: 42, full_name: name };
    if (path === 'branches/semverge%2Frelease') return { name: branch, commit: { sha: (++headReads > 1 && data.endHead) || data.head } };
    if (path.startsWith('actions/workflows/')) {
      if (data.denied) throw new Error('GitHub returned 403.');
      const query = new URL(path, 'https://example.com').searchParams;
      assert.equal(query.get('branch'), branch);
      assert.equal(query.get('head_sha'), data.head);
      return { workflow_runs: data.runs };
    }
    if (path === 'contents/' + evidenceWorkflow + '?ref=' + data.head) return { type: 'file', sha: data.workflowBlob };
    if (path === 'contents/.semverge.yml?ref=' + data.head) return { type: 'file', sha: configBlob };
    if (path === 'actions/runs/56/attempts/2/jobs?per_page=2') return { jobs: [data.job] };
    if (path === 'actions/runs/56') return data.latestRun;
    assert.fail('Unexpected request: ' + path);
  } };
}

test('returns the versioned result for an exact, current commit', async () => {
  const result = await currentCommitEvidence(fixture(), commit, now);
  assert.equal(result.status, 'recorded', JSON.stringify(result));
  assert.deepEqual(result.evidence, {
    schemaVersion: 1, repository: { id: 42, name }, branch, commit,
    policy: { configBlob, workflowBlob },
    evaluatedAt: new Date(evaluatedAt).toISOString(),
    provenance: { source: 'github-actions-api', runId: 56, attempt: 2, url: 'https://github.com/team/service/actions/runs/56/attempts/2' },
    result: 'passed', explanation: 'Release engine verification and configuration validation passed in CI.',
  });
});

test('preserves a failed verification and identifies the failed check', async () => {
  const result = await currentCommitEvidence(fixture(({ run, job }) => {
    run.conclusion = job.conclusion = job.steps[0].conclusion = 'failure';
  }), commit, now);
  assert.equal(result.evidence?.result, 'failed', JSON.stringify(result));
  assert.match(result.evidence.explanation, /Verify release engine failed/);
});

for (const [label, change, requested, reason] of [
  ['old requested SHA', (f) => { f.head = nextCommit; }, commit, /not the current/],
  ['head moves during retrieval', (f) => { f.endHead = nextCommit; }, commit, /changed/],
  ['another commit', ({ run }) => { run.head_sha = nextCommit; }, undefined, /does not match/],
  ['another repository', ({ run }) => { run.head_repository.id = 43; }, commit, /does not match/],
  ['changed workflow', (f) => { f.workflowBlob = nextCommit; }, commit, /not trusted/],
  ['missing evidence for new head', (f) => { f.head = nextCommit; f.runs = []; }, undefined, /No evidence run/],
  ['malformed job', ({ job }) => { job.steps = null; }, commit, /job results/],
  ['skipped verification', ({ job }) => { job.steps[0].conclusion = 'skipped'; }, commit, /did not report success/],
  ['stale run', ({ run }) => { run.updated_at = '2026-11-01T12:00:00Z'; }, commit, /stale/],
  ['pending rerun', ({ run }) => { run.status = 'in_progress'; }, commit, /no completed/],
  ['rerun race', (f) => { f.latestRun = { ...f.run, run_attempt: 3 }; }, commit, /changed/],
  ['credential denied', (f) => { f.denied = true; }, commit, /could not be read/],
]) {
  test('does not expose evidence for ' + label, async () => {
    const result = await currentCommitEvidence(fixture(change), requested, now);
    assert.equal(result.status, 'unavailable', JSON.stringify(result));
    assert.match(result.reason, reason);
    assert.equal(result.evidence, undefined);
  });
}
