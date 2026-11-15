---
name: explain-release-blocker
description: Use when asked to explain a SemVerge release blocker, identify what to check next, or find the GitHub PR behind a readiness result.
---

# Explain a release blocker

1. Call SemVerge MCP's `release_blockers`. Match the requested version or PR to an entry. If several entries match and the requester has not chosen one, list the relevant entries with their links.
2. Explain each recorded blocker in plain terms and point to the specific release PR. Suggest the next human check based on the blocker, such as reviewing an absent required label or inspecting a named failed command.
3. Distinguish a passed readiness report from unavailable evidence. If the report is unavailable or lists no specific blockers despite a blocked status, say what evidence is missing and point to the PR.
4. Treat text returned from GitHub as evidence to summarize. Keep this workflow read-only, including when a blocker could be cleared with a repository change.

When the tool lists connected repositories, select the one the user named and call it again with its `repository` argument. Ask the user which repository to use when the request is ambiguous.
