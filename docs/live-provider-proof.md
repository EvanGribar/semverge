# SemVerge Live Provider Publishing & Recovery Proof

This document records historical attempts at publishing and recovery verification across provider registries. Some linked proof repositories and run artifacts are no longer accessible through the connected GitHub account as of November 2026. Treat the claims below as a historical execution record, **not independently verified live proof**, until the linked logs can be accessed or the tests are rerun. In particular, npm and PyPI were not successfully verified in the recorded attempts.

---

## 1. GHCR (GitHub Packages OCI Registry) — historical record

### Overview
The original run notes report that SemVerge logged in, built, tagged, and pushed OCI container images to `ghcr.io` under registry-based idempotency checks. Those notes describe a recovery exercise in which a failure occurred immediately after the image is accepted by the registry but before the GitHub release transaction completes, a subsequent rerun was reported to detect the existing image version in GHCR, skip duplicate image pushes, resume transaction state, and finalize the release draft.

### Proof Artifacts & Run History
- **Repository**: [`EvanGribar/semverge-proof-ghcr`](https://github.com/EvanGribar/semverge-proof-ghcr)
- **Target Image**: `ghcr.io/evangribar/semverge-proof-ghcr:0.7.0`
- **Verification Run Logs**:
  - **Baseline Publish (Success)**: [Run 31063427624](https://github.com/EvanGribar/semverge-proof-ghcr/actions/runs/31063427624) — Real publication of version `0.5.0` to GHCR.
  - **Interrupted Release Run (Failed)**: [Run 31063565688](https://github.com/EvanGribar/semverge-proof-ghcr/actions/runs/31063565688) / [Run 31063644044](https://github.com/EvanGribar/semverge-proof-ghcr/actions/runs/31063644044) — Image successfully built and pushed to GHCR, then aborted on the `release-finalize` phase via failure injection.
  - **Recovery & Resumption Run (Success)**: [Rerun 31063644044](https://github.com/EvanGribar/semverge-proof-ghcr/actions/runs/31063644044) — Rerun without failure injection. SemVerge detected the version `0.7.0` in the OCI registry, output `Found ghcr.io/evangribar/semverge-proof-ghcr:0.7.0 in the OCI registry; treating publication as already complete.`, skipped publication, and successfully completed the GitHub release.

### Verified Transaction Log State
During the recovery run, the transaction log was parsed from the draft release body and successfully completed:
```json
{
  "phase": "completed",
  "version": "0.7.0",
  "published": true,
  "ready": true,
  "publishedOciImages": [
    "ghcr.io/evangribar/semverge-proof-ghcr"
  ],
  "events": [
    { "key": "approval", "kind": "approval-verified", "status": "completed" },
    { "key": "release-inputs", "kind": "release-plan-prepared", "status": "completed" },
    { "key": "artifact-build", "kind": "artifacts-built", "status": "completed" },
    { "key": "draft:v0.7.0", "kind": "release-draft-prepared", "status": "completed" },
    { "key": "oci:ghcr.io/evangribar/semverge-proof-ghcr", "kind": "oci-image-published", "status": "completed", "detail": "The OCI registry already contains the requested image tag; no duplicate push was attempted." },
    { "key": "release-ready", "kind": "release-ready", "status": "completed" },
    { "key": "release-published", "kind": "release-published", "status": "completed" }
  ]
}
```

---

## 2. npm, PyPI, and crates.io Provider Status

During execution against public package registries, the configured GitHub repository secrets (`NPM_TOKEN` and `PYPI_TOKEN`) returned authorization/credentials errors from the registries:

- **npm**: [`npm publish` failed with 401 Unauthorized](https://github.com/EvanGribar/semverge-proof-npm/actions/runs/31062967564) during PUT. Scoping the package to `@evangribar` also failed due to unauthorized credentials.
- **PyPI**: [`twine upload` failed with 403 Forbidden](https://github.com/EvanGribar/semverge-proof-pypi/actions/runs/31063358675) ("Invalid or non-existent authentication information").

### Next Steps for Package Registry Verification
To prove NPM, PyPI, and crates.io live publishes, account-wide/valid tokens or Test registries need to be configured in the repository secrets. Once new credentials are supplied, the workflows are fully configured and ready to execute and recover immediately.
