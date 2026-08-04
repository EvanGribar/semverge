import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCallback);

export type WorkspaceHeadReader = (workspace: string) => Promise<string>;

async function readWorkspaceHead(workspace: string): Promise<string> {
  const result = await exec("git rev-parse HEAD", { cwd: workspace, shell: process.env.ComSpec ?? "/bin/sh" });
  return result.stdout.trim();
}

export async function assertWorkspaceAtCommit(workspace: string, mergeSha: string, readHead: WorkspaceHeadReader = readWorkspaceHead): Promise<void> {
  if (!workspace.trim()) {
    throw new Error("SemVerge requires GITHUB_WORKSPACE to be set before running release commands.");
  }
  if (!/^[0-9a-f]{7,40}$/i.test(mergeSha)) {
    throw new Error(`SemVerge cannot verify the release checkout because merge commit ${mergeSha || "<missing>"} is not a valid commit SHA.`);
  }

  let head: string;
  try {
    head = await readHead(workspace);
  } catch (error) {
    throw new Error(`SemVerge requires a checkout at release merge commit ${mergeSha}; could not read ${workspace} with git rev-parse HEAD. Check out the merge commit before publication.`, { cause: error });
  }
  if (head.toLowerCase() !== mergeSha.toLowerCase()) {
    throw new Error(`SemVerge requires GITHUB_WORKSPACE at release merge commit ${mergeSha}, but found ${head || "<no HEAD>"}. Check out the merge commit before publication.`);
  }
}
