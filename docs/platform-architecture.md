# Minimal platform architecture

Status: the foundation's API, SQLite store, worker and four-area web experience
are implemented in staged pull requests. This document distinguishes that
single-workspace milestone from the proposed hosted expansion. Implementation
and operating boundaries are in [the platform guide](../platform/README.md).

## Decision: one repository, two runtime boundaries

Keep the root `semverge` package, public exports, CLI, Node >=20 support, Action
inputs/outputs, transaction schema and checked-in bundle intact. Add `platform/`
as a separately built Node 24 application. Use TypeScript, Node HTTP, and SQLite
through `node:sqlite`; no new production dependencies, queue broker, Kubernetes,
or paid service is necessary. SQLite is experimental in the verified Node 24.13
runtime; pin and test the runtime when operating it. The application and release
tool can evolve separately without moving every module into packages today.

This is a modular application, not a distributed system. A workspace monorepo
becomes useful when the browser SDK, collector or API genuinely needs independent
packaging. Split repositories only when release cadence, ownership or security
boundaries justify the coordination cost.

```text
Browser ── session-authenticated same-origin API ── application/domain layer
                                                    │
                                        SQLite catalog, releases,
                                        checks, incidents, timeline
                                                    ▲
                                      bounded in-process scheduler
                                                    │
                                    validated and DNS-pinned HTTP probe

Existing Semverge transaction export ── validated adapter ── release records
Existing CLI / Action ── unchanged release publication and recovery authority
```

## Complete first slice

1. Overview: applications, their services, explicit environments, observed status,
   latest release records and unresolved incidents. Missing/stale data is unknown.
2. Releases: import authentic Semverge transaction JSON, validate with the existing
   parser, bind to service/environment, retain phase, source commit and event
   evidence. Reimport is idempotent and rejects identity changes and stale updates.
   Do not run release commands or claim a fresh provider verification on import.
3. Monitoring: persisted HTTP monitor definitions, bounded periodic probes,
   historical status/latency, manual checks and pause/resume. No response bodies,
   authorization headers or URL credentials. Redirects do not bypass egress rules.
4. Incidents: consecutive failures open one incident for a monitor; explicit
   acknowledge, notes and resolution produce timeline entries. Passing checks
   record recovery evidence. Manual incidents can reference a known release;
   inferred recency alone is never blamed as the cause.

## Data and invariants

- One installation is one trusted operator workspace in this milestone. Every
  service belongs to an application; every observation belongs to a monitor,
  service and environment. Foreign keys prevent dangling cross-context links.
- Releases are projections of source records; their original identity and source
  commit are stable. Operational events and incident transitions are separate
  from publication transaction events. Semantic version alone is not identity.
- Monitor scheduling uses persisted due times and a lease before I/O. Only one
  attempt owns a monitor at a time; expired leases permit recovery after restart.
  An interrupted attempt is unknown, not a fabricated success. SQLite writes
  are short transactions; no database transaction spans a network call.
- Store observation timestamp, HTTP code if available, latency and a bounded
  outcome category. Keep 30 days of observations and document daily pruning.
  No uptime/SLA percentage inferred from sparse samples.
- Incident creation, observation insertion and state transitions must commit
  atomically. One active auto incident per monitor; manual incidents remain
  operator-controlled. Resolution evidence and human acknowledgement differ.

## Security and operation

Require a strong operator token; exchange it for an expiring HttpOnly, SameSite
session cookie. Use exact configured Host/Origin validation, strict JSON/body
bounds, no CORS, CSP, parameterized SQL, and text-only rendering for stored input.
Bind loopback by default. Public operation requires TLS, a reverse proxy, backups
and a reviewed deployment configuration; no automatic deployment is authorized.
Do not log tokens, raw release metadata or request bodies.

Monitoring is an SSRF boundary: permit public HTTPS, resolve and reject nonpublic
addresses, pin the connection to the checked IP, disallow redirects and bound total
request duration. A narrowly enabled loopback-only HTTP mode supports local demos
and tests. Never provide a global private-network bypass. Enforce per-installation
monitor limits and bounded concurrency before exposing it to users.

Use SQLite WAL, foreign keys, migrations and a persistent data directory. Operate
one application process against a local disk. Stop probes gracefully on shutdown;
back up through SQLite's backup tooling or while stopped, never copy an active
database without its WAL. A later hosted tier needs a verified PostgreSQL migration,
tenant-keyed foreign keys/RLS, scoped ingest credentials, durable outbox jobs,
quotas, deletion/export and isolation tests before accepting multiple organizations.

## Expansion seams

Collection adapters emit observations; domain logic owns state transitions; API
serializes read models; UI never decides monitoring health. Future error groups,
maintenance findings and recovery runs share service/environment/release context.
Do not add empty tables, fake navigation or stub endpoints for these future areas.
Recovery execution must eventually require explicit permissions, idempotent effect
descriptors, approval and independent verification; the release plugin contract
is a useful precedent, not an HTTP sandbox.

References: [Node SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html),
[Node HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html), and
[GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).
