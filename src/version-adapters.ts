import type { Ecosystem, VersionFileConfig } from "./types.js";
import type { PackageDescriptor } from "./packages.js";
import type { VersionFileChange } from "./version-files.js";
import { readVersionFile, updateVersionFile } from "./version-updaters.js";

function isWhitespaceCharacter(value: string): boolean {
  return value !== "" && value.trim() === "";
}

export interface VersionTarget {
  ecosystem: Ecosystem;
  manifestPath: string;
  directory: string;
  versionFile?: VersionFileConfig;
}

function jsonObject(path: string, content: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected a JSON object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function tomlVersionLine(content: string, sections: string[]): { line: number; value: string } | null {
  const lines = content.split(/\r?\n/);
  let section = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      continue;
    }
    if (sections.includes(section)) {
      const versionMatch = /^(\s*version\s*=\s*["'])([^"']+)(["'].*)$/.exec(line);
      if (versionMatch?.[2]) {
        return { line: index, value: versionMatch[2] };
      }
    }
  }
  return null;
}

function tomlName(content: string, sections: string[]): string | undefined {
  const lines = content.split(/\r?\n/);
  let section = "";
  for (const line of lines) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? "";
      continue;
    }
    if (sections.includes(section)) {
      const nameMatch = /^\s*name\s*=\s*["']([^"']+)["']/.exec(line);
      if (nameMatch?.[1]) {
        return nameMatch[1];
      }
    }
  }
  return undefined;
}

function replaceTomlVersion(path: string, content: string, sections: string[], version: string): string {
  const location = tomlVersionLine(content, sections);
  if (!location) {
    throw new Error(`Could not find a version field in ${path} (${sections.join(" or ")}).`);
  }
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const original = lines[location.line] ?? "";
  lines[location.line] = original.replace(/^(\s*version\s*=\s*["'])([^"']+)(["'].*)$/, `$1${version}$3`);
  return lines.join(newline);
}

function pythonVersion(content: string, path: string): string {
  const location = tomlVersionLine(content, ["project", "tool.poetry"]);
  if (location) {
    return location.value;
  }

  for (const line of content.split(/\r?\n/)) {
    let cursor = 0;
    while (cursor < line.length && isWhitespaceCharacter(line[cursor] ?? "")) {
      cursor += 1;
    }
    if (line.slice(cursor, cursor + "__version__".length) !== "__version__") {
      continue;
    }
    cursor += "__version__".length;
    while (cursor < line.length && isWhitespaceCharacter(line[cursor] ?? "")) {
      cursor += 1;
    }
    if (line[cursor] !== "=") {
      continue;
    }
    cursor += 1;
    while (cursor < line.length && isWhitespaceCharacter(line[cursor] ?? "")) {
      cursor += 1;
    }
    const quote = line[cursor];
    if (quote !== "'" && quote !== '"') {
      continue;
    }
    const valueStart = cursor + 1;
    const singleQuote = line.indexOf("'", valueStart);
    const doubleQuote = line.indexOf('"', valueStart);
    const close = singleQuote < 0 ? doubleQuote : doubleQuote < 0 ? singleQuote : Math.min(singleQuote, doubleQuote);
    if (close > valueStart) {
      return line.slice(valueStart, close);
    }
  }
  throw new Error(`Could not find a Python version in ${path}.`);
}

function rustVersion(content: string, path: string): string {
  const location = tomlVersionLine(content, ["package"]);
  if (!location) {
    throw new Error(`Could not find [package].version in ${path}.`);
  }
  return location.value;
}

export function readTargetVersion(target: VersionTarget, content: string): string {
  if (target.ecosystem === "node") {
    const value = jsonObject(target.manifestPath, content).version;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${target.manifestPath} must contain a version string.`);
    }
    return value.trim();
  }
  if (target.ecosystem === "python") {
    return pythonVersion(content, target.manifestPath);
  }
  if (target.ecosystem === "generic") {
    if (!target.versionFile) {
      throw new Error(`${target.manifestPath} is missing its generic version-file configuration.`);
    }
    return readVersionFile(target.versionFile, content);
  }
  return rustVersion(content, target.manifestPath);
}

export function readTargetName(target: VersionTarget, content: string): string | undefined {
  if (target.ecosystem === "node") {
    const name = jsonObject(target.manifestPath, content).name;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  }
  if (target.ecosystem === "python") {
    return tomlName(content, ["project", "tool.poetry"]);
  }
  if (target.ecosystem === "generic") {
    return undefined;
  }
  return tomlName(content, ["package"]);
}

export function updateTargetVersion(target: VersionTarget, content: string, version: string): VersionFileChange {
  if (target.ecosystem === "node") {
    const value = jsonObject(target.manifestPath, content);
    value.version = version;
    return { path: target.manifestPath, content: `${JSON.stringify(value, null, 2)}\n` };
  }
  if (target.ecosystem === "python") {
    const initPath = target.directory ? `${target.directory}/__init__.py` : "__init__.py";
    if (!tomlVersionLine(content, ["project", "tool.poetry"])) {
      return { path: initPath, content: content.replace(/(__version__\s*=\s*["'])([^"']+)(["'])/, `$1${version}$3`) };
    }
    return { path: target.manifestPath, content: replaceTomlVersion(target.manifestPath, content, ["project", "tool.poetry"], version) };
  }
  if (target.ecosystem === "generic") {
    if (!target.versionFile) {
      throw new Error(`${target.manifestPath} is missing its generic version-file configuration.`);
    }
    return updateVersionFile(target.versionFile, content, version);
  }
  return { path: target.manifestPath, content: replaceTomlVersion(target.manifestPath, content, ["package"], version) };
}

export function targetFromDescriptor(descriptor: PackageDescriptor): VersionTarget {
  return {
    ecosystem: descriptor.ecosystem,
    manifestPath: descriptor.manifestPath,
    directory: descriptor.directory,
    ...(descriptor.versionFile ? { versionFile: descriptor.versionFile } : {})
  };
}
