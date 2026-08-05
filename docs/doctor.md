# Setup diagnostics

`semverge doctor` is a read-only setup report for the repository where it runs:

```bash
npx semverge doctor
```

It reports local evidence for:

- the package manager and committed lockfiles;
- workspace patterns, package count, and fixed versus independent versions;
- existing Release Please, Changesets, semantic-release, or SemVerge setup;
- build and packaging script hooks;
- explicit npm registry configuration without printing auth settings;
- Git tags and the latest semantic version tag; and
- GitHub workflow files, release permissions, whether a publish workflow declares `id-token: write`, and whether configured npm provenance has matching local workflow evidence.

Warnings are advisory and do not change files or contact GitHub. A workflow declaration is not proof that GitHub permissions, registry credentials, or provider-side trusted publishing are usable. `publishing.npm.provenance: true` is an opt-in contract for the built-in `npm publish` command; it still requires GitHub Actions OIDC at runtime. Run the action with `dry-run: true` before transferring publication ownership from an existing release tool.
