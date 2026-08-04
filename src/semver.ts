import { compare as compareSemVer, parse as parseSemVer } from "semver";
import type { BumpLevel } from "./types.js";

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

export function parseVersion(value: string): SemVer | null {
  const parsed = parseSemVer(value.trim());
  if (!parsed) {
    return null;
  }

  return {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    prerelease: parsed.prerelease.map(String),
    build: [...parsed.build]
  };
}

export function formatVersion(version: SemVer, includeBuild = false): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  const prerelease = version.prerelease.length > 0 ? `-${version.prerelease.join(".")}` : "";
  const build = includeBuild && version.build.length > 0 ? `+${version.build.join(".")}` : "";
  return `${core}${prerelease}${build}`;
}

export function compareVersions(left: string | SemVer, right: string | SemVer): number {
  const a = parseSemVer(typeof left === "string" ? left.trim() : formatVersion(left, true));
  const b = parseSemVer(typeof right === "string" ? right.trim() : formatVersion(right, true));
  if (!a || !b) {
    throw new Error(`Cannot compare invalid semantic versions: ${String(left)} and ${String(right)}`);
  }
  return compareSemVer(a, b);
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
