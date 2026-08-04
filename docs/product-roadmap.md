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
- Prerelease channels, fixed/independent npm and pnpm workspaces, Python and Rust version adapters
- Configurable npm publishing, release artifacts, immediate post-release verification, and a local CLI (`init`, `plan`, `doctor`)
- Explainable per-package release graphs in release PRs and manifests, including direct changes, dependency propagation, and unreleased packages
- Checked-in single-package, fixed-pnpm, independent-workspace, retry, and large-repository fixtures for deterministic end-to-end proof

## Follow-on slices

1. Explicit promotion from prerelease to stable and richer channel policies.
2. Python and Rust workspace discovery and publishing integrations.
3. Richer independent-package dependency policies, including peer and optional dependency semantics.
4. More artifact transports and registry-specific publishing adapters.
5. Delayed release monitoring and history comments/check runs without growing into an analytics dashboard.

Advanced behavior should remain opt-in. A standard repository should continue to need only one workflow file.
