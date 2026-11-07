# SemVerge

**Release automation for Node.js repositories on GitHub.**

SemVerge is a GitHub Action for planning and publishing releases, with a CLI available to developers building from source. It reads changes, selects semantic versions, prepares a release pull request, checks configured readiness requirements, and generates release notes. Publishing happens through explicitly permissioned workflows.

The initial use case is Node.js projects using GitHub and npm or pnpm. Other package managers, registries, monorepos, and release channels have additional configuration and provider-dependent verification.

## Get started

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


## Local CLI (source checkout only)

**The CLI is not published to npm.** The supported installation for consumers is the GitHub Action above. For local CLI development, clone and build the source:

```sh
git clone https://github.com/EvanGribar/semverge.git
cd semverge
pnpm install --frozen-lockfile
pnpm build
node lib/cli.js --help
node lib/cli.js doctor
```

To inspect a different repository, run `node /absolute/path/to/semverge/lib/cli.js doctor` from that repository's working directory. Do not use `npx semverge` until an npm CLI package is actually published and verified. The source CLI also supports planning, migrations, recovery, and evidence verification; see the [reference](docs/REFERENCE.md).

## What you can configure

- Version selection and prerelease channels.
- Required labels, files, and tests before publication.
- Generated changelogs, release notes, and migration guidance.
- Optional artifact publishing to supported registries.
- Recovery and post-release verification where provider evidence is accessible.

AI-generated release communication is optional and disabled by default. The release decision and evidence checks are deterministic rather than delegated to a model.

## Documentation

- [Public installation, permissions and security boundaries](docs/public-consumer.md)
- [Configuration, CLI, plugins and development reference](docs/REFERENCE.md)
- [Release verification](docs/verification.md) and [recovery behavior](docs/monitoring.md)
- [Supported registries and provider restrictions](docs/registries.md)
- [Historical provider proof log](docs/live-provider-proof.md)
- [Contribution guide](CONTRIBUTING.md) · [Security policy](SECURITY.md)

## Development

```sh
pnpm install
pnpm verify
```

SemVerge is an independent open-source project. Its feature list describes code paths and supported configuration; live outcomes and external adoption should be judged from accessible releases, reproducible tests, and independently inspectable evidence.
