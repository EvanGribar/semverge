# Registry publishing adapters

SemVerge keeps registry publication opt-in. The default configuration leaves npm, PyPI, and crates.io disabled, so planning and GitHub release preparation do not contact a package registry or require registry credentials.

## Supported built-ins

| Package manifest | Registry | Default command | Registry idempotency check |
| --- | --- | --- | --- |
| `package.json` | npm | `npm publish` | `npm view <name>@<version> version --json` |
| `pyproject.toml` | PyPI | `python -m twine upload dist/*` | PyPI JSON release metadata |
| `Cargo.toml` | crates.io | `cargo publish --locked` | Exact crates.io version endpoint |
| configured OCI repository | Docker/OCI registry | `docker push {image}:{version}` | Exact OCI manifest tag, with bearer challenge support |

Enable only the ecosystem that the workflow is prepared to publish:

```yaml
publishing:
  python:
    enabled: true
    command: python -m twine upload dist/*
    idempotency: registry
  rust:
    enabled: true
    command: cargo publish --locked
    idempotency: registry
  oci:
    enabled: true
    images: [ghcr.io/acme/semverge]
    command: docker push {image}:{version}
    idempotency: registry
```

The built-in defaults query the exact package version before invoking a publish command. A `404` means the version is not present; other registry errors fail closed so a transient outage cannot be mistaken for an unpublished version. Custom commands must declare `idempotency: declared` when they own their retry-safe behavior, or `registry` only when the selected registry check is still appropriate.

Publication commands run from each released package directory after the workspace commit and configured artifact checks are validated. The durable release transaction records enabled registry targets and intentionally unmanaged packages, so a retry cannot silently change which ecosystems are being published.

OCI publication is a release-level target for single and fixed workspace releases. Each configured entry is an untagged repository reference; SemVerge applies the release version as the image tag, checks that exact tag before a registry-idempotent push, and records each image separately in the durable transaction. `{image}` and `{version}` placeholders are replaced in custom commands. Independent workspaces require a future package-to-image mapping and are rejected before any release side effect.

These adapters do not create credentials, configure trusted publishers, build distributions or images, or claim live registry/provider proof. Configure build, Docker login, and authentication steps in the repository workflow, run a dry run first, and keep provider-side approvals and credentials outside SemVerge configuration. A registry response other than an exact `200` or an exact `404` fails closed; an authentication challenge that cannot be completed is not treated as an absent image.
