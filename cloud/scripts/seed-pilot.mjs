import { Client } from 'pg';
import { provisionPilot } from './pilot-workspace.mjs';

const {
  SEMVERGE_MIGRATION_DATABASE_URL: connectionString,
  SEMVERGE_PILOT_WORKSPACE_ID: id,
  SEMVERGE_PILOT_WORKSPACE_NAME: name,
  SEMVERGE_PILOT_GITHUB_USER_ID: githubUserId,
  SEMVERGE_PILOT_INSTALLATION_ID: installationId,
  SEMVERGE_PILOT_MCP_TOKEN_SHA256: digest,
} = process.env;

const githubId = (value) => /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validId = typeof id === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id);
if (!connectionString || !validId || !name?.trim() || name.length > 120 ||
    !githubId(githubUserId) || !githubId(installationId) || !/^[a-f\d]{64}$/i.test(digest ?? '')) {
  console.error('Set the direct database URL, workspace ID and name, GitHub user and installation IDs, and MCP token digest.');
  process.exitCode = 1;
} else {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const expiry = await provisionPilot(client, {
      id: id.toLowerCase(), name: name.trim(), githubUserId, installationId, digest: Buffer.from(digest, 'hex'),
    });
    console.log(`Pilot workspace configured. MCP credential expires ${new Date(expiry).toISOString()}.`);
  } catch {
    console.error('Pilot setup failed. Check the database, migration state, existing workspace membership, and MCP credential.');
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
