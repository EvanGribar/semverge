# SemVerge

## Release automation for GitHub that knows when you're actually ready to ship

SemVerge automates versioning, readiness checks, customer-facing release notes, and artifact publication for Node.js projects on GitHub.

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
    if: github.event_name != 'pull_request' || github.event.pull_request.merged == true
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
        # - uses: EvanGribar/semverge@c95260d02a27d3555b727388b58415f533386895
```

On pushes to `main`, SemVerge reads conventional commits and merged pull requests, calculates the next semantic version, and maintains a release pull request. When that pull request merges, it verifies the exact merge commit, runs the configured readiness checks, builds artifacts, records digests, and publishes the release only after the transaction is complete. The action's `transaction` output exposes durable state for recovery and inspection.

For a read-only external plan, use `contents: read`, `pull-requests: read`, and `dry-run: true`. For release preparation and publication, use the write permissions shown above. See [docs/public-consumer.md](docs/public-consumer.md) for the complete permission matrix, fork behavior, stable-ref policy, and external-consumer fixture.

The clearest adoption path is **Node.js + GitHub + npm/pnpm**. Additional registries, release channels, monorepo modes, and OCI workflows are available in the configuration and adapter documentation, but the core promise stays simple: make releases safer and easier to explain.

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
npx semverge verify v1.2.3       # verify a published release and its recorded evidence
npx semverge verify v1.2.3 --json # emit a deterministic CI-friendly report
```

`init` is safe by default and requires `--force` to replace an existing file. `plan` prints the same release-plan shape used by the action, `explain` turns that plan into a human-readable decision and recovery guide, while `doctor` reports local package-manager, workspace, tag, release-tool, registry, build, workflow-permission, and configuration signals before a hosted run. It never prints auth settings and cannot prove provider-side eligibility. See [docs/doctor.md](docs/doctor.md).
`migrate` detects Release Please, Changesets, and semantic-release configuration and produces a conservative report; add `--write` only after reviewing it. `recover` prints the durable transaction state and safe next action. `verify` is read-only: it checks the transaction, source tag, recorded artifact digests, GitHub release assets, configured package registries, npm provenance evidence, and recorded OCI digests where those providers are available. Its report distinguishes `verified`, `mismatch`, `unavailable`, and `not-applicable`; it exits `0` for a complete verification, `1` for integrity mismatches, and `2` when required provider evidence is unavailable. With `GITHUB_REPOSITORY` and a token it verifies the hosted release; `--state` is useful for a local exported marker or fixture. See [docs/verification.md](docs/verification.md) and [docs/migration.md](docs/migration.md).

The optional dependency-free [project surface](website/README.md) is Vercel-compatible but not hosted or required. See [docs/vercel.md](docs/vercel.md) for the current no-deployment boundary.

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
  channels:
    preview:
      label: ship:preview
      prerelease: preview
    nightly:
      label: ship:nightly
      prerelease: nightly
      branch: nightly
      baseBranch: release/1.x
      releaseBranch: semverge/release/nightly
      tagPrefix: nightly-v

