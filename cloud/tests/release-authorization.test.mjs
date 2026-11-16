import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { evaluateReleaseAuthorization } from '../app/release-authorization.ts';
import { evidenceWorkflow } from '../app/commit-evidence.ts';
import { migrate } from '../scripts/migrations.mjs';

const workspaceId = randomUUID();
const candidateSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const configBlob = 'c'.repeat(40);
const name = 'team/service';
const branch = 'release/stable';
const request = {
  repositoryId: 42, candidateSha, teamId: 'team_example', projectId: 'prj_example',
  deploymentId: 'dpl_example', environment: 'production', operation: 'promote-preview',
};
const workflow = Buffer.from((await readFile(new URL('../../' + evidenceWorkflow, import.meta.url), 'utf8')).replaceAll('\r\n', '\n'));
const workflowBlob = createHash('sha1').update('blob ' + workflow.length + '\0').update(workflow).digest('hex');

test('evaluates promotion eligibility against durable authority and fresh provider reads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'semverge-authorization-'));
  let db = new PGlite(directory);
  t.after(async () => {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await migrate({ query: (sql, values) => values ? db.query(sql, values) : db.exec(sql).then((results) => results.at(-1)) });
  await db.query('INSERT INTO semverge_workspaces VALUES ($1, $2)', [workspaceId, 'Fixture']);
  await db.query('INSERT INTO semverge_workspace_installations VALUES ($1, 81)', [workspaceId]);
  await db.query('INSERT INTO semverge_workspace_repositories VALUES ($1, 42, 81, $2, $3)', [workspaceId, name, branch]);

  const now = Date.now();
  const evaluatedAt = new Date(now - 60_000).toISOString();
  async function seed({
    id = randomUUID(), decision = 'approve', evidenceAt = evaluatedAt, expiresAt = new Date(now + 3_600_000),
  } = {}) {
    await db.query(`
      INSERT INTO semverge_release_authorizations (
        id, workspace_id, github_repository_id, release_branch, commit_sha, workflow_blob, config_blob,
        run_id, run_attempt, evidence_at, team_id, project_id, preview_deployment_id, environment,
        operation, approver_github_id, decision, issued_at, expires_at
      ) VALUES ($1, $2, 42, $3, $4, $5, $6, 56, 2, $7, 'team_example', 'prj_example', 'dpl_example',
                'production', 'promote-preview', 81, $8, $9, $10)
    `, [id, workspaceId, branch, candidateSha, workflowBlob, configBlob, evidenceAt, decision, new Date(now - 30_000), expiresAt]);
    return id;
  }

  const terminalSql = 'INSERT INTO semverge_release_authorization_terminal (authorization_id, event) VALUES ($1, $2)';
  const authorizationId = await seed();
  function evaluate({
    id = authorizationId, workspace = workspaceId, overrides = {}, head = candidateSha, laterHead = head,
    attempt = 2, conclusion = 'success', missing = false, source = candidateSha, target = null, onDeployment,
    policyConfig = configBlob, evidenceTime = evaluatedAt,
    query = (sql, values) => db.query(sql, values),
  } = {}) {
    const run = {
      id: 56, run_attempt: attempt, head_sha: candidateSha, head_branch: branch, path: evidenceWorkflow,
      event: 'push', status: 'completed', conclusion, updated_at: evidenceTime,
      repository: { id: 42 }, head_repository: { id: 42 },
    };
    let headReads = 0;
    return evaluateReleaseAuthorization(workspace, { ...request, authorizationId: id, ...overrides }, {
      query,
      repository: { name, releaseBranch: branch, async read(path, _signal, fresh) {
        assert.equal(fresh, true);
        if (path === './') return { id: 42, full_name: name };
        if (path === 'commits/' + source) return { sha: source };
        if (path === 'branches/release%2Fstable') return { name: branch, commit: { sha: headReads++ ? laterHead : head } };
        if (path.startsWith('actions/workflows/')) return { workflow_runs: missing ? [] : [run] };
        if (path === 'contents/' + evidenceWorkflow + '?ref=' + candidateSha) return { type: 'file', sha: workflowBlob };
        if (path === 'contents/.semverge.yml?ref=' + candidateSha) return { type: 'file', sha: policyConfig };
        if (path === 'actions/runs/56') return run;
        if (path === `actions/runs/56/attempts/${attempt}/jobs?per_page=2`) return { jobs: [{
          name: 'SemVerge evidence v1', run_id: 56, head_sha: candidateSha, conclusion, status: 'completed',
          steps: ['Verify release engine', 'Validate release configuration'].map((name) => ({ name, status: 'completed', conclusion })),
        }] };
        assert.fail('Unexpected GitHub read ' + path);
      } },
      async readDeployment(teamId, deploymentId) {
        assert.equal(teamId, request.teamId);
        assert.equal(deploymentId, request.deploymentId);
        await onDeployment?.();
        return {
          id: deploymentId, projectId: request.projectId, teamId, readyState: 'READY', target,
          source: 'git', gitSource: { type: 'github', repoId: 42, sha: source },
        };
      },
    });
  }

  await t.test('approval survives a database restart and the evaluator performs only reads', async () => {
    await db.close();
    db = new PGlite(directory);
    await db.exec(`
      CREATE ROLE fixture_evaluator;
      GRANT SELECT ON semverge_release_authorizations, semverge_release_authorization_terminal,
        semverge_workspace_repositories TO fixture_evaluator;
      SET ROLE fixture_evaluator;
    `);
    try {
      assert.deepEqual(await evaluate(), { allowed: true, reason: 'approved' });
      assert.deepEqual(await evaluate(), { allowed: true, reason: 'approved' });
      await assert.rejects(db.query(terminalSql, [authorizationId, 'consumed']), { code: '42501' });
      await assert.rejects(db.query('UPDATE semverge_release_authorizations SET decision = $1', ['approve']), { code: '42501' });
    } finally {
      await db.exec('RESET ROLE');
    }
  });

  await t.test('only the exact authorized scope can qualify', async () => {
    for (const overrides of [
      { candidateSha: nextSha }, { repositoryId: 43 }, { teamId: 'team_other' },
      { projectId: 'prj_other' }, { deploymentId: 'dpl_other' },
    ]) assert.equal((await evaluate({ overrides })).reason, 'authorization-not-found');
    for (const overrides of [{ environment: 'preview' }, { operation: 'deploy' }, { approval: true }]) {
      assert.equal((await evaluate({ overrides })).reason, 'invalid-request');
    }
    assert.equal((await evaluate({ workspace: randomUUID() })).reason, 'authorization-not-found');
    assert.equal((await evaluate({ id: randomUUID() })).reason, 'authorization-not-found');
  });

  await t.test('blocks a moved branch and rejects changed or unavailable evidence', async () => {
    for (const [overrides, reason] of [
      [{ head: nextSha }, 'candidate-changed'],
      [{ laterHead: nextSha }, 'candidate-changed'],
      [{ attempt: 3 }, 'evidence-stale'],
      [{ policyConfig: nextSha }, 'evidence-stale'],
      [{ evidenceTime: new Date(now - 61_000).toISOString() }, 'evidence-stale'],
      [{ missing: true }, 'evidence-unavailable'],
      [{ onDeployment: () => Promise.reject(new Error('Vercel offline')) }, 'evidence-unavailable'],
      [{ conclusion: 'failure' }, 'ci-failed'],
      [{ target: 'production' }, 'preview-mismatch'],
      [{ source: nextSha }, 'preview-mismatch'],
      [{ query: () => Promise.reject(new Error('database offline')) }, 'authority-unavailable'],
    ]) assert.deepEqual(await evaluate(overrides), { allowed: false, reason });
  });

  await t.test('denies expired, revoked, consumed and explicitly denied authorizations', async () => {
    assert.equal((await evaluate({ id: await seed({ decision: 'deny' }) })).reason, 'denied');
    assert.equal((await evaluate({ id: await seed({ expiresAt: new Date(now - 1000) }) })).reason, 'expired');
    assert.equal((await evaluate({ id: await seed({ evidenceAt: new Date(now - 8 * 86_400_000) }) })).reason, 'evidence-stale');
    const revoked = await seed();
    assert.equal((await evaluate({ id: revoked, onDeployment: () => db.query(terminalSql, [revoked, 'revoked']) })).reason, 'revoked');
    const consumed = await seed();
    await db.query(terminalSql, [consumed, 'consumed']);
    await assert.rejects(seed({ id: consumed }), { code: '23505' });
    await assert.rejects(db.query(terminalSql, [consumed, 'consumed']), { code: '23505' });
    await db.close();
    db = new PGlite(directory);
    assert.equal((await evaluate({ id: consumed })).reason, 'already-consumed');
    await db.query('DELETE FROM semverge_workspace_repositories WHERE workspace_id = $1', [workspaceId]);
    assert.equal((await evaluate()).reason, 'authorization-not-found');
  });
});
