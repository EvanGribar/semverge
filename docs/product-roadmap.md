# Shipkit product roadmap

## Positioning

Shipkit is the easiest way to version, prepare, and publish a software release on GitHub. It is a release path, not a launch-management workspace.

## Delivered foundation

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
- Prerelease channels, fixed/independent npm workspaces, Python and Rust version adapters
- Configurable npm publishing, release artifacts, and lightweight post-release health checks

## Follow-on slices

1. Explicit promotion from prerelease to stable and richer channel policies.
2. Python and Rust workspace discovery and publishing integrations.
3. Independent-package dependency propagation based on workspace metadata.
4. More artifact transports and registry-specific publishing adapters.
5. Health history comments/check runs without growing into an analytics dashboard.

Advanced behavior should remain opt-in. A standard repository should continue to need only one workflow file.
