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
- Checked-in single-package, fixed-pnpm, independent-workspace, retry, and large-repository fixtures for deterministic end-to-end proof
- Explicit stable promotion from a prerelease, with channel and promotion decisions recorded in plans, release PRs, manifests, explanations, and action outputs

## Follow-on slices

1. Richer channel policies, including coordinated release candidates, nightly builds, and canary behavior.
2. Python and Rust workspace discovery and publishing integrations.
3. Richer independent-package dependency policies, including peer and optional dependency semantics.
4. More artifact transports and registry-specific publishing adapters.
5. Delayed release monitoring and history comments/check runs without growing into an analytics dashboard.

Advanced behavior should remain opt-in. A standard repository should continue to need only one workflow file.
