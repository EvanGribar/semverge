# Public consumer guide

SemVerge is a public GitHub Action and local CLI. A repository that is not
owned by EvanGribar can consume the action without access to this repository's
secrets or release branches.

## Stable action references

Use the moving `v0` ref for the supported major-zero action contract:

```yaml
- uses: EvanGribar/semverge@v0
```

For an immutable supply-chain pin, replace `v0` with the full commit SHA for a
published `v0.x.y` release. Do not use `@main` in a consumer workflow. The
repository release workflow advances `v0` only after a SemVerge release PR has
merged; versioned `v0.x.y` tags are the audit trail and are not reused.

## Minimum token permissions

The action's `github-token` input defaults to the workflow's built-in
`github.token`. Declare permissions explicitly in the consumer workflow:

| Use case | Required permissions |
| --- | --- |
| Read-only plan or `dry-run: true` | `contents: read`, `pull-requests: read` |
| Prepare release PRs and publish GitHub releases | `contents: write`, `pull-requests: write`, `actions: read` |
| Delayed monitoring with `health.monitoring.comment: true` | Add `issues: write` |
| Delayed monitoring with `health.monitoring.checkRun: true` | Add `checks: write` |
| npm provenance | Add `id-token: write` and configure the npm trusted publisher separately |
| A custom GHCR publish command | Add `packages: write` and configure the registry login separately |

The write permissions are only needed by the workflow that prepares or
publishes releases. A read-only plan does not create branches, pull requests,
tags, releases, comments, check runs, or registry side effects.

### Read-only external-consumer workflow

This is the smallest useful setup for validating an external repository:

```yaml
name: SemVerge plan

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  pull-requests: read

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: EvanGribar/semverge@v0
        with:
          github-token: ${{ github.token }}
          dry-run: 'true'
```

The checked-in [`fixtures/external-consumer`](../fixtures/external-consumer)
directory is the repository-owned proof of this setup. It intentionally has no
secrets and uses only read permissions.

### Release workflow permissions

For a repository that wants SemVerge to maintain a release PR and publish a
GitHub release, start with:

```yaml
permissions:
  contents: write
  pull-requests: write
  actions: read
```

If artifacts, package publication, or OCI publication is enabled, follow the
checkout and provider-specific permission requirements in the main
[`README.md`](../README.md). Keep provider credentials in the consumer
repository's secrets, never in a pull request from a fork.

## Fork and pull-request behavior

The repository's ordinary CI and security workflows run on `pull_request` with
read-oriented source access and do not require contributor secrets. The
write-capable release job runs on pushes to the default branch, published
releases, and merged pull requests only. A closed-but-unmerged fork pull
request is skipped before the SemVerge action starts, so untrusted changes do
not execute with release permissions.

Consumer repositories should keep the same boundary: run plans on
`pull_request`, and run publication from a protected default branch or a
merged release event. Do not use `pull_request_target` to execute code from an
untrusted pull request.

## Public contribution and support paths

- Use the [bug report](../.github/ISSUE_TEMPLATE/bug_report.yml) or [feature request](../.github/ISSUE_TEMPLATE/feature_request.yml) template for actionable public issues.
- Use [Discussions](https://github.com/EvanGribar/semverge/discussions) for setup questions and broader design conversations.
- Follow [`CONTRIBUTING.md`](../CONTRIBUTING.md) for tests, generated bundles, and fork PR expectations.
- Follow [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md) for community conduct.
- Use [`SECURITY.md`](../SECURITY.md) and GitHub's [private vulnerability reporting](https://github.com/EvanGribar/semverge/security/advisories/new) for security reports.

Marketplace publication is intentionally not part of the current distribution
contract. The repository has a valid `action.yml`, public tags, documentation,
and direct `uses:` consumption; a Marketplace listing can be added later as a
separate product/distribution decision.

## Repository protection policy

`main` is the protected integration branch. Changes should arrive through a
pull request with the CI `verify`, Security `codeql`, and Security
`dependency-review` checks passing, with linear history and resolved review
conversations. Administrators may use the documented GitHub bypass only for a
release or emergency repair. The moving `v0` tag is updated exclusively by the
release workflow after a release PR merge; published version tags remain the
immutable consumer audit references.
