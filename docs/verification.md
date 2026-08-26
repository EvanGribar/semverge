# Release verification

SemVerge can verify a published release without changing the repository or provider state:

```bash
npx semverge verify v2.4.0
npx semverge verify https://github.com/acme/project/releases/tag/v2.4.0 --json
npx semverge verify release_01J... --state .semverge/release-state/release_01J....json
```

The command binds the requested version or tag to the durable release transaction and checks the evidence that the transaction recorded:

- the transaction is complete and published;
- the Git tag resolves to the recorded source commit;
- every recorded artifact digest matches the GitHub release asset, or the local artifact in state-only mode;
- each recorded npm, PyPI, and crates.io package version exists;
- npm provenance claims have registry attestation evidence;
- each recorded OCI image tag has the recorded content digest; releases without that evidence are reported as incomplete rather than verified.

The default output is intended for people. `--json` emits a stable report with an overall `status` and one ordered `evidence` item for every check. Evidence statuses are:

- `verified`: the observed evidence matches the transaction;
- `mismatch`: evidence contradicts the transaction and the release is not verified;
- `unavailable`: a required provider or local file could not be checked;
- `not-applicable`: the transaction did not claim that kind of evidence.

The command exits with `0` only when no required check mismatches or is unavailable. It exits with `1` for an integrity mismatch and `2` when verification is incomplete because evidence is unavailable. A missing provider capability is never reported as verified.

Hosted verification uses `GITHUB_REPOSITORY` and `GITHUB_TOKEN` (or `INPUT_GITHUB_TOKEN`) to read the release, tag, manifest, and assets. `--state` forces local, read-only verification from a JSON transaction or release-body marker and is useful in CI fixtures or after exporting a transaction for offline inspection. Local verification still requires a Git checkout for the tag/source check and the recorded artifacts for digest checks.
