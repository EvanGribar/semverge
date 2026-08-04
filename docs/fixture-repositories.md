# Fixture repository proof

The repositories under `fixtures/` are small, checked-in examples used by `tests/fixture-repos.test.ts`:

- `node-single` exercises the local CLI against a conventional single-package repository.
- `pnpm-fixed` exercises fixed-version package discovery through `pnpm-workspace.yaml` and a pnpm lockfile.
- `node-independent` exercises `apps/*` discovery, independent versioning, and propagation through an ordinary internal dependency range.
- `node-retry` supplies a deliberately failing publish command so the action test can verify a draft release resumes safely on retry.
- `node-large` contains 101 generated files so planning is exercised beyond the common 100-item API page size.

Run the proof locally with:

```bash
pnpm test -- tests/fixture-repos.test.ts
```

These fixtures prove deterministic repository-owned behavior. The retry case uses mocked GitHub responses and a local command, while the large case proves planning over 101 changed files; neither substitutes for live event pagination or registry behavior. The fixtures do not prove GitHub event delivery, npm credentials, hosted workflow timing, preview authentication, or adoption by outside repositories. Those remain explicit external proof gates before calling SemVerge production-trustworthy.
