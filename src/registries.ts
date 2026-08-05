import type { Ecosystem, NpmPublishConfig, RegistryPublishConfig, SemVergeConfig } from "./types.js";

export type RegistryVersionFetcher = (input: string, init?: RequestInit) => Promise<Response>;

const PYPI_JSON_URL = "https://pypi.org/pypi";
const CRATES_IO_API_URL = "https://crates.io/api/v1/crates";

function defaultFetcher(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

function packageIdentity(name: string, version: string): { name: string; version: string } {
  const packageName = name.trim();
  const packageVersion = version.trim();
  if (!packageName || !packageVersion) {
    throw new Error("SemVerge cannot check registry idempotency without a package name and version.");
  }
  return { name: packageName, version: packageVersion };
}

function registryError(registry: string, name: string, version: string, status: number): Error {
  return new Error(`Could not verify ${name}@${version} in the ${registry} registry (HTTP ${status}). Fix registry access and retry; SemVerge will not assume the version is absent.`);
}

async function responseJson(response: Response, registry: string, name: string, version: string): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(`Could not verify ${name}@${version} in the ${registry} registry: the registry returned invalid JSON; SemVerge will not assume the version is absent.`);
  }
}

async function pythonVersionExists(name: string, version: string, fetcher: RegistryVersionFetcher): Promise<boolean> {
  const encodedName = encodeURIComponent(name);
  const response = await fetcher(`${PYPI_JSON_URL}/${encodedName}/json`, {
    headers: { accept: "application/json" }
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw registryError("PyPI", name, version, response.status);
  }
  const payload = await responseJson(response, "PyPI", name, version);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Could not verify ${name}@${version} in the PyPI registry: the registry response was not an object; SemVerge will not assume the version is absent.`);
  }
  const releases = (payload as Record<string, unknown>).releases;
  if (!releases || typeof releases !== "object" || Array.isArray(releases)) {
    throw new Error(`Could not verify ${name}@${version} in the PyPI registry: the registry response did not contain release metadata; SemVerge will not assume the version is absent.`);
  }
  return Object.prototype.hasOwnProperty.call(releases, version);
}

async function rustVersionExists(name: string, version: string, fetcher: RegistryVersionFetcher): Promise<boolean> {
  const encodedName = encodeURIComponent(name);
  const encodedVersion = encodeURIComponent(version);
  const response = await fetcher(`${CRATES_IO_API_URL}/${encodedName}/${encodedVersion}`, {
    headers: {
      accept: "application/json",
      "user-agent": "semverge-release-engine"
    }
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw registryError("crates.io", name, version, response.status);
  }
  await responseJson(response, "crates.io", name, version);
  return true;
}

export function publishConfigForEcosystem(config: SemVergeConfig, ecosystem: Ecosystem): NpmPublishConfig | RegistryPublishConfig {
  if (ecosystem === "node") {
    return config.publishing.npm;
  }
  return config.publishing[ecosystem];
}

export function publisherName(ecosystem: Ecosystem): "npm" | "PyPI" | "crates.io" {
  if (ecosystem === "node") {
    return "npm";
  }
  return ecosystem === "python" ? "PyPI" : "crates.io";
}

export async function registryVersionExists(
  ecosystem: Exclude<Ecosystem, "node">,
  name: string,
  version: string,
  fetcher: RegistryVersionFetcher = defaultFetcher
): Promise<boolean> {
  const identity = packageIdentity(name, version);
  if (ecosystem === "python") {
    return pythonVersionExists(identity.name, identity.version, fetcher);
  }
  return rustVersionExists(identity.name, identity.version, fetcher);
}
