BEGIN;

CREATE TABLE semverge_workspace_members (
  workspace_id uuid NOT NULL REFERENCES semverge_workspaces(id) ON DELETE CASCADE,
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  PRIMARY KEY (workspace_id, github_user_id)
);

CREATE INDEX semverge_workspace_members_user ON semverge_workspace_members (github_user_id);

CREATE TABLE semverge_browser_sessions (
  token_sha256 bytea PRIMARY KEY CHECK (octet_length(token_sha256) = 32),
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  expires_at timestamptz NOT NULL
);

CREATE INDEX semverge_browser_sessions_expiry ON semverge_browser_sessions (expires_at);

COMMIT;
