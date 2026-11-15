import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { workspaceForToken, workspacesForBrowserSession } from '../app/workspace-store.ts';

const digest = (name) => createHash('sha256').update(name).digest();
const alpha = 'f5dc25e7-0fde-46cd-9f9d-a4d1de88829a';
const beta = '15a8c735-2693-4454-a350-df2d97844116';
const noRepositories = '40b43e31-57e4-44ae-ab4e-afc71380d3a2';

test('workspace credentials see only connected repositories and respect expiry and revocation', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(await readFile(new URL('../db/001-workspaces.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO semverge_workspaces VALUES ($1, $2), ($3, $4), ($5, $6)', [alpha, 'Alpha', beta, 'Beta', noRepositories, 'Empty']);
  await db.query(`
    INSERT INTO semverge_workspace_repositories VALUES
      ($1, 42, 81, 'alpha/service', 'semverge/release'),
      ($2, 99, 82, 'beta/internal', 'releases/stable')
  `, [alpha, beta]);
  await db.query(`
    INSERT INTO semverge_mcp_credentials VALUES
      ($1, $6, now() + interval '1 day', null),
      ($2, $7, now() + interval '1 day', null),
      ($3, $6, now() - interval '1 day', null),
      ($4, $6, now() + interval '1 day', now()),
      ($5, $8, now() + interval '1 day', null)
  `, ['alpha', 'beta', 'expired', 'revoked', 'empty'].map(digest).concat([alpha, beta, noRepositories]));

  const lookup = (token) => workspaceForToken((sql, values) => db.query(sql, values), digest(token));
  assert.deepEqual(await lookup('alpha'), {
    name: 'Alpha', repositories: [{ name: 'alpha/service', repositoryId: 42, installationId: 81, releaseBranch: 'semverge/release' }],
  });
  assert.deepEqual(await lookup('beta'), {
    name: 'Beta', repositories: [{ name: 'beta/internal', repositoryId: 99, installationId: 82, releaseBranch: 'releases/stable' }],
  });
  assert.deepEqual(await lookup('empty'), { name: 'Empty', repositories: [] });
  for (const token of ['expired', 'revoked', 'unknown']) assert.equal(await lookup(token), null);
});


test('browser sessions recheck membership and never read another workspace', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const migration of ['001-workspaces', '002-browser-access', '003-repository-connections']) {
    await db.exec(await readFile(new URL(`../db/${migration}.sql`, import.meta.url), 'utf8'));
  }
  await db.query('INSERT INTO semverge_workspaces VALUES ($1, $2), ($3, $4)', [alpha, 'Alpha', beta, 'Beta']);
  await db.query('INSERT INTO semverge_workspace_installations VALUES ($1, 81), ($2, 82)', [alpha, beta]);
  await db.query(`
    INSERT INTO semverge_workspace_repositories VALUES
      ($1, 42, 81, 'alpha/service', 'semverge/release'),
      ($2, 99, 82, 'beta/internal', 'releases/stable')
  `, [alpha, beta]);
  await db.query('INSERT INTO semverge_workspace_members (workspace_id, github_user_id) VALUES ($1, 111), ($2, 222)', [alpha, beta]);
  await db.query(`
    INSERT INTO semverge_browser_sessions VALUES
      ($1, 111, now() + interval '1 hour'),
      ($2, 222, now() + interval '1 hour'),
      ($3, 111, now() - interval '1 hour')
  `, ['alpha-browser', 'beta-browser', 'expired-browser'].map(digest));
  const lookup = (token) => workspacesForBrowserSession((sql, values) => db.query(sql, values), digest(token));
  assert.deepEqual((await lookup('alpha-browser')).map(({ id, repositories }) => [id, repositories.map(({ name }) => name)]), [[alpha, ['alpha/service']]]);
  assert.deepEqual((await lookup('beta-browser')).map(({ id }) => id), [beta]);
  assert.deepEqual(await lookup('expired-browser'), []);
  assert.deepEqual(await lookup('random'), []);
  await db.query('DELETE FROM semverge_workspace_members WHERE workspace_id = $1 AND github_user_id = 111', [alpha]);
  assert.deepEqual(await lookup('alpha-browser'), []);
});
