# Foundation verification — 2026-11-02

## Delivered milestone

The four-area web application is implemented: Overview, Releases, Monitoring and
Incidents. It has authenticated operator sessions, persistent application/service/
environment records, transaction imports, a real HTTP worker, observation history,
and an incident response timeline. The original CLI and GitHub Action remain the
release authority. No production deployment or PR merge was performed.

| Requirement | Evidence | Practical boundary |
| --- | --- | --- |
| Preserve existing releases | `pnpm verify`: 259 tests in 36 files; typecheck, build and bundle pass. Generated `dist/index.cjs` and map match the baseline. | Does not re-prove every registry credential or live publication. |
| Persistent platform context | SQLite foreign keys and parameterized writes; API workflow reopens the database and reads records/history. | One trusted operator workspace, one application process, local disk. |
| Release integration | Existing transaction parser, allowlisted projection, stable identity, idempotent reimport, stale/conflict rejection, explicit service/environment association. | Manual transaction import; no automatic GitHub ingestion or deployment claim. |
| Real monitoring | Controlled HTTP 200/503 endpoint, timeout/redirect tests, persisted history, leases, pause/resume and worker concurrency coverage. A separate real HTTPS probe to `https://example.com/` returned HTTP 200 in 56 ms. | One observation location; one public probe is connectivity evidence, not uptime or global availability. |
| Connected incidents | HTTP failure → one incident → acknowledgement/owner → note → explicit release association → passing check → recorded recovery. Manual reporting/resolution also covered. | No notifications, paging or on-call schedules. Association does not establish cause. |
| Security boundaries | Session, logout, Host/Origin, content type/body bounds, stored-input browser escaping, cross-context release references, private/mixed DNS rejection, no redirects and bounded probe duration. | Not a penetration test or hosted multi-tenant isolation certification. |
| Product experience | Python Playwright completes eight end-to-end checkpoints with no JavaScript errors. Desktop and 393px mobile captures cover populated/empty Overview, sign-in, release, monitor and incident detail. | Explicit local test application, synthetic release transaction, real local HTTP observations. Normal installations start empty. |
| Brand and accessibility | User-approved Unslop polish and direct monochrome reference; independent Impeccable review returned **ship** for the captured desktop/mobile scope, no material fixes requested. | Focused design review, not a comprehensive accessibility certification. |

## Commands and CI

Local environment: Windows, Node 24.13.0, pnpm 10.32.1; Python Playwright 1.62.0.

```bash
pnpm install --frozen-lockfile
pnpm platform:build
pnpm platform:test
python platform/tests/browser_smoke.py
pnpm verify
git diff --exit-code -- dist/index.cjs dist/index.cjs.map
```

The platform suite contains six workflow tests with multiple assertions covering
API, database, worker and network policy behavior. The browser script reports
eight workflow checkpoints; it is not represented as eight isolated unit tests.

At implementation head `ea210676da5e5a8f948087fd1be5897f949ca2b7`, GitHub CI passed
the Linux browser workflow, platform checks on Linux/Windows Node 24.13.0, and
the existing nine OS/Node combinations (Linux/macOS/Windows × Node 20/22/24).
Workflow lint, dependency review and CodeQL also passed. Check each PR for the
latest head and final documentation checks:

- [#143: audit and strategy](https://github.com/EvanGribar/semverge/pull/143)
- [#144: persistence, API and worker](https://github.com/EvanGribar/semverge/pull/144)
- [#145: connected web workspace](https://github.com/EvanGribar/semverge/pull/145)

These PRs are stacked in that order. Merge/rebase sequencing remains a maintainer
decision; none was merged automatically.

## Remaining gates

- Self-host runtime and SQLite are early foundations; Node 24.13.0 emits an
  experimental SQLite warning. Pin/test runtime changes, plan backups and restores,
  and review a TLS/reverse-proxy configuration before public operation.
- Operators can create catalog entries and monitors, pause/resume checks and
  manage incidents. Catalog editing/deletion, monitor editing/deletion, export,
  pagination and automated ingest credentials remain follow-on work.
- Observations retain 30 days; release and incident records/timelines currently
  retain indefinitely. Installation limits and lifecycle behavior are documented
  in [the operating guide](../platform/README.md).
- Hosted multi-tenancy, error ingestion, maintenance workflows, notifications and
  permissioned automated recovery are roadmap items, not implemented capabilities.
- Nine existing default-branch development dependency alerts remain documented in
  [the audit](platform-audit.md). The production dependency audit reported no known
  vulnerabilities at its run time; neither result is a security certification.

Design method: [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop),
CC BY 4.0; see [the design review](design-review.md) for attribution and pass results.
