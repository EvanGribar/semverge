# Fixture repository proof

The repositories under `fixtures/` are small, checked-in examples used by `tests/fixture-repos.test.ts`:

- `node-single` exercises the local CLI against a conventional single-package repository.
- `pnpm-fixed` exercises fixed-version package discovery through `pnpm-workspace.yaml` and a pnpm lockfile.
- `node-independent` exercises `apps/*` discovery, independent versioning, and propagation through an ordinary internal dependency range.
- `tests/packages-workspace.test.ts` also covers native Python `uv`/PDM and Rust Cargo workspace member discovery and version planning; those cases remain synthetic because there is no live registry proof in the fixture suite.
- `tests/registries.test.ts` covers exact-version PyPI and crates.io response handling, while `tests/publish-action.test.ts` covers a configured Python publication command through the durable transaction; these tests do not publish to either registry.
- `node-retry` supplies a deliberately failing publish command so the action test can verify a draft release resumes safely on retry.
- `node-large` contains 101 generated files so planning is exercised beyond the common 100-item API page size.

The publication tests also use a test-only `SEMVERGE_TEST_FAILURE` seam for deterministic side-effect failure injection. It is active only under `NODE_ENV=test`, covers package publication, asset upload, release finalization, and post-release verification, and cannot be enabled by a normal hosted action run. The retry cases prove that failed or interrupted steps reuse the existing draft, do not duplicate the release, and eventually complete the transaction.

Run the proof locally with:

```bash
pnpm test -- tests/fixture-repos.test.ts
```

These fixtures prove deterministic repository-owned behavior. The retry case uses mocked GitHub responses and a local command, while the large case proves planning over 101 changed files; neither substitutes for live event pagination or registry behavior. The fixtures do not prove GitHub event delivery, npm credentials, hosted workflow timing, preview authentication, or adoption by outside repositories. Those remain explicit external proof gates before calling SemVerge production-trustworthy.
