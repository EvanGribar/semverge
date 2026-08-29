# Optional AI assistance

SemVerge's AI layer is opt-in, BYOK, and advisory. The deterministic release planner remains the source of truth for versions, readiness, publication, transaction state, artifact integrity, and registry behavior.

## Configuration

Add the `ai` section only when a human-facing feature should be allowed to make a provider request:

```yaml
ai:
  enabled: true
  provider: openai
  model: your-provider-supported-model
  timeoutMs: 10000
  releaseNotes: true # include a review-only draft in release PRs
  infer: true        # allow the explicit `semverge infer` command
  tone: neutral      # neutral, friendly, or professional
  verbosity: standard # concise, standard, or detailed
```

The default is `enabled: false`; `releaseNotes` and `infer` are opt-in feature gates. Configure the API key outside repository configuration. The OpenAI adapter reads `OPENAI_API_KEY`, which can be a local environment variable or a GitHub Actions secret when an explicit assistance command is run. Never put the key in `.semverge.yml`, release metadata, or a request context.

## Release-note drafts

When both `ai.enabled` and `ai.releaseNotes` are true, `prepare` requests one structured, bounded draft per package and adds it to the release PR under `AI-enhanced customer notes (review draft)`. The section is explicitly advisory and includes the deterministic baseline beside a generated draft. It is regenerated on the next preparation run; it never edits `RELEASE_NOTES.md`, changes the release plan, or controls readiness or publication.

The request is grounded in immutable release facts: version, previous version, bump, channel, promotion state, migration-required state, and deterministic change IDs. The response must preserve those values, return exactly one highlight per customer-facing change, omit internal changes, and provide migration text for every breaking change. A mismatch, secret-like output, provider failure, timeout, or malformed response rejects the draft and keeps the deterministic notes in place.

## Metadata inference

`infer` is an explicit advisory command for pull-request metadata that is missing or too sparse to classify confidently:

```bash
OPENAI_API_KEY=... npx semverge infer "feat: add bulk export" \
  --body "Teams can export several projects at once." \
  --labels "ship:feature,area:exports" \
  --files "src/export.ts,tests/export.test.ts" \
  --json

# After review, apply the suggestion to an existing body file:
npx semverge infer "feat: add bulk export" --write pr-body.md
```

PowerShell users can set the credential with `$env:OPENAI_API_KEY = "..."`. The command returns a hidden `semverge` metadata block and does not write files unless `--write <path>` or `--apply <path>` is supplied. Even then, it only updates an existing file under the current working directory. Deterministic metadata, including explicit breaking/type/impact fields, is treated as authoritative; AI cannot override a conflict. File paths are filtered to safe, non-generated paths and file contents/diffs are never sent.

## Provider contract

The public API exports a provider-neutral `AiProvider` interface, `runOptionalAiFeature`, and the initial `OpenAiProvider`. The implementation uses the platform `fetch` API, so enabling AI does not add an AI SDK dependency to SemVerge or its GitHub Action bundle.

Every request uses a bounded release-facts envelope. A release-notes request has this shape:

```json
{
  "schemaVersion": 1,
  "feature": "release-notes",
  "release": {
    "version": "1.4.0",
    "previousVersion": "1.3.0",
    "bump": "minor",
    "channel": "stable",
    "promotion": false,
    "migrationRequired": false,
    "changes": [
      {
        "id": "pr:42",
        "kind": "feature",
        "title": "Add bulk export",
        "summary": "Projects can now be exported in one operation.",
        "breaking": false,
        "customerFacing": true,
        "impact": "new"
      }
    ]
  }
}
```

The metadata-inference request adds a minimal `context` containing bounded pull-request title/body, labels, conventional-commit facts, and filtered file paths. Both envelopes exclude source files, repository configuration, readiness results, credentials, tokens, generated secrets, and publication or transaction state. Sensitive-looking values are redacted before transport, request size is bounded, and provider error text is sanitized.

The provider request includes a feature instruction and a strict JSON Schema response contract. Responses are parsed and reconciled against deterministic facts before the feature sees them; malformed, refused, timed-out, cancelled, conflicting, or failed responses cannot become release decisions. AI output must remain communication guidance and must never directly set a version bump, readiness result, publication target, artifact digest, transaction phase, or registry result.
