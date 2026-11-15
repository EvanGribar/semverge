BEGIN;

ALTER TABLE semverge_workspace_members
  ADD COLUMN can_connect_repositories boolean NOT NULL DEFAULT false;

CREATE TABLE semverge_workspace_installations (
  workspace_id uuid NOT NULL REFERENCES semverge_workspaces(id) ON DELETE CASCADE,
  github_installation_id bigint NOT NULL CHECK (github_installation_id > 0),
  PRIMARY KEY (workspace_id, github_installation_id)
);

INSERT INTO semverge_workspace_installations (workspace_id, github_installation_id)
SELECT DISTINCT workspace_id, github_installation_id FROM semverge_workspace_repositories;

ALTER TABLE semverge_workspace_repositories
  ADD CONSTRAINT semverge_repository_installation
  FOREIGN KEY (workspace_id, github_installation_id)
  REFERENCES semverge_workspace_installations (workspace_id, github_installation_id)
  ON DELETE CASCADE;

COMMIT;
