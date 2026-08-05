# Scheduled and coordinated release channels

Channel policies are an opt-in way to run more than one release line without creating a hosted SemVerge service. The repository still owns the GitHub Actions schedule, approvals, permissions, and branch protections.

```yaml
release:
  channels:
    nightly:
      label: ship:nightly
      prerelease: nightly
      branch: nightly
      baseBranch: release/1.x
      releaseBranch: semverge/release/nightly
      tagPrefix: nightly-v
```

The fields have deliberately separate responsibilities:

- `branch` is the source branch allowed to prepare this channel.
- `baseBranch` is the branch that receives the release pull request. It defaults to `branch` when a channel branch is configured, otherwise the repository default branch.
- `releaseBranch` is the maintained release pull-request head. It defaults to `release.branch`; set it when channels must have independent release PRs.
- `tagPrefix` overrides `release.tagPrefix` for this channel. It is also used when SemVerge finds the previous channel release and when it publishes the merged release.

## Scheduled or manual preparation

Pass the configured channel through the action input from an explicit repository workflow:

```yaml
name: Prepare nightly release

on:
  schedule:
    - cron: "17 2 * * *"
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  nightly:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: nightly
          fetch-depth: 0
      - uses: EvanGribar/semverge@main
        with:
          release-channel: nightly
```

The workflow's ref must be the channel's configured source branch. A scheduled or manually dispatched run with `release-channel` prepares or updates that channel's release PR. A scheduled or manually dispatched run without `release-channel` retains the existing delayed-monitoring behavior and does not prepare a release.

Channel preparation is still label-aware: a matching channel label can select a channel during a normal push, while an explicit `release-channel` input is authoritative for scheduled or manual preparation. An explicit channel that is not configured fails closed. No scheduler, dashboard, frontend, Vercel deployment, or registry credential is created by SemVerge.
