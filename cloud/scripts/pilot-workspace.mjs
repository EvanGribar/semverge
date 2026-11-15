export async function provisionPilot(client, setup) {
  const { id, name, githubUserId, installationId, digest } = setup;
  await client.query('BEGIN');
  try {
    await client.query(`
      INSERT INTO semverge_workspaces (id, name) VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
    `, [id, name]);
    const workspace = await client.query('SELECT name FROM semverge_workspaces WHERE id = $1 FOR UPDATE', [id]);
    if (workspace.rows[0]?.name !== name) throw new Error('Workspace ID is already in use.');

    const membership = await client.query(`
      INSERT INTO semverge_workspace_members (workspace_id, github_user_id, can_connect_repositories)
      VALUES ($1, $2, true)
      ON CONFLICT (workspace_id, github_user_id) DO NOTHING
      RETURNING workspace_id
    `, [id, githubUserId]);
    if (!membership.rows.length) {
      const existing = await client.query(`
        SELECT can_connect_repositories FROM semverge_workspace_members
         WHERE workspace_id = $1 AND github_user_id = $2
      `, [id, githubUserId]);
      if (!existing.rows[0]?.can_connect_repositories) throw new Error('Existing workspace member cannot connect repositories.');
    }

    await client.query(`
      INSERT INTO semverge_workspace_installations (workspace_id, github_installation_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `, [id, installationId]);

    await client.query(`
      INSERT INTO semverge_mcp_credentials (token_sha256, workspace_id, expires_at)
      VALUES ($1, $2, now() + interval '7 days')
      ON CONFLICT (token_sha256) DO NOTHING
    `, [digest, id]);
    const credential = await client.query(`
      SELECT workspace_id, expires_at, (revoked_at IS NULL AND expires_at > now()) AS active
        FROM semverge_mcp_credentials WHERE token_sha256 = $1
    `, [digest]);
    if (credential.rows[0]?.workspace_id !== id || !credential.rows[0].active) {
      throw new Error('MCP credential is already assigned, expired, or revoked.');
    }
    await client.query('COMMIT');
    return credential.rows[0].expires_at;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
