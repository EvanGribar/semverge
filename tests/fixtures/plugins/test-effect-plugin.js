import { appendFileSync, readFileSync } from "node:fs";

export default {
  apiVersion: 1,
  name: "test-effect-plugin",
  hooks: {
    publish: (ctx) => {
      return {
        effects: [
          {
            id: "write-temp-file",
            idempotencyKey: "temp-file-key",
            kind: "append-file",
            target: "tests/scratch/effect-out.txt"
          }
        ]
      };
    },
    recover: (ctx) => {
      return {
        effects: [
          {
            id: "write-temp-file",
            idempotencyKey: "temp-file-key",
            kind: "append-file",
            target: "tests/scratch/effect-out.txt"
          }
        ]
      };
    }
  },
  executors: {
    "append-file": {
      execute: async (effect) => {
        appendFileSync(effect.target, "executed\n", "utf8");
        if (process.env.FAIL_AFTER_WRITE === "true") {
          throw new Error("Simulated failure after write");
        }
      },
      detect: async (effect) => {
        try {
          const content = readFileSync(effect.target, "utf8");
          return content.includes("executed");
        } catch {
          return false;
        }
      }
    }
  }
};
