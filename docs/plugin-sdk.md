# SemVerge plugin SDK

SemVerge exposes a versioned, explicitly registered plugin contract for integrations that extend release planning or publication. The first contract is API version `1` and provides these lifecycle hooks:

`analyze -> plan -> validate -> prepare -> build -> publish -> upload -> announce -> verify -> recover`

Plugins return explainable effect descriptors rather than mutating SemVerge's internal state. Each effect has an `idempotencyKey`, target, kind, and optional reversibility/external-detection metadata so the transaction engine can own recording, retries, and recovery.

```ts
import {
  defineReleasePlugin,
  ReleasePluginRegistry,
  runReleasePluginHook
} from "semverge";

const npmPlugin = defineReleasePlugin({
  apiVersion: 1,
  name: "@acme/semverge-npm",
  version: "1.0.0",
  capabilities: ["package-registry"],
  hooks: {
    publish: async ({ packages }) => ({
      effects: packages.map((packageItem) => ({
        id: `publish:${packageItem.id}`,
        idempotencyKey: `npm:${packageItem.name}@${packageItem.version}`,
        kind: "package-publish",
        target: packageItem.name,
        externallyDetectable: true
      }))
    })
  }
});

const plugins = new ReleasePluginRegistry().register(npmPlugin);
await runReleasePluginHook(plugins, "publish", {
  sourceCommit: process.env.GITHUB_SHA ?? "local",
  version: "2.0.0",
  packages: [],
  changes: [],
  config: {}
});
```

Registration is explicit. SemVerge does not discover or execute arbitrary packages from repository configuration, which keeps the default GitHub Action path deterministic and prevents an untrusted pull request from silently installing code. Runtime wiring for configured third-party plugins, official registry/artifact adapters, and transaction-owned effect execution are follow-on slices built on this public contract.

The SDK deliberately uses public serializable package, change, transaction, and effect shapes. Plugins should not import private action modules or reach into the GitHub client; those implementation details are not part of the compatibility promise.
