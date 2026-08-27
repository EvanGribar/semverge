# Contributing to SemVerge

## Local checks

Install the locked dependencies and run the same bundle verification used by CI:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm test -- tests/fixture-repos.test.ts
```

The checked-in files under `dist/` are part of the GitHub Action. Run `pnpm
bundle` after changing action code and make sure the generated bundle and source
map are committed. If `actionlint` is installed locally, run it from the
repository root before opening a workflow change.

## Public pull requests

Contributors may work from a fork. The `pull_request` CI and security checks
do not depend on contributor secrets, and the release workflow skips closed
pull requests that were not merged before invoking its write-capable action.
Do not add `pull_request_target` steps that execute fork code with write
permissions. Use the pull-request template to record the issue, verification,
generated bundle, and permission impact.

Questions and setup help belong in [GitHub Discussions](https://github.com/EvanGribar/semverge/discussions); reproducible bugs and bounded feature requests belong in the issue templates.

## Scope and proof

Keep release behavior deterministic and bounded. Unit tests and fixture
repositories prove repository-owned behavior only; they do not prove GitHub
event delivery, provider credentials, hosted timing, preview authentication,
or outside-repository adoption. Document those external gates instead of
turning local fixtures into claims about them.
