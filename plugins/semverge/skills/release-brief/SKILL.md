---
name: release-brief
description: Use when asked what is shipping next, whether a SemVerge release is ready, or whether the last release verified successfully.
---

# Brief the next release

1. Use SemVerge MCP's `release_status` for open release plans and `latest_release_outcome` for the most recent published release.
2. List the proposed version, recorded readiness, and any blockers for each returned plan. Link each item to its release PR.
3. State the latest published version and recorded verification outcome, with its release link.
4. If the source was unavailable, report which evidence is unavailable. An empty queue with a successful read means there is no open plan for the repository. A release with a successful readiness report can still require merge approval or other GitHub checks.
5. If asked about customer or technical impact, direct the reader to the linked release PR or release notes when the tool result does not include those details. Keep the brief tied to recorded evidence.

When the tool lists connected repositories, select the one the user named and call it again with its `repository` argument. Ask the user which repository to use when the request is ambiguous.
