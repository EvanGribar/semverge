import type { BumpLevel } from "./types.js";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(value: string): SemVer | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const prerelease = match[4] ? match[4].split(".") : [];
  if (prerelease.some((identifier) => identifier.length > 1 && identifier.startsWith("0") && /^\d+$/.test(identifier))) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    build: match[5] ? match[5].split(".") : []
  };
}

export function formatVersion(version: SemVer, includeBuild = false): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const prerelease = version.prerelease.length > 0 ? `-${version.prerelease.join(".")}` : "";
  const build = includeBuild && version.build.length > 0 ? `+${version.build.join(".")}` : "";
  return `${core}${prerelease}${build}`;
}

export function compareVersions(left: string | SemVer, right: string | SemVer): number {
  const a = typeof left === "string" ? parseVersion(left) : left;
  const b = typeof right === "string" ? parseVersion(right) : right;
  if (!a || !b) {
    throw new Error(`Cannot compare invalid semantic versions: ${String(left)} and ${String(right)}`);
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) {
      return a[key] > b[key] ? 1 : -1;
    }
  }

  if (a.prerelease.length === 0 && b.prerelease.length > 0) {
    return 1;
  }
  if (a.prerelease.length > 0 && b.prerelease.length === 0) {
    return -1;
  }

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = a.prerelease[index];
    const rightIdentifier = b.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }
    const leftNumber = /^\d+$/.test(leftIdentifier);
    const rightNumber = /^\d+$/.test(rightIdentifier);
    if (leftNumber && rightNumber) {
      return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    }
    if (leftNumber !== rightNumber) {
      return leftNumber ? -1 : 1;
    }
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

export function highestBump(levels: Iterable<BumpLevel>): BumpLevel {
  let result: BumpLevel = "none";
  const rank: Record<BumpLevel, number> = { none: 0, patch: 1, minor: 2, major: 3 };
  for (const level of levels) {
    if (rank[level] > rank[result]) {
      result = level;
    }
  }
  return result;
}

export function bumpVersion(current: string, level: BumpLevel, prereleaseChannel?: string): string {
  const parsed = parseVersion(current);
  if (!parsed) {
    throw new Error(`The current version is not valid semver: ${current}`);
  }

  const next: SemVer = { ...parsed, prerelease: [], build: [] };
  if (level === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (level === "minor") {
    next.minor += 1;
    next.patch = 0;
  } else if (level === "patch") {
    next.patch += 1;
  }

  const channel = prereleaseChannel?.trim().replace(/[^0-9A-Za-z-]/g, "");
  if (channel) {
    const sameChannel = parsed.prerelease[0] === channel && parsed.prerelease.length >= 2;
    if (sameChannel && level === "none") {
      const previousNumber = Number(parsed.prerelease[1]);
      next.major = parsed.major;
      next.minor = parsed.minor;
      next.patch = parsed.patch;
      next.prerelease = [channel, String(Number.isFinite(previousNumber) ? previousNumber + 1 : 1)];
    } else {
      next.prerelease = [channel, "0"];
    }
  }

  return formatVersion(next);
}

export function isVersion(value: string): boolean {
  return parseVersion(value) !== null;
}
