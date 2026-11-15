import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const migrations = new URL('../db/', import.meta.url);

export async function migrate(client) {
  const names = (await readdir(migrations)).filter((name) => /^\d{3}-[a-z-]+\.sql$/.test(name)).sort();
  const files = await Promise.all(names.map(async (name) => {
    const source = (await readFile(new URL(name, migrations), 'utf8')).replace(/\r\n/g, '\n').trim();
    const sql = source.match(/^BEGIN;\s+([\s\S]+)\s+COMMIT;$/)?.[1];
    if (!sql) throw new Error(`Expected a transaction wrapper in ${name}.`);
    return { name, sql, digest: createHash('sha256').update(source).digest('hex') };
  }));

  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL lock_timeout = \'10s\'');
    await client.query('SET LOCAL search_path TO public');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('semverge-cloud/migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS semverge_schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query('SELECT name, sha256 FROM semverge_schema_migrations');
    const applied = new Map(rows.map(({ name, sha256 }) => [name, sha256]));

    for (const [name, digest] of applied) {
      if (files.find((file) => file.name === name)?.digest !== digest) {
        throw new Error(`Applied migration ${name} does not match the local migration file.`);
      }
    }

    const pending = files.filter(({ name }) => !applied.has(name));
    for (const { name, sql, digest } of pending) {
      await client.query(sql);
      await client.query('INSERT INTO semverge_schema_migrations (name, sha256) VALUES ($1, $2)', [name, digest]);
    }
    await client.query('COMMIT');
    return pending.map(({ name }) => name);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
