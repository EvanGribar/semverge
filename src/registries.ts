import type { Ecosystem, NpmPublishConfig, RegistryPublishConfig, SemVergeConfig } from "./types.js";

export type RegistryVersionFetcher = (input: string, init?: RequestInit) => Promise<Response>;

const PYPI_JSON_URL = "https://pypi.org/pypi";
const CRATES_IO_API_URL = "https://crates.io/api/v1/crates";
const DOCKER_HUB_REGISTRY = "registry-1.docker.io";
const OCI_MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json"
].join(", ");

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

export interface OciImageRepository {
  registry: string;
  repository: string;
}

function ociRegistryError(image: string, version: string, detail: string): Error {
  return new Error(`Could not verify ${image}:${version} in the OCI registry: ${detail}; SemVerge will not assume the image tag is absent.`);
}

export function parseOciImageRepository(value: string): OciImageRepository {
  const image = value.trim();
  const segments = image.split("/");
  const first = segments[0] ?? "";
  const hasExplicitRegistry = segments.length > 1 && (first.includes(".") || first.includes(":") || first === "localhost");
  const registry = (hasExplicitRegistry ? first : DOCKER_HUB_REGISTRY).toLowerCase();
  const repositorySegments = hasExplicitRegistry ? segments.slice(1) : segments;

  if (!image || image.includes("@") || image.includes("\\") || image.startsWith("/") || image.endsWith("/") || repositorySegments.length === 0 || repositorySegments.some((segment) => !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(segment))) {
    throw new Error(`SemVerge OCI image entries must be untagged repository references such as ghcr.io/acme/app: ${value}`);
  }
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(registry)) {
    throw new Error(`SemVerge OCI image entries must use a valid registry host: ${value}`);
  }

  return {
    registry: registry === "docker.io" ? DOCKER_HUB_REGISTRY : registry,
    repository: (!hasExplicitRegistry && repositorySegments.length === 1 ? ["library", ...repositorySegments] : repositorySegments).join("/")
  };
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
  if (ecosystem === "python") {
    return config.publishing.python;
  }
  if (ecosystem === "rust") {
    return config.publishing.rust;
  }
  return { enabled: false, command: "", idempotency: "declared" };
}

export function publisherName(ecosystem: Ecosystem): "npm" | "PyPI" | "crates.io" | "repository-only" {
  if (ecosystem === "node") {
    return "npm";
  }
  if (ecosystem === "python") {
    return "PyPI";
  }
  if (ecosystem === "rust") {
    return "crates.io";
  }
  return "repository-only";
}

export async function registryVersionExists(
  ecosystem: Exclude<Ecosystem, "node" | "generic">,
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

function bearerChallenge(header: string | null): { realm: string; service?: string; scope?: string } | null {
  const match = header?.match(/^\s*Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const challenge = match[1];
  if (!challenge) {
    return null;
  }
  const values: Record<string, string> = {};
  const parameters = /([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|([^,]*))/g;
  for (const item of challenge.matchAll(parameters)) {
    const key = item[1];
    if (key) {
      values[key.toLowerCase()] = (item[2] ?? item[3] ?? "").trim();
    }
  }
  if (!values.realm) {
    return null;
  }
  return { realm: values.realm, ...(values.service ? { service: values.service } : {}), ...(values.scope ? { scope: values.scope } : {}) };
}

async function bearerToken(challenge: { realm: string; service?: string; scope?: string }, image: string, version: string, fetcher: RegistryVersionFetcher): Promise<string> {
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(challenge.realm);
  } catch {
    throw ociRegistryError(image, version, "the registry returned an invalid bearer-token realm");
  }
  if (tokenUrl.protocol !== "https:" && tokenUrl.protocol !== "http:") {
    throw ociRegistryError(image, version, "the registry returned an unsupported bearer-token realm");
  }
  if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
  if (challenge.scope) tokenUrl.searchParams.set("scope", challenge.scope);
  const response = await fetcher(tokenUrl.toString(), { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw ociRegistryError(image, version, `the bearer-token request returned HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw ociRegistryError(image, version, "the bearer-token response was not valid JSON");
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const token = record && (typeof record.token === "string" ? record.token : typeof record.access_token === "string" ? record.access_token : "");
  if (!token) {
    throw ociRegistryError(image, version, "the bearer-token response did not contain a token");
  }
  return token;
}

function ociManifestUrl(reference: OciImageRepository, version: string): string {
  const repository = reference.repository.split("/").map(encodeURIComponent).join("/");
  return `https://${reference.registry}/v2/${repository}/manifests/${encodeURIComponent(version)}`;
}

export function renderOciPublishCommand(command: string, image: string, version: string): string {
  const rendered = command.trim().replaceAll("{image}", image).replaceAll("{version}", version);
  if (!rendered) {
    throw new Error("SemVerge cannot publish an OCI image with an empty command.");
  }
  return rendered;
}

async function ociManifestResponse(
  image: string,
  version: string,
  fetcher: RegistryVersionFetcher
): Promise<Response> {
  const normalizedImage = image.trim();
  const normalizedVersion = version.trim();
  if (!normalizedImage || !normalizedVersion) {
    throw new Error("SemVerge cannot check OCI idempotency without an image repository and version.");
  }
  const reference = parseOciImageRepository(normalizedImage);
  const url = ociManifestUrl(reference, normalizedVersion);
  const baseHeaders = { accept: OCI_MANIFEST_ACCEPT, "user-agent": "semverge-release-engine" };
  let response = await fetcher(url, { headers: baseHeaders });
  if (response.status === 401) {
    const challenge = bearerChallenge(response.headers.get("www-authenticate"));
    if (!challenge) {
      throw ociRegistryError(normalizedImage, normalizedVersion, "the registry requires authentication but did not provide a bearer challenge");
    }
    const token = await bearerToken(challenge, normalizedImage, normalizedVersion, fetcher);
    response = await fetcher(url, { headers: { ...baseHeaders, authorization: `Bearer ${token}` } });
  }
  return response;
}

export async function ociImageVersionExists(
  image: string,
  version: string,
  fetcher: RegistryVersionFetcher = defaultFetcher
): Promise<boolean> {
  const normalizedImage = image.trim();
  const normalizedVersion = version.trim();
  const response = await ociManifestResponse(normalizedImage, normalizedVersion, fetcher);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw ociRegistryError(normalizedImage, normalizedVersion, `the registry returned HTTP ${response.status}`);
  }
  return true;
}

export async function ociImageVersionDigest(
  image: string,
  version: string,
  fetcher: RegistryVersionFetcher = defaultFetcher
): Promise<string | null> {
  const normalizedImage = image.trim();
  const normalizedVersion = version.trim();
  const response = await ociManifestResponse(normalizedImage, normalizedVersion, fetcher);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw ociRegistryError(normalizedImage, normalizedVersion, `the registry returned HTTP ${response.status}`);
  }
  const digest = response.headers.get("docker-content-digest")?.trim();
  if (!digest) {
    return null;
  }
  if (!/^[A-Za-z][A-Za-z0-9+._-]*:[0-9a-f]+$/i.test(digest)) {
    throw ociRegistryError(normalizedImage, normalizedVersion, "the registry returned an invalid content digest");
  }
  return digest.toLowerCase();
}
