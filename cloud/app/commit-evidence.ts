import type { GitHubRepository } from './github-repository';

export const evidenceWorkflow = '.github/workflows/semverge-evidence.yml';
// Only the reviewed v1 producer is trusted. Changing the workflow requires a reviewed adapter update.
const workflowBlob = 'd4f2f1a35fc7eacae6728c9b6dead4f1a2f2a9d3';
const checks = ['Verify release engine', 'Validate release configuration'] as const;
export const commitSha = /^[a-f0-9]{40}$/;
export const commitEvidenceMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

type CommitEvidence = {
  schemaVersion: 1;
  repository: { id: number; name: string };
  branch: string;
  commit: string;
  policy: { workflowBlob: string; configBlob: string };
  evaluatedAt: string;
  provenance: { source: 'github-actions-api'; runId: number; attempt: number; url: string };
  result: 'passed' | 'failed';
  explanation: string;
};

export type EvidenceResult = { status: 'recorded'; evidence: CommitEvidence } |
  { status: 'unavailable'; reason: string; code?: 'candidate-changed' | 'evidence-stale' };

const unavailable = (reason: string, code?: 'candidate-changed' | 'evidence-stale'): EvidenceResult =>
  code ? { status: 'unavailable', reason, code } : { status: 'unavailable', reason };
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export async function currentCommitEvidence(repo: GitHubRepository, requested?: string, now = Date.now()): Promise<EvidenceResult> {
  const signal = AbortSignal.timeout(5000);
  const read = (path: string) => repo.read(path, signal, true);
  const branch = repo.releaseBranch;
  const branchPath = 'branches/' + encodeURIComponent(branch);
  try {
    const [head, identity] = await Promise.all([read(branchPath), read('./')]) as [
      { name?: string; commit?: { sha?: string } },
      { id?: number; full_name?: string },
    ];
    const commit = head?.commit?.sha;
    const id = identity?.id;
    if (head?.name !== branch || typeof commit !== 'string' || !commitSha.test(commit) ||
        !positiveInteger(id) || identity?.full_name?.toLowerCase() !== repo.name.toLowerCase()) {
      return unavailable('Repository or release branch identity could not be verified.');
    }
    if (requested !== undefined && requested !== commit) return unavailable('Requested commit is not the current release branch head.', 'candidate-changed');

    const query = new URLSearchParams({ branch, head_sha: commit, per_page: '1' });
    const [listing, workflow, config] = await Promise.all([
      read('actions/workflows/semverge-evidence.yml/runs?' + query),
      read('contents/' + evidenceWorkflow + '?ref=' + commit),
      read('contents/.semverge.yml?ref=' + commit),
    ]) as [
      { workflow_runs?: Array<{
        id?: number; run_attempt?: number; head_sha?: string; head_branch?: string; status?: string;
        path?: string; event?: string; repository?: { id?: number }; head_repository?: { id?: number };
        conclusion?: string; updated_at?: string;
      }> },
      { sha?: string; type?: string },
      { sha?: string; type?: string },
    ];
    if (workflow?.type !== 'file' || workflow.sha !== workflowBlob) return unavailable('Evidence workflow revision is not trusted.');
    if (config?.type !== 'file' || typeof config.sha !== 'string' || !commitSha.test(config.sha)) return unavailable('Policy revision is unavailable.');
    const run = Array.isArray(listing?.workflow_runs) ? listing.workflow_runs[0] : undefined;
    if (!run) return unavailable('No evidence run was found for this commit.');
    if (!positiveInteger(run.id) || !positiveInteger(run.run_attempt) || run.repository?.id !== id || run.head_repository?.id !== id ||
        run.head_sha !== commit || run.head_branch !== branch || !['push', 'workflow_dispatch'].includes(run.event ?? '') ||
        ![evidenceWorkflow, evidenceWorkflow + '@' + branch, evidenceWorkflow + '@refs/heads/' + branch].includes(run.path ?? '')) {
      return unavailable('Workflow run does not match the repository, commit, or policy.');
    }
    if (run.status !== 'completed' || (run.conclusion !== 'success' && run.conclusion !== 'failure')) {
      return unavailable('The latest workflow attempt has no completed verification result.');
    }
    const evaluatedAt = run.updated_at;
    const time = typeof evaluatedAt === 'string' ? Date.parse(evaluatedAt) : NaN;
    if (!Number.isFinite(time) || time > now) return unavailable('Workflow evidence has an invalid timestamp.');
    if (now - time > commitEvidenceMaxAgeMs) return unavailable('Workflow evidence is stale.', 'evidence-stale');

    const { jobs } = await read(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=2`) as {
      jobs?: Array<{ name?: string; run_id?: number; head_sha?: string; conclusion?: string; status?: string;
        steps?: Array<{ name?: string; status?: string; conclusion?: string }> }>;
    };
    const job = jobs?.[0];
    if (!Array.isArray(jobs) || jobs.length !== 1 || job?.name !== 'SemVerge evidence v1' || job.run_id !== run.id ||
        job.head_sha !== commit || job.status !== 'completed' || job.conclusion !== run.conclusion || !Array.isArray(job.steps)) {
      return unavailable('Workflow job results are missing or do not match this run.');
    }
    const succeeded = run.conclusion === 'success';
    if (succeeded && checks.some((name) => {
      const matches = job.steps!.filter((step) => step?.name === name);
      return matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success';
    })) return unavailable('Required verification steps did not report success.');

    const [latest, latestRun] = await Promise.all([read(branchPath), read(`actions/runs/${run.id}`)]) as [
      { name?: string; commit?: { sha?: string } },
      { id?: number; head_sha?: string; run_attempt?: number; status?: string; updated_at?: string; conclusion?: string },
    ];
    if (latest?.name === branch && typeof latest.commit?.sha === 'string' && commitSha.test(latest.commit.sha) && latest.commit.sha !== commit) {
      return unavailable('Release branch changed during evidence retrieval.', 'candidate-changed');
    }
    if (latest?.name !== branch || latest.commit?.sha !== commit || latestRun?.id !== run.id || latestRun.head_sha !== commit ||
        latestRun.run_attempt !== run.run_attempt || latestRun.status !== 'completed' ||
        latestRun.conclusion !== run.conclusion || latestRun.updated_at !== evaluatedAt) {
      return unavailable('Release branch or workflow attempt changed during evidence retrieval.');
    }
    const failedCheck = checks.find((name) => job.steps!.some((step) => step?.name === name && step.conclusion === 'failure'));
    return { status: 'recorded', evidence: {
      schemaVersion: 1, repository: { id, name: repo.name }, branch, commit,
      policy: { workflowBlob, configBlob: config.sha },
      evaluatedAt: new Date(time).toISOString(),
      provenance: { source: 'github-actions-api', runId: run.id, attempt: run.run_attempt,
        url: `https://github.com/${repo.name}/actions/runs/${run.id}/attempts/${run.run_attempt}` },
      result: succeeded ? 'passed' : 'failed',
      explanation: succeeded ? 'Release engine verification and configuration validation passed in CI.'
        : failedCheck ? failedCheck + ' failed. See the GitHub Actions attempt for details.'
          : 'The verification job failed before it could complete the required checks. See the GitHub Actions attempt for details.',
    } };
  } catch {
    return unavailable('GitHub Actions evidence could not be read.');
  }
}
