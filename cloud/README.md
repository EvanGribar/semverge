# SemVerge Cloud

Preview release readiness, customer impact, technical changes, and changelogs in one workspace. The workspace reads the most recent 20 published releases from EvanGribar/semverge through the public GitHub API. It refreshes every five minutes and falls back to SemVerge's checked-in public release files when GitHub is unavailable. Published releases can show a historical check result and recording date from the editable GitHub release body. Cloud does not independently authenticate that record or check current service health. Live HTTP observations are available in the separate [experimental reliability workspace](../platform/README.md). Technical changes link to the version-specific changelog from the same commit when the default release manifest records a changelog path. Open a local CLI plan to see the same views for a proposed release. The browser reads the file locally and keeps it in memory until the tab closes or reloads.

From the repository root:

```sh
npm ci --prefix cloud
npm run dev --prefix cloud
```

Open http://localhost:3000 for the landing page or http://localhost:3000/releases for the public release workspace. To import a plan from a project with SemVerge installed:

```sh
semverge plan "feat: add bulk invoice export" > release-plan.json
```

The CLI command previews the supplied change and reports readiness from the evidence available to the CLI. The workspace displays that report and the generated notes. The public example shows checked-in changelog history.

## Vercel preview

Set the Vercel project root directory to `cloud` with Next.js as the framework. Enable **Include source files outside of the Root Directory** so the build can read the public release files, the Stageshow kit, and the local Manrope font in the parent directory. The app uses `npm run build`, which prepares the public snapshot before building the Next.js application. The dashboard needs no environment variables.

## Read-only MCP pilot

The Streamable HTTP endpoint at `/api/mcp` uses the dashboard's data loaders:

| Tool | Evidence returned |
| --- | --- |
| `release_status` | Open release plans, recorded readiness and the corresponding release PR URLs |
| `release_blockers` | Blockers for each open plan, with explicit unavailable status when a manifest cannot be read |
| `latest_release_outcome` | The latest published release and its recorded verification outcome |

For the pilot, configure `SEMVERGE_MCP_TOKEN_SHA256` on the server with the hex SHA-256 digest of a randomly generated 32-byte token encoded as unpadded base64url. Configure the client to send the original token as `Authorization: Bearer <token>`. Store the original token in the client's secret store. The server denies requests until the digest is configured. Use HTTPS outside localhost. A protected Vercel preview also requires access through Vercel Deployment Protection.

This pilot credential grants read access to the public SemVerge repository data. Private repositories require a workspace token and the GitHub App setup below.

For `latest_release_outcome`, `release.outcome` describes publication. `release.verification` gives the GitHub release body as the source, the recorded status (`passed`, `degraded`, `failed`, `disabled`, or `unavailable`), and `recordedAt` when a dated result is available. An old result retains its original date.

## Workspace-scoped MCP credentials

Run `npm run db:migrate --prefix cloud` with `SEMVERGE_MIGRATION_DATABASE_URL` set to the direct connection for a fresh Cloud database. The runner applies all pending migrations and verifies checksums on reruns. Use the pooled connection for the web app. See the numbered migrations in `db/` for the schema. Provision a workspace row, a repository binding for each selected GitHub App repository, and an expiring MCP credential row. A binding stores the GitHub numeric repository and installation IDs, the owner/repository name, and the release branch. Store the token digest as a 32-byte `bytea` value. Set `revoked_at` to revoke access.

Set these server-side environment variables:

- `SEMVERGE_DATABASE_URL` for the Postgres connection.
- `SEMVERGE_GITHUB_APP_ID` and `SEMVERGE_GITHUB_APP_PRIVATE_KEY` for the App registration. The PEM needs real line breaks.
- Grant the installation read access to **Contents** and **Pull requests** and select the intended repositories in GitHub.

A workspace token works only with repositories bound to its workspace. If several repositories are connected, tools return the available repository names when called without a selection. Pass `repository` as `owner/name` to read one repository. The public pilot token continues to grant access only to the SemVerge demo.

