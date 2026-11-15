import type { RepositoryBinding } from './github-repository';

export type RepositoryRequest = {
  workspaceId: string;
  name: string;
  releaseBranch: string;
};

export function parseRepositoryRequest(value: unknown): RepositoryRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { workspaceId, name, releaseBranch } = value as Partial<RepositoryRequest>;
  if (typeof workspaceId !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(workspaceId) ||
    typeof name !== 'string' || name.length > 140 || !/^[a-z\d-]+\/[a-z\d_.-]+$/i.test(name) ||
    name.split('/').some((part) => part === '.' || part === '..') ||
    typeof releaseBranch !== 'string' || releaseBranch.length > 200 || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(releaseBranch) ||
    releaseBranch.includes('..') || releaseBranch.endsWith('.') ||
    releaseBranch.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) return null;
  return { workspaceId, name, releaseBranch };
}

type Query = (sql: string, args: unknown[]) => Promise<{ rowCount: number | null }>;

export async function bindRepository(
  query: Query, sessionDigest: Buffer, userId: number, workspaceId: string, binding: RepositoryBinding,
) {
  const result = await query(`
    INSERT INTO semverge_workspace_repositories
      (workspace_id, github_repository_id, github_installation_id, full_name, release_branch)
    SELECT m.workspace_id, $4::bigint, i.github_installation_id, $6, $7
      FROM semverge_browser_sessions s
      JOIN semverge_workspace_members m ON m.github_user_id = s.github_user_id
      JOIN semverge_workspace_installations i ON i.workspace_id = m.workspace_id
     WHERE s.token_sha256 = $1 AND s.expires_at > now() AND s.github_user_id = $2::bigint
       AND m.workspace_id = $3::uuid AND m.can_connect_repositories
       AND i.github_installation_id = $5::bigint
    ON CONFLICT DO NOTHING
  `, [sessionDigest, userId, workspaceId, binding.repositoryId, binding.installationId, binding.name, binding.releaseBranch]);
  return result.rowCount === 1;
}
