import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bindRepository, parseRepositoryRequest } from '../app/repository-connections.ts';

const workspace = 'f5dc25e7-0fde-46cd-9f9d-a4d1de88829a';
const other = '15a8c735-2693-4454-a350-df2d97844116';

test('connection inputs require repository and branch paths', () => {
  const valid = { workspaceId: workspace, name: 'team/service', releaseBranch: 'semverge/release' };
  assert.deepEqual(parseRepositoryRequest(valid), valid);
  assert.equal(parseRepositoryRequest({ ...valid, name: 'team/..' }), null);
  assert.equal(parseRepositoryRequest({ ...valid, releaseBranch: 'semverge/../release' }), null);
  assert.equal(parseRepositoryRequest({ ...valid, releaseBranch: 'main.lock' }), null);
});

test('connection writes require the same active admin session and an installation approved for the workspace', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const migration of ['001-workspaces', '002-browser-access', '003-repository-connections']) {
    await db.exec(await readFile(new URL(`../db/${migration}.sql`, import.meta.url), 'utf8'));
  }
  await db.query('INSERT INTO semverge_workspaces VALUES ($1, $2), ($3, $4)', [workspace, 'Team', other, 'Other']);
  await db.query('INSERT INTO semverge_workspace_installations VALUES ($1, 81), ($2, 82)', [workspace, other]);
  await db.query('INSERT INTO semverge_workspace_members VALUES ($1, 111, true), ($1, 222, false)', [workspace]);
  const adminToken = createHash('sha256').update('admin').digest();
  const memberToken = createHash('sha256').update('member').digest();
  await db.query("INSERT INTO semverge_browser_sessions VALUES ($1, 111, now() + interval '1 hour'), ($2, 222, now() + interval '1 hour')", [adminToken, memberToken]);
  const query = (sql, args) => db.query(sql, args).then((value) => ({ rowCount: value.affectedRows }));
  const binding = { repositoryId: 42, installationId: 81, name: 'team/service', releaseBranch: 'semverge/release' };
  assert.equal(await bindRepository(query, memberToken, 222, workspace, binding), false);
  assert.equal(await bindRepository(query, adminToken, 222, workspace, binding), false);
  assert.equal(await bindRepository(query, adminToken, 111, other, binding), false);
  assert.equal(await bindRepository(query, adminToken, 111, workspace, { ...binding, installationId: 82 }), false);
  assert.equal(await bindRepository(query, adminToken, 111, workspace, binding), true);
  assert.equal(await bindRepository(query, adminToken, 111, workspace, binding), false);
  await db.query('DELETE FROM semverge_workspace_installations WHERE workspace_id = $1 AND github_installation_id = 81', [workspace]);
  assert.deepEqual((await db.query('SELECT * FROM semverge_workspace_repositories')).rows, []);
});
