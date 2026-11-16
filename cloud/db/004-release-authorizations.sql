BEGIN;

CREATE TABLE semverge_release_authorizations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  github_repository_id bigint NOT NULL CHECK (github_repository_id > 0),
  release_branch text NOT NULL CHECK (length(trim(release_branch)) > 0),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  workflow_blob text NOT NULL CHECK (workflow_blob ~ '^[a-f0-9]{40}$'),
  config_blob text NOT NULL CHECK (config_blob ~ '^[a-f0-9]{40}$'),
  run_id bigint NOT NULL CHECK (run_id > 0),
  run_attempt integer NOT NULL CHECK (run_attempt > 0),
  evidence_at timestamptz NOT NULL CHECK (isfinite(evidence_at)),
  team_id text NOT NULL CHECK (team_id ~ '^team_[A-Za-z0-9]+$'),
  project_id text NOT NULL CHECK (project_id ~ '^prj_[A-Za-z0-9]+$'),
  preview_deployment_id text NOT NULL CHECK (preview_deployment_id ~ '^dpl_[A-Za-z0-9]+$'),
  environment text NOT NULL CHECK (environment = 'production'),
  operation text NOT NULL CHECK (operation = 'promote-preview'),
  approver_github_id bigint NOT NULL CHECK (approver_github_id > 0),
  decision text NOT NULL CHECK (decision IN ('approve', 'deny')),
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(issued_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  CHECK (evidence_at <= issued_at AND issued_at < expires_at)
);

-- One terminal event per authorization. Preserve it alongside the decision.
CREATE TABLE semverge_release_authorization_terminal (
  authorization_id uuid PRIMARY KEY REFERENCES semverge_release_authorizations(id),
  event text NOT NULL CHECK (event IN ('revoked', 'consumed')),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(recorded_at))
);

COMMIT;
