# Shipkit

Shipkit is the easiest way to version, prepare, and publish a software release on GitHub.

It owns the complete release path:

`detect changes → choose version → prepare release → verify readiness → generate communication → publish`

## Quick start

Add one workflow file to a Node.js repository:

```yaml
name: Release

on:
  push:
    branches: [main]
  pull_request:
    types: [closed]
  release:
    types: [published]

permissions:
  contents: write
  pull-requests: write
  actions: read

jobs:
  shipkit:
    runs-on: ubuntu-latest
    steps:
      - uses: EvanGribar/ShipKit@v0.1.0
```

On pushes to `main`, Shipkit reads conventional commits and merged pull requests, calculates the next semantic version, and maintains a release pull request. When that pull request merges, Shipkit creates the tag and GitHub release.

The default repository needs no configuration. Shipkit also understands product-oriented labels:

| Label | Meaning |
| --- | --- |
| `ship:feature` | Minor release and customer-facing feature |
| `ship:fix` | Patch release and customer-facing fix |
| `ship:breaking` | Major release and breaking-change section |
| `ship:internal` | Internal-only change |
| `ship:docs` | Documentation-only change |
| `ship:skip` | Exclude the pull request from a release |
| `ship:beta` | Use the beta prerelease channel |

Structured pull-request metadata is optional. Add this hidden block to a pull-request body when the conventional commit is not expressive enough:

```md
<!-- shipkit
type: feature
customer: Add bulk export for projects.
migration: Existing exports continue to work without changes.
-->
```

## Optional configuration

Create `.shipkit.yml` only when the defaults need changing:

```yaml
release:
  branch: shipkit/release
  tagPrefix: v
  independentTagPrefix: pkg-
  prerelease: beta

monorepo:
  mode: auto # auto, fixed, or independent
  packages: [packages/*]
  includeRoot: true
  unscopedChanges: all

readiness:
  requiredLabels: [ship:ready]
  requiredFiles: [docs/migrations/latest.md]
  commands:
    - name: tests
      run: npm test
  tasks:
    - name: docs
      file: docs/migrations/latest.md

outputs:
  changelog: CHANGELOG.md
  customerNotes: RELEASE_NOTES.md
  migrationGuide: MIGRATION.md
  internalSummary: .shipkit/internal-release.md
  manifest: release-manifest.json

artifacts:
  command: npm run build
  paths: [dist, build.zip]

publishing:
  npm:
    enabled: false
    command: npm publish

health:
  enabled: true
  expectedArtifacts: [build.zip]
  requiredLinks: [https://docs.example.com/releases/latest]
  workflows:
    - name: Publish package
      purpose: package
    - name: Deploy production
      purpose: deployment
    - name: Rollback production
      purpose: rollback
```

Readiness checks are reported in the release PR. A missing required label or file blocks publication but does not hide the proposed version or generated communication.

Configured commands and artifact commands run in the runner workspace. The zero-configuration API path does not need a checkout; add `actions/checkout` before Shipkit when a command needs the repository files.

## Current scope

The current foundation supports Node.js single-package repositories, fixed and independent npm workspaces with bounded workspace-dependency propagation, Python `pyproject.toml`, Rust `Cargo.toml`, conventional commits, PR label overrides, version and lockfile updates, changelog/release notes, release PRs, tags, GitHub releases, readiness rules, npm publishing commands, configurable artifacts, release-health checks, and a JSON release manifest. Richer ecosystem-specific publishing remains deliberately bounded follow-on work.

## Development

```bash
pnpm install
pnpm verify
```

The action bundle in `dist/` is generated with `pnpm bundle` and is committed because GitHub executes JavaScript actions from the repository contents.

Shipkit does not use AI to create release communication. It uses explicit PR metadata, labels, and conventional commits with deterministic templates.
