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
```

The default is `enabled: false`. Configure the API key outside repository configuration. The OpenAI adapter reads `OPENAI_API_KEY`, which can be a local environment variable or a GitHub Actions secret when an explicit assistance command is run. Never put the key in `.semverge.yml`, release metadata, or a request context.

The first human-facing feature is the explicit local command:

```bash
OPENAI_API_KEY=... npx semverge assist "feat: add a clearer release summary"
```

On Windows PowerShell, set the environment variable for the command with `$env:OPENAI_API_KEY = "..."`. The command prints an advisory JSON suggestion and never edits the release plan or repository files. If AI is disabled, it makes no network request. Provider errors are reported as a feature-level fallback and leave the deterministic plan unchanged.

## Provider contract

The public API exports a small provider-neutral `AiProvider` interface, `runOptionalAiFeature`, and the initial `OpenAiProvider`. The implementation uses the platform `fetch` API, so enabling AI does not add an AI SDK dependency to SemVerge or its GitHub Action bundle.

Every request uses a bounded release-facts envelope. The release-communication feature sends only this shape:

```json
{
  "schemaVersion": 1,
  "feature": "release-communication",
  "release": {
    "version": "1.4.0",
    "previousVersion": "1.3.0",
    "bump": "minor",
    "channel": "stable",
    "changes": [
      {
        "kind": "feature",
        "title": "Add bulk export",
        "summary": "Projects can now be exported in one operation.",
        "breaking": false
      }
    ]
  }
}
```

The envelope excludes source files, repository configuration, readiness results, credentials, tokens, generated secrets, and publication or transaction state. The provider request includes a feature instruction and a JSON Schema response contract. Responses are parsed and checked against that schema before the feature sees them; malformed, refused, timed-out, cancelled, or failed responses cannot become release decisions.

Future features must call the shared provider interface, identify themselves with a feature name, send a minimal release-facts envelope, and supply an explicit fallback when advisory output should be non-fatal. AI output must remain communication guidance and must never directly set a version bump, readiness result, publication target, transaction phase, artifact digest, or registry result.
