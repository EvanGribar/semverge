# Shipkit product roadmap

## Positioning

Shipkit is the easiest way to version, prepare, and publish a software release on GitHub. It is a release path, not a launch-management workspace.

## v1 foundation

- Node.js single-package repositories
- Conventional commit parsing
- Product-aware PR label overrides
- Optional structured PR metadata
- Semantic version selection
- `package.json` and npm lockfile version updates
- Release PR maintenance
- `CHANGELOG.md`, customer-facing notes, internal notes, migration notes, and a JSON manifest
- Required-label and required-file readiness checks
- Git tag and GitHub release publication

## Follow-on slices

1. Prerelease channel progression and explicit promotion from prerelease to stable.
2. Python and Rust version-file adapters.
3. Fixed-version monorepos with a single coordinated release.
4. Independent-package monorepos with bounded dependency propagation.
5. npm publishing and artifact upload integrations.
6. Lightweight post-release health checks for expected jobs, artifacts, links, rollback signals, and rapid hotfixes.

Advanced behavior should remain opt-in. A standard repository should continue to need only one workflow file.
