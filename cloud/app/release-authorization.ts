import { z } from 'zod';
import { commitEvidenceMaxAgeMs, commitSha, currentCommitEvidence } from './commit-evidence.ts';
import { observeDeployment } from './deployment-provenance.ts';
import type { GitHubRepository } from './github-repository';

const promotionRequest = z.strictObject({
  authorizationId: z.uuid(),
  repositoryId: z.number().int().positive(),
  candidateSha: z.string().regex(commitSha),
  teamId: z.string().regex(/^team_[a-z0-9]+$/i),
  projectId: z.string().regex(/^prj_[a-z0-9]+$/i),
  deploymentId: z.string().regex(/^dpl_[a-z0-9]+$/i),
  environment: z.literal('production'),
  operation: z.literal('promote-preview'),
});

type AuthorizationRow = {
  decision: 'approve' | 'deny';
  terminal_event: 'revoked' | 'consumed' | null;
  issued: boolean;
  expired: boolean;
  evidence_stale: boolean;
  workflow_blob: string;
  config_blob: string;
  run_id: string;
  run_attempt: number;
  evidence_time_matches: boolean | null;
};

type AuthorizationReaders = {
  query(sql: string, values: unknown[]): Promise<{ rows: AuthorizationRow[] }>;
  repository: GitHubRepository;
  // A server-scoped Vercel GET for this team. Always bypass cached and local observations.
  readDeployment(teamId: string, deploymentId: string): Promise<unknown>;
};

type Rejection = 'invalid-request' | 'authorization-not-found' | 'denied' | 'expired' |
  'revoked' | 'already-consumed' | 'candidate-changed' | 'evidence-stale' | 'evidence-unavailable' |
  'ci-failed' | 'preview-mismatch' | 'authority-unavailable';

export type AuthorizationDecision = { allowed: true; reason: 'approved' } |
  { allowed: false; reason: Rejection };

const reject = (reason: Rejection): AuthorizationDecision => ({ allowed: false, reason });

const authorizationSql = `
  SELECT a.decision, t.event AS terminal_event,
         a.issued_at <= statement_timestamp() AS issued,
         a.expires_at <= statement_timestamp() AS expired,
         a.evidence_at < statement_timestamp() - interval '${commitEvidenceMaxAgeMs} milliseconds' AS evidence_stale,
         a.workflow_blob, a.config_blob, a.run_id::text, a.run_attempt,
         a.evidence_at = $12::timestamptz AS evidence_time_matches
    FROM public.semverge_release_authorizations a
    JOIN public.semverge_workspace_repositories r
      ON r.workspace_id = a.workspace_id AND r.github_repository_id = a.github_repository_id
     AND r.release_branch = a.release_branch
    LEFT JOIN public.semverge_release_authorization_terminal t ON t.authorization_id = a.id
   WHERE a.id = $1 AND a.workspace_id = $2 AND a.github_repository_id = $3
     AND a.commit_sha = $4 AND a.team_id = $5 AND a.project_id = $6
     AND a.preview_deployment_id = $7 AND a.environment = $8 AND a.operation = $9
     AND lower(r.full_name) = lower($10) AND a.release_branch = $11
`;

function authorizationRejection(row: AuthorizationRow | undefined): Rejection | null {
  if (!row) return 'authorization-not-found';
  if (row.terminal_event === 'revoked') return 'revoked';
  if (row.terminal_event === 'consumed') return 'already-consumed';
  if (row.terminal_event !== null || row.issued !== true) return 'authority-unavailable';
  if (row.expired !== false) return 'expired';
  if (row.decision !== 'approve') return 'denied';
  if (row.evidence_stale !== false) return 'evidence-stale';
  return null;
}

// workspaceId and readers come from a trusted server context after access checks.
// An allowed result describes eligibility at read time. It does not reserve the authorization.
export async function evaluateReleaseAuthorization(
  workspaceId: string, input: unknown, readers: AuthorizationReaders,
): Promise<AuthorizationDecision> {
  const parsed = promotionRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(workspaceId).success) return reject('invalid-request');
  const request = parsed.data;
  const { repository } = readers;
  const values = [
    request.authorizationId, workspaceId, request.repositoryId, request.candidateSha,
    request.teamId, request.projectId, request.deploymentId, request.environment, request.operation,
    repository.name, repository.releaseBranch,
  ];
  const readAuthorization = async (evidenceAt: string | null) =>
    (await readers.query(authorizationSql, [...values, evidenceAt])).rows[0];

  try {
    const initialRejection = authorizationRejection(await readAuthorization(null));
    if (initialRejection) return reject(initialRejection);

    const preview = await observeDeployment({
      repository: repository.name, repositoryId: String(request.repositoryId),
      teamId: request.teamId, projectId: request.projectId, deploymentId: request.deploymentId,
      candidateSha: request.candidateSha,
    }, {
      deployment: (id) => readers.readDeployment(request.teamId, id),
      repository: () => repository.read('./', AbortSignal.timeout(5000), true),
      commit: (sha) => repository.read('commits/' + sha, AbortSignal.timeout(5000), true),
    });
    if (preview.status !== 'identified') return reject('evidence-unavailable');
    if (preview.environment !== 'preview' || preview.candidateMatch !== 'match') return reject('preview-mismatch');

    const result = await currentCommitEvidence(repository, request.candidateSha);
    if (result.status !== 'recorded') return reject(result.code ?? 'evidence-unavailable');
    const evidence = result.evidence;
    if (evidence.repository.id !== request.repositoryId) return reject('evidence-unavailable');
    if (evidence.result !== 'passed') return reject('ci-failed');

    // Re-read after provider I/O to pick up expiry, revoked access and terminal events.
    const row = await readAuthorization(evidence.evaluatedAt);
    if (!row) return reject('authorization-not-found');
    const rejection = authorizationRejection(row);
    if (rejection) return reject(rejection);
    if (row.workflow_blob !== evidence.policy.workflowBlob || row.config_blob !== evidence.policy.configBlob ||
        row.run_id !== String(evidence.provenance.runId) || row.run_attempt !== evidence.provenance.attempt ||
        row.evidence_time_matches !== true) return reject('evidence-stale');
    return { allowed: true, reason: 'approved' };
  } catch {
    return reject('authority-unavailable');
  }
}