monorepo:
  mode: auto # auto, fixed, or independent
  packages: [packages/*]
  includeRoot: true
  unscopedChanges: all
  # Advanced independent-workspace policy. Defaults preserve runtime links as patch
  # releases and keep development-only links from releasing dependents.
  dependencyPolicy:
    dependencies: patch
    devDependencies: none
    peerDependencies: patch
    optionalDependencies: patch

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
    # provenance: true     # opt in only with GitHub Actions OIDC and id-token: write
  python:
    enabled: false
    command: python -m twine upload dist/*
    idempotency: registry # checks the exact PyPI version before publishing
  rust:
    enabled: false
    command: cargo publish --locked
    idempotency: registry # checks the exact crates.io version before publishing
  oci:
    enabled: false
    images: [ghcr.io/acme/semverge]
    command: docker push {image}:{version}
    idempotency: registry # checks the exact OCI image tag before pushing

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

AI assistance is disabled by default. The explicit `assist` command can request advisory release communication through the BYOK provider layer without changing the deterministic release plan. See [docs/ai.md](docs/ai.md) for the data envelope, environment credential, timeout, and fallback contract.

Readiness checks are reported in the release PR. A missing required label or file blocks publication but does not hide the proposed version or generated communication.

Stable promotion is explicit. Add `ship:stable` to a release-bearing change, or set `release.promotion: stable`, to turn a current version such as `1.4.0-beta.2` into `1.4.0`. The release PR, JSON manifest, local plan, explanation, and `release-channel`/`release-promotion` action outputs record the decision. Without that opt-in, configured prerelease channels continue to create the next prerelease version. When no `release.prerelease` is configured, `ship:beta`, `ship:rc`, `ship:nightly`, and `ship:canary` select their named channels; use one channel label per release.

`release.channels` extends or overrides those built-in channel policies. Each policy supplies a label and prerelease identifier. An optional `branch` limits preparation to pushes from that branch; `baseBranch` selects the release PR target, `releaseBranch` isolates the release PR head, and `tagPrefix` gives the channel its own tag namespace. The action's `release-channel` input enables explicit scheduled or manually dispatched preparation; workflows still own the scheduler and must check out the configured source branch. See [docs/channels.md](docs/channels.md). Channel policies do not create a hosted scheduler or publish to a registry by themselves.

Independent workspaces use `monorepo.dependencyPolicy` to decide which internal dependency fields release a dependent package and at what bump level (`none`, `patch`, `minor`, or `major`). `dependencies`, `optionalDependencies`, and `peerDependencies` default to patch propagation; `devDependencies` default to no dependent release. Internal ranges and lockfiles still follow released package versions, while the release manifest records the dependency field that caused each propagated release. Range rewrites support exact, caret, tilde, and corresponding `workspace:` forms; wildcard workspace protocols are preserved, and compound or unsupported ranges fail the release plan with an actionable error instead of being partially rewritten.

The `health` configuration namespace provides immediate post-release verification: configured assets, documentation links, and workflow results visible after the publication transaction or on a `release.published` event. A workflow that has not started or completed is reported as a warning so the check can be rerun after it finishes. `health.monitoring` is a separate opt-in for an explicit scheduled or manually dispatched workflow; it can inspect one `monitor-tag` or recent semantic releases and append an idempotent observation comment and optional check run to the release PR/commit. SemVerge does not create a scheduler, dashboard, or hosted surface.

See [docs/monitoring.md](docs/monitoring.md) for the explicit workflow and permission contract.

Configured commands and artifact commands run in the runner workspace. When artifacts, registry publishing, or OCI image publishing is enabled, SemVerge requires `GITHUB_WORKSPACE` to be checked out at the merged release PR's exact `merge_commit_sha`; the workflow above provides that checkout. The zero-configuration path does not need a checkout. Standard `npm publish` uses `idempotency: registry` to query the exact package version before publishing. Opt-in Python publishing checks PyPI's JSON release metadata, Rust publishing checks the exact crates.io version endpoint, and OCI publishing checks the exact image manifest tag with bearer-challenge support. Custom commands must explicitly choose `idempotency: declared` when the command owns its own retry-safe behavior, or `idempotency: registry` when SemVerge's registry check is appropriate. OCI targets are release-level and currently support single/fixed workspaces; independent image mappings remain a planned extension.

Set `publishing.npm.provenance: true` only when the built-in `npm publish` command is enabled in a GitHub Actions workflow with `id-token: write` and an npm trusted publisher configured. SemVerge appends `--provenance`, requires the OIDC runtime evidence before any release side effect, and binds the choice into the durable transaction so a retry cannot silently change publication policy. It does not configure npm, grant workflow permissions, or prove provider-side eligibility; leave this disabled until those external gates are deliberately set up.

## Plugin SDK

SemVerge now exports a versioned, explicitly registered lifecycle plugin contract with `analyze`, `plan`, `validate`, `prepare`, `build`, `publish`, `upload`, `announce`, `verify`, and `recover` hooks. Plugins return idempotent effect descriptors that can be owned by the durable transaction engine. See [docs/plugin-sdk.md](docs/plugin-sdk.md). The default action does not auto-load third-party code; configured plugin execution will be added behind an explicit trust boundary.

## Current scope

SemVerge is intentionally Node.js and GitHub first. The dependable path covers single packages, fixed and independent npm/pnpm workspaces, conventional commits, PR label overrides, version and lockfile updates, dependency-aware release graphs, changelog and release notes, readiness rules, idempotent npm/PyPI/crates.io publishing, opt-in OCI image publication, artifacts, GitHub releases, and immediate post-release verification.

Python `pyproject.toml` and Rust `Cargo.toml` package/workspace discovery, deterministic version planning, opt-in registry-specific publication commands, OCI tag checks, and explicit delayed monitoring are available. Live credentials, provider-side trusted publishing, registry acceptance, image builds, and deployment behavior remain external proof gates.

See [docs/registries.md](docs/registries.md) for the built-in adapter contracts and fail-closed idempotency behavior.

## Development

```bash
pnpm install
pnpm verify
```

The action bundle in `dist/` is generated with `pnpm bundle` and is committed because GitHub executes JavaScript actions from the repository contents.

SemVerge's release engine uses explicit PR metadata, labels, and conventional commits with deterministic templates. Optional AI assistance is isolated behind the explicit `assist` feature and can only suggest human-facing communication; it cannot change release decisions.

## Agent Quickstart

If you are developing this repository using an AI coding assistant (like Antigravity), copy and paste the prompt below to immediately boot the agent with full context, rules, and commands:

```text
Initialize your development session for the SemVerge repository. 
Read the repository guidelines in `.agents/rules/semverge.md` and load the workflows skill in `.agents/skills/semverge-workflows/SKILL.md` before making any changes. 
Verify your setup by running the test suite: `npm run test`.
```

