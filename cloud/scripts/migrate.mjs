import { Client } from 'pg';
import { migrate } from './migrations.mjs';

const connectionString = process.env.SEMVERGE_MIGRATION_DATABASE_URL;
if (!connectionString) {
  console.error('Set SEMVERGE_MIGRATION_DATABASE_URL to the direct connection for the intended Cloud database.');
  process.exitCode = 1;
} else {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const applied = await migrate(client);
    console.log(applied.length ? `Applied ${applied.join(', ')}.` : 'No pending migrations.');
  } catch (error) {
    // Connection failures can include provider details. Keep output limited to safe diagnostics.
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : '';
    console.error(`SemVerge Cloud migration failed${code}. Check the target connection and migration history.`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
