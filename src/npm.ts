import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export interface NpmCommandResult {
  stdout: string;
  stderr: string;
}

export type NpmViewRunner = (executable: string, args: string[], options: { cwd: string }) => Promise<NpmCommandResult>;

const defaultNpmViewRunner: NpmViewRunner = async (executable, args, options) => {
  const result = await execFile(executable, args, { cwd: options.cwd, encoding: "utf8", maxBuffer: 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
};

function npmExecutable(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function errorOutput(error: unknown): string {
  if (!error || typeof error !== "object") {
    return String(error);
  }
  const record = error as Record<string, unknown>;
  return [record.stdout, record.stderr, record.message]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function isRegistryNotFound(error: unknown): boolean {
  return /\be404\b|\b404\s+not\s+found\b|\bno\s+match\s+found\b|\bversion\s+not\s+found\b/i.test(errorOutput(error));
}

function exactVersion(stdout: string, version: string): boolean {
  const value = stdout.trim();
  if (value === version) {
    return true;
  }
  try {
    return JSON.parse(value) === version;
  } catch {
    return false;
  }
}

export async function npmVersionExists(name: string, version: string, cwd: string, runner: NpmViewRunner = defaultNpmViewRunner): Promise<boolean> {
  const packageName = name.trim();
  const packageVersion = version.trim();
  if (!packageName || !packageVersion) {
    throw new Error("SemVerge cannot check npm idempotency without a package name and version.");
  }
  const spec = `${packageName}@${packageVersion}`;
  try {
    const result = await runner(npmExecutable(), ["view", spec, "version", "--json"], { cwd });
    return exactVersion(result.stdout, packageVersion);
  } catch (error) {
    if (isRegistryNotFound(error)) {
      return false;
    }
    throw new Error(`Could not verify ${spec} in the npm registry before publishing. Fix npm registry access and retry; SemVerge will not assume the version is absent.`);
  }
}