## Browser workspace sign-in

Apply `db/002-browser-access.sql` after the workspace migration. Add approved GitHub numeric user IDs to `semverge_workspace_members` for their workspaces. Removing a membership takes effect on the next request.

Configure `SEMVERGE_ORIGIN` to the exact dashboard origin, without a trailing slash, and set `SEMVERGE_GITHUB_CLIENT_ID` and `SEMVERGE_GITHUB_CLIENT_SECRET` from the same GitHub App. Register the dashboard's `/api/auth/github/callback` URL in the App settings. Browser sessions expire after eight hours. The OAuth access token is used once to identify the account and stays out of the database. Repository access uses the separately scoped installation token.

Open `/workspaces` to sign in. All repositories shows open plans, blockers, and the latest publication outcome for connected repositories, six at a time. Select a repository for its full notes and version history. This path requires HTTPS on hosted environments.

## Connect a GitHub repository

Apply `db/003-repository-connections.sql`. Approve the installation ID for the intended workspace in `semverge_workspace_installations` and set `can_connect_repositories` for the workspace members responsible for onboarding. Existing bindings receive installation approval during the migration. Removing an installation approval disconnects its repositories from that workspace.

A workspace admin can enter the repository and release branch in Cloud. GitHub reauthorizes the user, and SemVerge verifies that the same user administers the repository and that the App has a matching approved installation. The public dashboard never consumes these connections.
## Provision the first workspace

With the migrations applied, set the direct connection in `SEMVERGE_MIGRATION_DATABASE_URL`. Set `SEMVERGE_PILOT_WORKSPACE_ID` to a UUID chosen for the pilot, `SEMVERGE_PILOT_WORKSPACE_NAME` to its display name, and `SEMVERGE_PILOT_GITHUB_USER_ID` and `SEMVERGE_PILOT_INSTALLATION_ID` to the approved GitHub numeric IDs. Set `SEMVERGE_PILOT_MCP_TOKEN_SHA256` to the hex digest of the client token.

Run `npm run db:seed-pilot --prefix cloud`. This creates the workspace, grants its first member repository connection access, approves the installation, and records a seven-day MCP credential. Repeating it with the same inputs preserves expiration and existing grants. Sign in and use **Connect repository** to add the selected test repo.

## Hosted acceptance

Use a preview with a dedicated database and a GitHub App installed on a private fixture repository. Give that repository a published release and an open SemVerge release PR with recognizable fixture values. Use a stable HTTPS preview origin for the callback, and record the deployment URL and revision tested.

1. Open `/workspaces`, complete GitHub sign-in as the approved fixture repository admin, and connect the private repository.
2. Reopen the workspace and check that the release tag, recorded verification status and date, and release PR match the fixture. Confirm the public `/releases` page shows only the public demo.
3. With the workspace credential, initialize MCP at `/api/mcp` and call all three tools for the fixture repository. Compare the returned release and PR URLs, blockers, and recorded check result with the browser. Repeat a call for an unconnected repository and confirm it returns a tool error without repository evidence. Revoke the fixture credential and confirm a subsequent request receives HTTP 401.
4. Have someone who did not build SemVerge follow the setup and acceptance instructions without live assistance. Give them temporary access scoped to the isolated fixture. Ask them to explain what the release evidence means and identify why the open release is blocked. Record pass or fail per step, the observed revision, and any documentation gaps. Keep credentials out of the evidence.
5. Remove the operator's temporary workspace membership and fixture repository access, and revoke any remaining operator credentials. Confirm the workspace is no longer available to the operator and their MCP credential is rejected.

CI builds and tests Cloud and exercises MCP initialization, discovery, credential rejection, and repository scope on the local production server. It also submits the workspace repository and sign-out forms in Chromium and Firefox to verify that native POST requests retain their same-origin `Origin` header. Hosted GitHub authorization, private repository reads, and independent operator acceptance require the pilot above.
