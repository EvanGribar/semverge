export interface VersionFileChange {
  path: string;
  content: string;
}

function parseJson(path: string, content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot update ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function jsonContent(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function updatePackageLock(path: string, content: string, version: string): string {
  const lock = parseJson(path, content);
  lock.version = version;
  const packages = lock.packages;
  if (packages && typeof packages === "object" && !Array.isArray(packages)) {
    const root = (packages as Record<string, unknown>)[""];
    if (root && typeof root === "object" && !Array.isArray(root)) {
      (root as Record<string, unknown>).version = version;
    }
  }
  return jsonContent(lock);
}

export function updateVersionFiles(files: Record<string, string>, version: string): VersionFileChange[] {
  const changes: VersionFileChange[] = [];
  const packageJson = files["package.json"];
  if (packageJson !== undefined) {
    const parsed = parseJson("package.json", packageJson);
    parsed.version = version;
    changes.push({ path: "package.json", content: jsonContent(parsed) });
  }

  for (const lockPath of ["package-lock.json", "npm-shrinkwrap.json"]) {
    const lock = files[lockPath];
    if (lock !== undefined) {
      changes.push({ path: lockPath, content: updatePackageLock(lockPath, lock, version) });
    }
  }
  return changes;
}

export function readPackageVersion(packageJson: string): string {
  const parsed = parseJson("package.json", packageJson);
  if (typeof parsed.version !== "string" || !parsed.version.trim()) {
    throw new Error("package.json must contain a version string");
  }
  return parsed.version.trim();
}
