# Migrating to SemVerge

Use the migration command as a report-first workflow:

```bash
npx semverge migrate release-please
npx semverge migrate changesets
npx semverge migrate semantic-release
```

The command inspects known configuration files, package dependencies, and (for Release Please) the release workflow and manifest. It reports what it detected, maps only settings SemVerge can identify deterministically, and emits a conservative starter `.semverge.yml`. The report also includes a compatibility comparison with `mapped`, `review`, and `unsupported` entries so a migration does not imply semantic equivalence. Publication is disabled in generated configuration until registry credentials, trusted publishing, and retry behavior are reviewed.

Release Please package `version-file` and `extra-files` entries are proposed as `versionFiles` rules when their format can be inferred. Review text markers, TOML properties, XML paths, and package bindings before writing the file.

To write the generated configuration, opt in explicitly:

```bash
npx semverge migrate changesets --write
```

An existing `.semverge.yml` is never overwritten without `--force`:

```bash
npx semverge migrate changesets --write --force
```

Migration is intentionally not a claim of semantic equivalence. Release Please component rules, Changesets pending files, and semantic-release plugins can encode repository-specific behavior. Review the report, run `semverge explain`, and run the GitHub Action with `dry-run: true` before removing the existing workflow.
