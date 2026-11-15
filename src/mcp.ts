import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { analyzeLocalRepository, checkLocalReadiness, inspectLocalRelease, localPlan, summarizeLocalPlan } from "./release-operations.js";

const config = ".semverge.yml";
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const empty = z.object({}).strict();
const titleInput = z.object({ title: z.string().trim().min(1).max(1024) }).strict();
const transactionInput = z.object({ id: z.string().regex(/^release_[A-Za-z0-9-]{1,100}$/) }).strict();

function result(data: Record<string, unknown>, isError = false) {
  return { structuredContent: data, content: [{ type: "text" as const, text: JSON.stringify(data) }], isError };
}

async function read(operation: () => Promise<Record<string, unknown>>) {
  try {
    return result(await operation());
  } catch {
    return result({ status: "unavailable", reason: "Local release evidence could not be read. Run semverge doctor in the configured checkout." }, true);
  }
}

export function startLocalMcp(cwd: string) {
  serveStdio(() => {
    const server = new McpServer({ name: "semverge", version: "1.0.0" });
    server.registerTool("analyze_repository", {
      description: "Inspect the configured local checkout for version sources, release configuration issues, and workflow setup.",
      inputSchema: empty, annotations
    }, () => read(() => analyzeLocalRepository(cwd, config)));
    server.registerTool("plan_release", {
      description: "Preview a version decision for one explicit change title against the local checkout. This does not infer change history or verify evidence.",
      inputSchema: titleInput, annotations
    }, ({ title }) => read(async () => summarizeLocalPlan(await localPlan(cwd, config, title))));
    server.registerTool("check_readiness", {
      description: "Identify blockers from local checkout policy and report unavailable evidence. Does not run checks, verify hosting, or authorize publication.",
      inputSchema: titleInput, annotations
    }, ({ title }) => read(() => checkLocalReadiness(cwd, config, title)));
    server.registerTool("inspect_release", {
      description: "Inspect recorded local release transaction state by ID. Does not verify publication or resume the transaction.",
      inputSchema: transactionInput, annotations
    }, ({ id }) => read(() => inspectLocalRelease(cwd, id)));
    return server;
  });
}
