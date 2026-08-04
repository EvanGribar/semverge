# Fixture repository proof

The repositories under `fixtures/` are small, checked-in examples used by `tests/fixture-repos.test.ts`:

- `node-single` exercises the local CLI against a conventional single-package repository.
- `node-independent` exercises `apps/*` discovery, independent versioning, and propagation through an ordinary internal dependency range.

Run the proof locally with:

```bash
pnpm test -- tests/fixture-repos.test.ts
```

These fixtures prove deterministic repository-owned behavior. They do not prove GitHub event delivery, npm credentials, hosted workflow timing, preview authentication, or adoption by outside repositories. Those remain explicit external proof gates before calling SemVerge production-trustworthy.
