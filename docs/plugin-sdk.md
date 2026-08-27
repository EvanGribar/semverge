# SemVerge plugin SDK

SemVerge exposes a versioned, explicitly registered plugin contract for integrations that extend release planning or publication. The current contract is API version `1` and provides these lifecycle hooks:

`analyze -> plan -> validate -> prepare -> build -> publish -> upload -> announce -> verify -> recover`

## Declarative Plugin Configuration

Plugins can be registered declaratively in `.semverge.yml` under the `plugins` field:

```yaml
plugins:
  # Pinned npm package
  - package: "@acme/semverge-npm"
    name: "npm-plugin"  # optional override name
  # Trusted local module relative to workspace root
  - module: "./plugins/custom-notifier.js"
    name: "local-notifier"
  # Short string syntax (local module if starting with ./, / or \, else npm package)
  - "./plugins/file-writer.js"
  - "semverge-plugin-example"
```

## Security Model

To prevent execution of untrusted code with elevated release secrets, plugins are **only loaded from the merged/default-branch workspace**. SemVerge does not load or run configured plugins from unmerged pull-request branches during prep or privileged publication.

## Transaction-Owned Effect Execution

Instead of mutating internal state, plugins return serializable **effect descriptors**. SemVerge handles the orchestration and durable tracking of these side effects.

The plugin hook is marked `completed` only after every effect it returns has been completed or detected as already complete. If an effect remains planned, started, or failed, the hook remains unfinished so a retry can reconcile the incomplete effects without replaying completed ones.

The transaction event log is append-only for effect attempts. An effect is terminal for idempotency once **any** event with its idempotency key has status `completed`; earlier `planned`, `started`, or `failed` events do not make a later completion retryable.

An effect with `externallyDetectable: true` must have an executor with a `detect()` method. A detector error is ambiguous: SemVerge records the error as a failed effect and blocks execution so a provider outage cannot turn into a duplicate side effect. Effects whose `execute()` operation is intrinsically safe to repeat may opt into the fail-open path with `reexecutionSafe: true`; the detector is still attempted first.

### Effect States

Every plugin effect moves durably through four transaction states:
1. `planned`: Evaluated by the plugin hook and recorded in the transaction log.
2. `started`: Transitioned immediately before starting execution.
3. `completed`: Recorded upon successful execution or detection.
4. `failed`: Recorded if execution or external detection throws an error. Detection failures block execution unless the effect explicitly declares `reexecutionSafe: true`.

### Implementing Executors

A plugin defines how its custom effects are run and verified by supplying an `executors` map:

```ts
import { defineReleasePlugin } from "semverge";
import { appendFileSync, readFileSync } from "node:fs";

export default defineReleasePlugin({
  apiVersion: 1,
  name: "custom-file-writer",
  hooks: {
    publish: () => ({
      effects: [
        {
          id: "write-temp-file",
          idempotencyKey: "unique-file-key-v1.0.0",
          kind: "append-line",
          target: "out.txt",
          externallyDetectable: true
        }
      ]
    }),
    recover: () => ({
      // Recovery hook returns the same effect descriptors for unfinished steps
      effects: [
        {
          id: "write-temp-file",
          idempotencyKey: "unique-file-key-v1.0.0",
          kind: "append-line",
          target: "out.txt",
          externallyDetectable: true
        }
      ]
    })
  },
  executors: {
    "append-line": {
      // execute contains the side-effect implementation
      execute: async (effect) => {
        appendFileSync(effect.target, "written\n", "utf8");
      },
      // detect checks if the side-effect has already occurred (for retries/recovery)
      detect: async (effect) => {
        try {
          const content = readFileSync(effect.target, "utf8");
          return content.includes("written");
        } catch {
          return false;
        }
      }
    }
  }
});
```

## Recovery Reconciliation

When `recover` (via CLI or GitHub Actions) is run to resume a failed release, SemVerge:
1. Executes the `recover` plugin hook.
2. Collects returned effect descriptors.
3. Invokes the `detect` method of each effect's executor. If detected as already complete, the effect is skipped and marked `completed`.
4. If detection throws, records a diagnostic `failed` event and stops before `execute()` unless the effect has `reexecutionSafe: true`.
5. If not detected, the effect executor executes it, advancing the state machine to ensure clean, duplicate-free reconciliation.
