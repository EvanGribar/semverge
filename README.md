# SemVerge

SemVerge is the easiest way to version, prepare, and publish a software release on GitHub.

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

concurrency:
  group: semverge-${{ github.repository }}
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write
  actions: read

jobs:
  semverge:
    runs-on: ubuntu-latest
    steps:
      - uses: EvanGribar/semverge@v0.1.4
```

On pushes to `main`, SemVerge reads conventional commits and merged pull requests, calculates the next semantic version, and maintains a release pull request. When that pull request merges, SemVerge builds artifacts, prepares a draft release, publishes configured packages, uploads assets, and only then publishes the GitHub release. A durable progress marker in the draft release lets retries resume completed steps.

The default repository needs no configuration. SemVerge also understands product-oriented labels:

| Label | Meaning |
| --- | --- |
| `ship:feature` | Minor release and customer-facing feature |
| `ship:fix` | Patch release and customer-facing fix |
| `ship:breaking` | Major release and breaking-change section |
| `ship:internal` | Internal-only change |
| `ship:docs` | Documentation-only change |
| `ship:skip` | Exclude the pull request from a release |
| `ship:beta` | Use the beta prerelease channel |

## Local CLI

The package includes a small deterministic local workflow for setup and troubleshooting:

```bash
npx semverge init       # create .semverge.yml without overwriting it
npx semverge plan "feat: add bulk export"
npx semverge doctor     # validate package.json and configuration
```

`init` is safe by default and requires `--force` to replace an existing file. `plan` prints the same release-plan shape used by the action, while `doctor` reports configuration type errors before a hosted run.

Structured pull-request metadata is optional. Add this hidden block to a pull-request body when the conventional commit is not expressive enough:

```md
<!-- semverge
type: feature
customer: Add bulk export for projects.
migration: Existing exports continue to work without changes.
-->
```

## Optional configuration

Create `.semverge.yml` only when the defaults need changing:

```yaml
release:
  branch: semverge/release
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
  internalSummary: .semverge/internal-release.md
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
```

Readiness checks are reported in the release PR. A missing required label or file blocks publication but does not hide the proposed version or generated communication.

The `health` configuration namespace is retained for compatibility, but the `release.published` check is currently limited to immediate post-release verification: configured assets, documentation links, and workflow results visible at that moment. A workflow that has not started or completed is reported as a warning so the check can be rerun after it finishes. SemVerge does not infer rollback or hotfix signals from a single event; delayed monitoring is planned separately.

Configured commands and artifact commands run in the runner workspace. The zero-configuration API path does not need a checkout; add `actions/checkout` before SemVerge when a command needs the repository files.

## Current scope

The current foundation supports Node.js single-package repositories, fixed and independent npm workspaces with bounded workspace-dependency propagation, Python `pyproject.toml`, Rust `Cargo.toml`, conventional commits, PR label overrides, version and lockfile updates, changelog/release notes, release PRs, tags, GitHub releases, readiness rules, npm publishing commands, configurable artifacts, immediate post-release verification, and a JSON release manifest. Delayed monitoring and richer ecosystem-specific publishing remain deliberately bounded follow-on work.

## Development

```bash
pnpm install
pnpm verify
```

The action bundle in `dist/` is generated with `pnpm bundle` and is committed because GitHub executes JavaScript actions from the repository contents.

SemVerge does not use AI to create release communication. It uses explicit PR metadata, labels, and conventional commits with deterministic templates.
