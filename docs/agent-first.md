# Use SemVerge from a coding agent

SemVerge is building an open-source control plane for release planning, verification, publication, and recovery. The local MCP server is the first step: it gives agents the same deterministic results as the CLI without requiring an LLM in the release engine.

Build this checkout with `pnpm install --frozen-lockfile` and `pnpm build`. Point your client at the resulting CLI and set the checkout it may inspect:

```sh
codex mcp add semverge -- node /absolute/semverge/lib/cli.js mcp --checkout /absolute/project
claude mcp add --transport stdio semverge -- node /absolute/semverge/lib/cli.js mcp --checkout /absolute/project
```

Quote paths containing spaces. Configure a separate server name for each additional checkout. The checkout is set by the person launching the server; the tools do not take a repository root, config path, state path, command result, or credential. Use a checkout you trust.

| Agent tool | Equivalent CLI | What it returns |
| --- | --- | --- |
| `analyze_repository` | `semverge doctor --json` | Version sources, configuration diagnostics, and workflow setup |
| `plan_release` | `semverge plan --summary '<title>'` | A version preview based on one explicit proposed change title |
| `check_readiness` | `semverge readiness '<title>'` | Local blockers, observed files, and evidence the checkout cannot establish |
| `inspect_release` | `semverge inspect '<transaction-id>'` | A local transaction summary from `.semverge/release-state/` or an unavailable result |

Try asking: “Using SemVerge, plan a release for `feat: add delivery dashboard`. Check readiness and tell me which blockers you can confirm and which evidence still needs verification.”

A local preview does not establish the complete release change set or bind it to an immutable commit. A readiness result of `blocked` means a local policy check found a blocker; `unverified` means no blocker was confirmed and the local workflow cannot authorize publication. For the CLI, those statuses exit with 1 and 2 respectively. Configured commands are never run by MCP. Hosted CI, source commit verification, and artifact provenance are not assessed. An inspected transaction is a record of prior activity; use the verification workflow to check publication.

Preparation, publishing, and recovery through MCP require server-enforced permissions and approvals before they are exposed.
