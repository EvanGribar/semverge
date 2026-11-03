# SemVerge product roadmap

## Positioning

Semverge is evolving into an open-source software reliability and operations
platform. Its release engine remains the shipping authority; a separate web
application will connect services, environments, releases, observations and
incidents. The long-term product spans releases, monitoring, errors, incidents,
maintenance and recovery. The list below describes existing release capabilities,
not completion of that larger platform.

See the [audit](platform-audit.md), [architecture](platform-architecture.md),
[competitive analysis](competitive-analysis.md) and [open-source strategy](open-source-strategy.md).

## Delivered foundation

- Node.js single-package repositories
- Conventional commit parsing
- Product-aware PR label overrides
- Optional structured PR metadata
- Semantic version selection
- `package.json`, npm lockfile, and pnpm workspace version handling
- Release PR maintenance
- `CHANGELOG.md`, customer-facing notes, internal notes, migration notes, and a JSON manifest
- Required-label and required-file readiness checks
- Git tag and GitHub release publication
- Prerelease channels with beta, RC, nightly, and canary label overrides, fixed/independent npm and pnpm workspaces, Python and Rust version adapters
- Native Python `uv`/PDM and Rust Cargo workspace member discovery with deterministic fixed/independent version planning
- Repository-only generic targets driven by explicitly configured version files, with fail-closed single and independent release planning
- Configurable npm publishing, release artifacts, immediate post-release verification, and a local CLI (`init`, `plan`, `doctor`)
- Explicit durable release transactions with monotonic phases, idempotent side-effect events, failure recording, legacy-marker upgrades, release-body summaries, SHA-256 artifact digests, and `recover` inspection
- Test-only deterministic failure injection for package publication, asset upload, finalization, and post-release verification, with retry coverage for build, package, asset, finalization, and verification failures
- Versioned, explicitly registered plugin SDK contract with lifecycle hooks and idempotent effect descriptors
- Human-readable local `explain` output for version decisions, readiness blockers, merge behavior, and transaction recovery
- Report-first migration diagnostics for Release Please, Changesets, and semantic-release with explicit opt-in config writing
- Read-only setup diagnostics for package managers, workspaces, tags, release tools, build hooks, registries, and workflow permissions
- Optional static React marketing site with versioned Vercel configuration; the release engine has no frontend or hosting dependency
- Opt-in npm provenance publication with GitHub Actions OIDC preflight and durable transaction binding; provider eligibility remains external proof
- Explainable per-package release graphs in release PRs and manifests, including direct changes, dependency propagation, and unreleased packages
- Explicit independent-workspace dependency policies for runtime, optional, peer, and development links, with dependency-field evidence in the release graph
- Configurable prerelease channel labels and identifiers, with optional branch-scoped preparation
- Checked-in single-package, fixed-pnpm, independent-workspace, retry, and large-repository fixtures for deterministic end-to-end proof
- Explicit stable promotion from a prerelease, with channel and promotion decisions recorded in plans, release PRs, manifests, explanations, and action outputs
- Opt-in Python PyPI and Rust crates.io publishing adapters with exact-version idempotency checks and durable publication-target binding
- Explicit delayed release monitoring with configurable windows and idempotent release-PR history comments
- Optional idempotent delayed-monitoring GitHub check-run evidence bound to a release commit
- Explicit scheduled/manual channel preparation with independent channel source, base, release-PR, and tag policies
- Audience-aware customer notes and external announcements with deterministic precedence, quality gates, and golden communication fixtures
- Opt-in, provider-neutral AI release-note drafts with immutable-fact reconciliation, bounded/redacted context, and deterministic fallback behavior
- Explicit advisory pull-request metadata inference with safe file-path context and conflict rejection

## Milestones and exit gates

| Stage | Scope | Exit gate |
| --- | --- | --- |
| Foundation (this iteration) | Single-workspace web app; application/service/environment catalog; release transaction imports; real scheduled HTTP checks/history; connected incident lifecycle | Tested failure-to-recovery workflow, restart persistence, auth/egress tests, rendered desktop/mobile review; existing release suite and bundle preserved |
| Initial product | GitHub ingestion with scoped credentials and verified signatures, notifications, deployment records, operational backup/upgrade tooling, accessible onboarding | Independent self-host installations complete a real workflow; duplicate/out-of-order delivery and notification retry tests; documented operator limits |
| Expansion | Exception capture/grouping and release correlation; maintenance findings; permissioned recovery plans; additional collectors | Payload privacy/retention, source-map integrity, isolation and verified-resolution tests; evidence of recurring user need |
| Mature platform | Commercial hosting, multi-workspace isolation, scalable retention, regional checks, administration and support | Isolation audit, restore exercises, queue/outbox reliability, measured unit economics and operational ownership |

No milestone implies the next is delivered. Error tracking, automated remediation,
on-call paging and a production hosted service are outside this iteration. Keep
advanced release behavior opt-in; a standard release-only repository continues
to need only one workflow file.
