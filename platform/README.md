# Semverge platform foundation

This is a separately runnable, single-operator web application. The existing
`semverge` CLI and GitHub Action do not require it. It is an early self-hosted
foundation, not a multi-tenant hosted service or an on-call paging system.

## Run locally

Requires **Node 24.13.x** (tested with 24.13.0) and pnpm 10.32.1. The root release
package continues to support Node >=20. `node:sqlite` emits an experimental
warning on this runtime; test runtime upgrades and back up the database first.

```powershell
pnpm install --frozen-lockfile
pnpm platform:build
$env:SEMVERGE_PLATFORM_TOKEN = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
pnpm platform:start
```

Open `http://127.0.0.1:4310` and use the operator token from your local environment
to sign in. Keep the token in your password manager; changing it and restarting
invalidates all sessions. Do not commit it. Browser sessions expire after eight
hours and are invalidated on restart; operational state persists in SQLite.

## Configuration

| Variable | Default / behavior |
| --- | --- |
| `SEMVERGE_PLATFORM_TOKEN` | Required, at least 32 characters; grants full operator access |
| `SEMVERGE_PLATFORM_DATABASE` | `semverge-platform.sqlite` in the working directory |
| `SEMVERGE_PLATFORM_ORIGIN` | `http://127.0.0.1:4310`; exact browser origin and Host; use HTTPS behind a proxy for non-loopback access |
| `SEMVERGE_PLATFORM_BIND` | `127.0.0.1`; change deliberately for reverse-proxy operation |
| `SEMVERGE_MONITOR_LOCAL` | Off; `true` permits **only** HTTP `127.0.0.1` on ports >=1024 for controlled local checks |

No cloud accounts, analytics, external fonts or paid infrastructure are needed.
Serve the application from its own origin. A reverse proxy must preserve the
configured Host; do not expose it publicly without TLS and deployment review.
There is no user registration, role management, or shared-tenant isolation.

## Workflow and evidence boundaries

Create an application, service and environment. Add an HTTPS monitor with its
expected 2xx status and interval (30 seconds to one day). The worker checks due
monitors, at most three concurrently, with a ten-second total DNS/connect/TLS/HTTP
deadline. Checks use GET; response bodies are discarded and redirects are not
followed. Credential-bearing URLs and query strings are rejected. Every DNS
answer must be public, and the connection pins a checked address. A failed
request or policy rejection is recorded with its reason, never as a success.

Two consecutive failures open one incident. The operator can acknowledge and
assign it, add notes, link a release, and resolve it with a note. A subsequent
successful check automatically resolves a monitor incident with an evidence
entry. Manual incidents remain manual. One failure remains visible in monitor
status before an incident opens. Missing/stale data is unknown, not healthy.
Checks record a sample of one endpoint from one machine, not an SLA, global
uptime, deployment status or full application health.

Import an existing Semverge **transaction JSON object** from an Action transaction
output or release body's `semverge-progress` marker. The platform reuses the
engine's parser (legacy versions included), rejects conflicting/stale updates,
and stores a minimal projection. It omits event targets/details, raw error text,
artifact paths, registry credentials and plugin payloads. The chosen service and
environment are **operator associations**, not proof of a deployment. Import does
not run `verify`, publish, trigger workflows or execute plugins. Continue using
the CLI/Action for readiness, planning, publication and verified recovery.

## API

All `/api/*` routes require a session except `POST /api/login`. Write requests
require `Content-Type: application/json` and an exact `Origin` matching the
configured origin, including non-browser clients. The maximum body is 512 KiB.

| Route | Purpose |
| --- | --- |
| `POST /api/login` / `POST /api/logout` | Token exchange and session revocation |
| `GET /api/state` | Catalog, monitors/latest observations, releases and incidents |
| `POST /api/applications`, `/api/services`, `/api/environments` | Create catalog entries |
| `POST /api/releases` | Import `{serviceId, environmentId, transaction}` |
| `POST /api/monitors` | Create `{name, serviceId, environmentId, url, intervalSeconds, expectedStatus}` |
| `PATCH /api/monitors/:id` | Set `{paused: true/false}` |
| `GET /api/monitors/:id/checks` | Latest 60 retained observations |
| `POST /api/monitors/:id/checks` | Run a real check now (body `{}`); busy/paused returns 409 |
| `POST /api/incidents` | Report `{title, serviceId, environmentId, releaseId?}` |
| `PATCH /api/incidents/:id` | `action`: `acknowledge` + `owner`, `note` + `message`, `resolve` + `message`, or `link-release` + `releaseId` |
| `GET /api/incidents/:id/timeline` | Incident audit timeline |

The initial API is internal to this application, not a promised stable SDK.
Snapshot lists show at most 1,000 releases and 1,000 incidents, with active
incidents first. The installation caps applications at 50, services at 100,
environments at 20 and monitors at 50. Catalog/monitor editing and deletion,
pagination/export and token-scoped automated ingestion are follow-on work.

## Operation

Run **one application process** on a local persistent disk. The worker persists
next-run times and thirty-second leases; a restart resumes due work after a lease
expires. Missed checks are not backfilled. A paused in-flight monitor discards
its result. Short SQLite transactions atomically write observations and incident
transitions. The UI exposes worker timing; a dead process cannot alert you about
itself. No notification delivery is implemented.

Observations are pruned to 30 days on startup and daily. Incident timelines and
release records are retained until an operator-managed archival/deletion tool is
introduced; include them in disk-capacity planning. History shows the latest 60
observations per monitor. Stop gracefully before taking a database file backup,
or use SQLite's online backup API. Do not copy an active `.sqlite` file without
its WAL. Restore a backup into a separate directory and run a controlled check
before relying on it. Schema migrations run on startup, and newer database
versions are refused. A migration rollback requires a backup, not code alone.

```bash
pnpm platform:build
pnpm platform:test
pnpm verify
```

For the isolated browser workflow and desktop/mobile captures:

```bash
python -m pip install -r platform/tests/requirements.txt
python -m playwright install chromium
python platform/tests/browser_smoke.py
```

This starts temporary in-memory test servers on loopback ports 4320 and 4321,
creates an explicitly named local test application, and collects real observations
from a controlled HTTP endpoint. The imported release is synthetic test evidence.
It does not seed or modify your operating database. CI runs the same browser
workflow on Linux; captures are saved under `.impeccable/review/` and ignored by Git.

The platform tests exercise real HTTP responses, authentication, incident
transitions, idempotent imports, restart persistence, leases, policy rejection,
timeouts and redirects. Root release tests remain separate for Node 20 support.
See [architecture](../docs/platform-architecture.md) for the hosted-product gates.
