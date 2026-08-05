# Delayed release monitoring

Immediate verification runs after a release event. Delayed monitoring is a separate, opt-in action path for repositories that want a later observation after deployment or package workflows have had time to finish.

Enable it in `.semverge.yml`:

```yaml
health:
  enabled: true
  monitoring:
    enabled: true
    windowHours: 48
    comment: true
```

Then add an explicit scheduled or manually dispatched workflow:

```yaml
name: SemVerge delayed monitoring

on:
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:
    inputs:
      monitor-tag:
        description: Optional exact tag; blank monitors recent releases in the configured window.
        required: false
        type: string

permissions:
  contents: write
  issues: write
  actions: read

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - uses: EvanGribar/semverge@v0
        with:
          monitor-tag: ${{ inputs.monitor-tag }}
```

The workflow must be supplied by the repository; SemVerge does not schedule jobs. `windowHours` applies when no exact tag is supplied. A monitor run checks configured assets, links, and workflow conclusions, updates the durable release transaction when one is present, and adds one idempotent history comment to the associated SemVerge release PR. The comment marker includes the GitHub run ID so later scheduled observations form a readable history without duplicating retries.

Monitoring is fail-closed for configured checks. It does not infer rollback or hotfix events, delete releases, deploy applications, or create a frontend. GitHub permissions, deployment observability, and any provider-side evidence remain external gates.
