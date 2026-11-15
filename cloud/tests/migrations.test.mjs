import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../scripts/migrations.mjs';

test('applies pending workspace migrations once and rejects changes to applied history', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  // node-postgres uses the simple query protocol for statements without bindings.
  const client = {
    query: (statement, values) => values ? db.query(statement, values)
      : db.exec(statement).then((results) => results.at(-1)),
  };
  assert.deepEqual(await migrate(client), [
    '001-workspaces.sql', '002-browser-access.sql', '003-repository-connections.sql',
  ]);
  assert.deepEqual(await migrate(client), []);
  const schema = await db.query("SELECT to_regclass('semverge_workspace_installations') AS installations");
  assert.equal(schema.rows[0].installations, 'semverge_workspace_installations');
  await db.query("UPDATE semverge_schema_migrations SET sha256 = 'changed' WHERE name = '001-workspaces.sql'");
  await assert.rejects(migrate(client), /Applied migration 001-workspaces.sql does not match/);
  assert.equal((await db.query('SELECT count(*)::int AS total FROM semverge_schema_migrations')).rows[0].total, 3);
});
