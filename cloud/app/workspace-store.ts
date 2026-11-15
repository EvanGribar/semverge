import { Pool } from 'pg';
import { bindRepository } from './repository-connections.ts';
import type { RepositoryBinding } from './github-repository';

type ScopedWorkspace = {
  name: string;
  repositories: RepositoryBinding[];
};

type WorkspaceRow = {
  name: string;
  repository_id: string | null;
  installation_id: string | null;
  full_name: string | null;
  release_branch: string | null;
};

type Query = (text: string, values: unknown[]) => Promise<{ rows: WorkspaceRow[] }>;

const workspaceForTokenSql = `
  SELECT w.name,
         r.github_repository_id::text AS repository_id,
         r.github_installation_id::text AS installation_id,
         r.full_name, r.release_branch
    FROM semverge_mcp_credentials c
    JOIN semverge_workspaces w ON w.id = c.workspace_id
    LEFT JOIN semverge_workspace_repositories r ON r.workspace_id = w.id
   WHERE c.token_sha256 = $1 AND c.revoked_at IS NULL AND c.expires_at > now()
   ORDER BY lower(r.full_name)
`;

function repositoryForRow(row: WorkspaceRow): RepositoryBinding | null {
  if (!row.repository_id || !row.installation_id || !row.full_name || !row.release_branch) return null;
  return { name: row.full_name, repositoryId: Number(row.repository_id), installationId: Number(row.installation_id), releaseBranch: row.release_branch };
}

export async function workspaceForToken(query: Query, digest: Buffer): Promise<ScopedWorkspace | null> {
  const { rows } = await query(workspaceForTokenSql, [digest]);
  if (!rows.length) return null;
  const repositories = rows.map(repositoryForRow).filter((repository) => repository !== null);
  return { name: rows[0].name, repositories };
}

let pool: Pool | undefined;

function workspacePool() {
  pool ??= new Pool({
    connectionString: process.env.SEMVERGE_DATABASE_URL,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });
  return pool;
}

export function configuredWorkspaceForToken(digest: Buffer) {
  const db = workspacePool();
  return workspaceForToken((text, values) => db.query<WorkspaceRow>(text, values), digest);
}

export async function createBrowserSession(userId: number, digest: Buffer, expiresIn: number) {
  const response = await workspacePool().query(`
    INSERT INTO semverge_browser_sessions (token_sha256, github_user_id, expires_at)
    SELECT $1, $2::bigint, now() + $3::integer * interval '1 second'
     WHERE EXISTS (SELECT 1 FROM semverge_workspace_members WHERE github_user_id = $2::bigint)
  `, [digest, userId, expiresIn]);
  return response.rowCount === 1;
}

export async function deleteBrowserSession(digest: Buffer) {
  await workspacePool().query('DELETE FROM semverge_browser_sessions WHERE token_sha256 = $1', [digest]);
}

type BrowserWorkspaceRow = WorkspaceRow & { workspace_id: string; can_connect_repositories: boolean };
type BrowserQuery = (text: string, values: unknown[]) => Promise<{ rows: BrowserWorkspaceRow[] }>;

export async function workspacesForBrowserSession(query: BrowserQuery, digest: Buffer) {
  const { rows } = await query(`
    SELECT w.id AS workspace_id, w.name, m.can_connect_repositories,
           r.github_repository_id::text AS repository_id,
           r.github_installation_id::text AS installation_id,
           r.full_name, r.release_branch
      FROM semverge_browser_sessions s
      JOIN semverge_workspace_members m ON m.github_user_id = s.github_user_id
      JOIN semverge_workspaces w ON w.id = m.workspace_id
      LEFT JOIN semverge_workspace_repositories r ON r.workspace_id = w.id
     WHERE s.token_sha256 = $1 AND s.expires_at > now()
     ORDER BY lower(w.name), w.id, lower(r.full_name)
  `, [digest]);
  const workspaces = new Map<string, ScopedWorkspace & { id: string; canConnectRepositories: boolean }>();
  for (const row of rows) {
    let workspace = workspaces.get(row.workspace_id);
    if (!workspace) {
      workspace = { id: row.workspace_id, name: row.name, canConnectRepositories: row.can_connect_repositories, repositories: [] };
      workspaces.set(row.workspace_id, workspace);
    }
    const repository = repositoryForRow(row);
    if (repository) workspace.repositories.push(repository);
  }
  return [...workspaces.values()];
}

export function configuredWorkspacesForSession(digest: Buffer) {
  const db = workspacePool();
  return workspacesForBrowserSession((text, values) => db.query<BrowserWorkspaceRow>(text, values), digest);
}

export function connectWorkspaceRepository(sessionDigest: Buffer, userId: number, workspaceId: string, binding: RepositoryBinding) {
  return bindRepository((text, values) => workspacePool().query(text, values), sessionDigest, userId, workspaceId, binding);
}

