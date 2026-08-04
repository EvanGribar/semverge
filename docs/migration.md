# Migrating to SemVerge

Use the migration command as a report-first workflow:

```bash
npx semverge migrate release-please
npx semverge migrate changesets
npx semverge migrate semantic-release
```

The command inspects known configuration files and package dependencies, reports what it detected, maps only settings SemVerge can identify deterministically, and emits a conservative starter `.semverge.yml`. Publication is disabled in generated configuration until registry credentials, trusted publishing, and retry behavior are reviewed.

To write the generated configuration, opt in explicitly:

```bash
npx semverge migrate changesets --write
```

An existing `.semverge.yml` is never overwritten without `--force`:

```bash
npx semverge migrate changesets --write --force
```

Migration is intentionally not a claim of semantic equivalence. Release Please component rules, Changesets pending files, and semantic-release plugins can encode repository-specific behavior. Review the report, run `semverge explain`, and run the GitHub Action with `dry-run: true` before removing the existing workflow.
