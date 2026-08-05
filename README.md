# SemVerge

SemVerge is release automation that understands whether a release is ready and what customers need to know.

Its release PR is the control center for versioning, customer communication, migration requirements, and release readiness:

`detect changes -> choose version -> prepare release -> verify readiness -> communicate -> publish`

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
      # Required when artifacts.command, artifacts.paths, or npm publishing is enabled.
      - uses: actions/checkout@v4
        if: github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.merged == true)
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.merge_commit_sha || github.sha }}
      # Install the dependencies your build or publish command needs here.
      - uses: EvanGribar/semverge@v0
        # For a security-conscious pin, use a full commit SHA such as:
        # - uses: EvanGribar/semverge@c0a62caddd16e581b5a1bd3577540c54e0102739
```

On pushes to `main`, SemVerge reads conventional commits and merged pull requests, calculates the next semantic version, and maintains a release pull request. When that pull request merges, SemVerge verifies that the runner workspace is checked out at the exact merge commit, builds artifacts, records SHA-256 digests for configured assets, prepares a draft release, publishes configured npm packages, uploads assets, and only then publishes the GitHub release. A durable transaction marker in the release body records explicit phases and side effects, so retries resume completed steps, including a registry check that recognizes an already-published npm version and a digest check that rejects changed artifacts. The action's `transaction` output exposes the same state as JSON.

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
| `ship:rc` | Use the release-candidate prerelease channel |
| `ship:nightly` | Use the nightly prerelease channel |
| `ship:canary` | Use the canary prerelease channel |
| `ship:stable` | Explicitly promote the current prerelease to stable |

## Local CLI

The package includes a small deterministic local workflow for setup and troubleshooting:

```bash
npx semverge init       # create .semverge.yml without overwriting it
npx semverge plan "feat: add bulk export"
npx semverge explain "feat: add bulk export"
npx semverge migrate changesets  # inspect an existing release tool
npx semverge doctor     # report local setup, configuration, and hosted-release signals
npx semverge recover release_01J... --state .semverge/release-state.json
```

`init` is safe by default and requires `--force` to replace an existing file. `plan` prints the same release-plan shape used by the action, `explain` turns that plan into a human-readable decision and recovery guide, while `doctor` reports local package-manager, workspace, tag, release-tool, registry, build, workflow-permission, and configuration signals before a hosted run. It never prints auth settings and cannot prove provider-side eligibility. See [docs/doctor.md](docs/doctor.md).
`migrate` detects Release Please, Changesets, and semantic-release configuration and produces a conservative report; add `--write` only after reviewing it. `recover` prints the durable transaction state and safe next action. With `GITHUB_REPOSITORY` and a token it searches GitHub releases; `--state` is useful for a local exported marker or fixture. See [docs/migration.md](docs/migration.md).

The dependency-free [public site](website/README.md) is intended to be hosted from `website/` on Vercel. See [docs/vercel.md](docs/vercel.md) for the deployment boundary and Open Source Program evidence notes.

For independent workspaces, the plan and release PR include a release graph for every bumped package: direct changes, dependent-package propagation, and packages left unreleased by the current strategy are shown explicitly.

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
  # promotion: stable # promote the current prerelease without another prerelease bump

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
    idempotency: registry # registry or declared for custom commands

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

Stable promotion is explicit. Add `ship:stable` to a release-bearing change, or set `release.promotion: stable`, to turn a current version such as `1.4.0-beta.2` into `1.4.0`. The release PR, JSON manifest, local plan, explanation, and `release-channel`/`release-promotion` action outputs record the decision. Without that opt-in, configured prerelease channels continue to create the next prerelease version. When no `release.prerelease` is configured, `ship:beta`, `ship:rc`, `ship:nightly`, and `ship:canary` select their named channels; use one channel label per release.

The `health` configuration namespace provides immediate post-release verification: configured assets, documentation links, and workflow results visible after the publication transaction or on a `release.published` event. A workflow that has not started or completed is reported as a warning so the check can be rerun after it finishes. SemVerge does not infer rollback or hotfix signals from a single event; delayed monitoring is planned separately.

Configured commands and artifact commands run in the runner workspace. When artifacts or npm publishing are enabled, SemVerge requires `GITHUB_WORKSPACE` to be checked out at the merged release PR's exact `merge_commit_sha`; the workflow above provides that checkout. The zero-configuration path does not need a checkout. Standard `npm publish` uses `idempotency: registry` to query the exact package version before publishing. Custom commands must explicitly choose `idempotency: declared` when the command owns its own retry-safe behavior, or `idempotency: registry` when the npm registry check is appropriate.

## Plugin SDK

SemVerge now exports a versioned, explicitly registered lifecycle plugin contract with `analyze`, `plan`, `validate`, `prepare`, `build`, `publish`, `upload`, `announce`, `verify`, and `recover` hooks. Plugins return idempotent effect descriptors that can be owned by the durable transaction engine. See [docs/plugin-sdk.md](docs/plugin-sdk.md). The default action does not auto-load third-party code; configured plugin execution will be added behind an explicit trust boundary.

## Current scope

SemVerge is intentionally Node.js and GitHub first. The dependable path covers single packages, fixed and independent npm/pnpm workspaces, conventional commits, PR label overrides, version and lockfile updates, dependency-aware release graphs, changelog and release notes, readiness rules, idempotent npm publishing, artifacts, GitHub releases, and immediate post-release verification.

Python `pyproject.toml` and Rust `Cargo.toml` version adapters are available, but registry-specific publishing and delayed release monitoring are not claimed as finished product capabilities. This keeps the headline aligned with what the repository currently proves.

## Development

```bash
pnpm install
pnpm verify
```

The action bundle in `dist/` is generated with `pnpm bundle` and is committed because GitHub executes JavaScript actions from the repository contents.

SemVerge does not use AI to create release communication. It uses explicit PR metadata, labels, and conventional commits with deterministic templates.
