import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../scripts/migrations.mjs';
import { provisionPilot } from '../scripts/pilot-workspace.mjs';

test('pilot setup preserves expiry and rolls back if its credential belongs to another workspace', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const client = {
    query: (statement, values) => values ? db.query(statement, values)
      : db.exec(statement).then((results) => results.at(-1)),
  };
  await migrate(client);
  const fixture = {
    id: 'f5dc25e7-0fde-46cd-9f9d-a4d1de88829a', name: 'Pilot',
    githubUserId: 111, installationId: 81, digest: createHash('sha256').update('fixture').digest(),
  };
  const expiry = await provisionPilot(client, fixture);
  assert.deepEqual(await provisionPilot(client, fixture), expiry);
  const other = '15a8c735-2693-4454-a350-df2d97844116';
  await assert.rejects(provisionPilot(client, { ...fixture, id: other }), /already assigned/);
  assert.deepEqual((await db.query('SELECT id FROM semverge_workspaces')).rows, [{ id: fixture.id }]);
  await db.query('UPDATE semverge_mcp_credentials SET revoked_at = now()');
  await assert.rejects(provisionPilot(client, fixture), /revoked/);
});
