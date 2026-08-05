# Registry publishing adapters

SemVerge keeps registry publication opt-in. The default configuration leaves npm, PyPI, and crates.io disabled, so planning and GitHub release preparation do not contact a package registry or require registry credentials.

## Supported built-ins

| Package manifest | Registry | Default command | Registry idempotency check |
| --- | --- | --- | --- |
| `package.json` | npm | `npm publish` | `npm view <name>@<version> version --json` |
| `pyproject.toml` | PyPI | `python -m twine upload dist/*` | PyPI JSON release metadata |
| `Cargo.toml` | crates.io | `cargo publish --locked` | Exact crates.io version endpoint |

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
```

The built-in defaults query the exact package version before invoking a publish command. A `404` means the version is not present; other registry errors fail closed so a transient outage cannot be mistaken for an unpublished version. Custom commands must declare `idempotency: declared` when they own their retry-safe behavior, or `registry` only when the selected registry check is still appropriate.

Publication commands run from each released package directory after the workspace commit and configured artifact checks are validated. The durable release transaction records enabled registry targets and intentionally unmanaged packages, so a retry cannot silently change which ecosystems are being published.

These adapters do not create credentials, configure trusted publishers, build distributions, or claim live registry/provider proof. Configure build and authentication steps in the repository workflow, run a dry run first, and keep provider-side approvals and credentials outside SemVerge configuration.
