---
name: semverge-workflows
description: Guidance on developing, planning, testing, and recovering SemVerge release workflows and transactional plugins.
---

# SemVerge Agent Workflows Cheat Sheet

Use this skill when you need to develop, configure, or run SemVerge release tasks or transactional plugins.

## Common CLI Commands

- Run all unit and integration tests:
  ```bash
  npm run test
  ```
- Run a specific test file:
  ```bash
  npx vitest run tests/plugin-execution.test.ts
  ```
- Run CLI typecheck and build steps:
  ```bash
  npm run typecheck && npm run build && npm run bundle
  ```
- Trigger local recovery for a transaction:
  ```bash
  node dist/cli.js recover <transaction-id> --state .semverge/release-state/<transaction-id>.json
  ```

## Writing a Plugin

A plugin must export a default object matching the `SemVergeReleasePlugin` structure defined in [`src/plugin-sdk.ts`](file:///C:/Users/evang/.gemini/antigravity/scratch/semverge/src/plugin-sdk.ts):

```javascript
export default {
  apiVersion: 1,
  name: "example-plugin",
  hooks: {
    publish: (context) => {
      return {
        effects: [
          {
            id: "my-action",
            idempotencyKey: "action-unique-key",
            kind: "custom-kind",
            target: "resource-to-mutate"
          }
        ]
      };
    }
  },
  executors: {
    "custom-kind": {
      execute: async (effect, context) => {
        // Implement side effect here
      },
      detect: async (effect, context) => {
        // Query to check if side effect is already done
        return false;
      }
    }
  }
};
```
