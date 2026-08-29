# SemVerge product roadmap

## Positioning

SemVerge is release automation that understands whether a release is ready and what customers need to know. Its release PR is the control center for versioning, communication, migration requirements, and readiness; it is not a launch-management workspace.

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
- Configurable npm publishing, release artifacts, immediate post-release verification, and a local CLI (`init`, `plan`, `doctor`)
- Explicit durable release transactions with monotonic phases, idempotent side-effect events, failure recording, legacy-marker upgrades, release-body summaries, SHA-256 artifact digests, and `recover` inspection
- Test-only deterministic failure injection for package publication, asset upload, finalization, and post-release verification, with retry coverage for build, package, asset, finalization, and verification failures
- Versioned, explicitly registered plugin SDK contract with lifecycle hooks and idempotent effect descriptors
- Human-readable local `explain` output for version decisions, readiness blockers, merge behavior, and transaction recovery
- Report-first migration diagnostics for Release Please, Changesets, and semantic-release with explicit opt-in config writing
- Read-only setup diagnostics for package managers, workspaces, tags, release tools, build hooks, registries, and workflow permissions
- Optional dependency-free static project surface with versioned Vercel configuration; the release engine has no frontend or hosting dependency
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

## Follow-on slices

1. Scheduled and coordinated channel policies for release candidates, nightly builds, and canary behavior.
2. More artifact transports and registry-specific publishing adapters.
3. Richer release history signals without growing into an analytics dashboard.

Advanced behavior should remain opt-in. A standard repository should continue to need only one workflow file.
