BEGIN;

CREATE TABLE semverge_workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0)
);

CREATE TABLE semverge_workspace_repositories (
  workspace_id uuid NOT NULL REFERENCES semverge_workspaces(id) ON DELETE CASCADE,
  github_repository_id bigint NOT NULL CHECK (github_repository_id > 0),
  github_installation_id bigint NOT NULL CHECK (github_installation_id > 0),
  full_name text NOT NULL CHECK (full_name ~ '^[A-Za-z0-9-]+/[A-Za-z0-9_.-]+$'),
  release_branch text NOT NULL CHECK (length(trim(release_branch)) > 0),
  PRIMARY KEY (workspace_id, github_repository_id)
);

CREATE UNIQUE INDEX semverge_workspace_repository_name
  ON semverge_workspace_repositories (workspace_id, lower(full_name));

CREATE TABLE semverge_mcp_credentials (
  token_sha256 bytea PRIMARY KEY CHECK (octet_length(token_sha256) = 32),
  workspace_id uuid NOT NULL REFERENCES semverge_workspaces(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

COMMIT;
