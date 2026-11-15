# Repository audit — 2026-11-02

Baseline: `ff029bf44705352a796e18e469cce794ce21b9eb` (0.14.0).
This is a repository-wide architecture and implementation review, not a penetration
test or proof of every provider integration. Source modules, tests, fixtures,
configuration, automation, documentation, generated bundle, and website were inventoried.

## What exists and should survive

| Area | Evidence | Assessment |
| --- | --- | --- |
| Version planning | `changes`, `metadata`, `semver`, `release`, `workspace-release` | Deterministic conventional commits, labels, metadata, channels, stable promotion and dependency propagation. Keep authoritative. |
| Repository adapters | `packages`, `version-adapters`, `version-files`, `version-updaters` | Node/npm/pnpm first; Python, Rust and generic version targets also exist. Restricted selectors and unsupported-range rejection are valuable. Avoid replacing them. |
| Execution | `action`, `github`, `npm`, `registries`, `workspace-integrity` | Real GitHub PR/release orchestration, exact-commit checks, artifact hashes and registry reconciliation. Provider acceptance remains external. |
| Durability | `transaction`, `plugin-sdk` | Schema v6, legacy upgrades, monotonic phases, recorded effects, explicit executor detection and recovery hooks. This is the strongest reusable foundation. |
| Verification | `verification`, `health`, `readiness` | Distinguishes unavailable evidence from integrity mismatch. Immediate/delayed release checks are not continuous service uptime. Preserve that distinction. |
| Developer experience | `cli`, `doctor`, `explain`, `migrate` | Useful local setup, reporting, migration and read-only verification. Existing title-only CLI invocation must continue working. |
| Communication | `notes`, `communication-quality`, `ai`, `release-assistance`, `metadata-inference` | Deterministic communication plus bounded, opt-in advisory AI. Keep AI out of release decisions and monitoring state. |
| Tests | `tests`, `tests/conformance`, `fixtures` | Broad functional coverage, including publication failures, retries, registry mocks, pagination, workspace propagation and golden communication. Not a substitute for production operation. |
| Web | `website` | Optional static project explanation, CSP and Vercel config. No application backend, sessions, service catalog or incident workflow. |

## Verification before changes

On Windows, Node 24.13.0, pnpm 10.32.1:

- Frozen lockfile installation succeeded.
- 36 test files / 259 tests passed.
- Typecheck, build and action bundle succeeded; regenerated `dist` had no diff.
- `pnpm audit --prod` reported no known vulnerabilities at this time. This does not establish absence of vulnerabilities.

GitHub's default-branch Dependabot API also reported nine open **development**
dependency alerts (two high, six moderate, one low) across Vite, Vitest's mocker
and source-map-js. Those existing alerts require a separate dependency-upgrade
and regression pass; the production-only audit does not cover them. No new
production dependency is introduced by the platform foundation.

`docs/live-provider-proof.md` records historical GHCR publication/recovery runs and
npm/PyPI authorization failures. Those historical claims were not rerun in this
audit. No fresh registry publication, deployment or independent adoption is claimed.

## Constraints and debt

- The large `action.ts` combines collection, orchestration, runner commands,
  persistence and presentation. Extract seams only when a concrete new use needs
  them; a sweeping rewrite would endanger release recovery.
- Existing config is release-oriented. Adding operational state to `.semverge.yml`
  or transaction schema v6 would couple unrelated lifecycles. Use a separate platform store.
- There is no authentication, tenant isolation or server-side application runtime.
  The engine's trusted-repository configuration and plugin execution model must
  never become an endpoint for web users to run arbitrary commands.
- Release health reports are point-in-time observations; no uptime history,
  incident ownership, durable operational scheduler or application/service model exists.
- Third-party workflow refs and `actionlint:latest` are mutable. A later focused
  supply-chain change should pin verified upstream revisions; do not silently
  change release automation during the platform slice.
- Tests leave `tests/scratch/effect-out.txt` behind. This is test hygiene debt,
  not product state. Some agent workflow documentation also has stale absolute
  paths and a `dist/cli.js` example (the CLI builds to `lib/cli.js`).
- The README and roadmap deliberately position the old product narrowly. Keep
  onboarding for the working release tool, while distinguishing the broader
  platform's implemented scope and future direction.
- Telemetry ingress, secrets management, egress safety, retention and backup
  behavior need explicit contracts before any hosted service. A modular folder
  layout alone provides none of these guarantees.

## Highest-value safe iteration

Build a separately runnable, single-workspace web application with a persistent
service/environment catalog, read-only integration of existing transaction
records, real scheduled HTTP observations, and incidents with an auditable
lifecycle. Keep the release engine and action bundle unchanged. Test the entire
failure → incident → acknowledgement → recovery path and restart persistence.
See [architecture](platform-architecture.md), [positioning](competitive-analysis.md),
[roadmap](product-roadmap.md), and [business strategy](open-source-strategy.md).
