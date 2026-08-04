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

## Scope and proof

Keep release behavior deterministic and bounded. Unit tests and fixture
repositories prove repository-owned behavior only; they do not prove GitHub
event delivery, provider credentials, hosted timing, preview authentication,
or outside-repository adoption. Document those external gates instead of
turning local fixtures into claims about them.
