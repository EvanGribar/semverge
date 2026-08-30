import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { VersionFileConfig, VersionFileFormat } from "./types.js";

export interface VersionFileChange {
  path: string;
  content: string;
}

export interface VersionFileUpdater {
  readonly format: VersionFileFormat;
  read(path: string, content: string): string;
  update(path: string, content: string, version: string): string;
}

type PropertySegment = string | number;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function error(path: string, message: string): never {
  throw new Error(`Cannot update ${path}: ${message}`);
}

function versionValue(path: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    error(path, "the selected property must contain a non-empty version string");
  }
  return value.trim();
}

function safeVersion(path: string, version: string): string {
  if (!version.trim()) {
    error(path, "the replacement version must not be empty");
  }
  if (version.includes("\r") || version.includes("\n")) {
    error(path, "the replacement version must be a single line");
  }
  return version;
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function parsePropertyPath(selector: string, path: string): PropertySegment[] {
  let input = selector.trim();
  if (input.startsWith("$")) {
    input = input.slice(1);
  }
  if (input.startsWith(".")) {
    input = input.slice(1);
  }
  if (!input) {
    error(path, "the property selector must not be empty");
  }

  const segments: PropertySegment[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    if (input[cursor] === ".") {
      cursor += 1;
      continue;
    }
    if (input[cursor] === "[") {
      const close = input.indexOf("]", cursor + 1);
      if (close < 0) {
        error(path, "the property selector contains an unterminated bracket");
      }
      const token = input.slice(cursor + 1, close).trim();
      if (!token) {
        error(path, "the property selector contains an empty bracket");
      }
      const first = token[0];
      const last = token[token.length - 1];
      if ((first === "'" || first === '"') && last === first && token.length >= 2) {
        segments.push(token.slice(1, -1));
      } else {
        let numeric = true;
        for (const character of token) {
          if (!isDigit(character)) {
            numeric = false;
            break;
          }
        }
        if (!numeric) {
          error(path, `the property selector bracket ${token} must contain a quoted key or array index`);
        }
        const index = Number(token);
        if (!Number.isSafeInteger(index)) {
          error(path, "the property selector array index is too large");
        }
        segments.push(index);
      }
      cursor = close + 1;
      continue;
    }

    const start = cursor;
    while (cursor < input.length && input[cursor] !== "." && input[cursor] !== "[") {
      cursor += 1;
    }
    const key = input.slice(start, cursor).trim();
    if (!key || key.includes("]")) {
      error(path, "the property selector contains an invalid key");
    }
    segments.push(key);
  }
  if (segments.length === 0) {
    error(path, "the property selector must identify a property");
  }
  return segments;
}

function readProperty(value: unknown, segments: PropertySegment[], path: string): unknown {
  let current = value;
  for (const segment of segments) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || current[segment] === undefined) {
        error(path, `the property selector does not exist at array index ${segment}`);
      }
      current = current[segment];
    } else {
      const object = record(current);
      if (!object || !(segment in object)) {
        error(path, `the property selector does not exist at ${segment}`);
      }
      current = object[segment];
    }
  }
  return current;
}

function writeProperty(value: unknown, segments: PropertySegment[], version: string, path: string): void {
  if (segments.length === 0) {
    error(path, "the property selector must identify a property");
  }
  let current = value;
  for (const segment of segments.slice(0, -1)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || current[segment] === undefined) {
        error(path, `the property selector does not exist at array index ${segment}`);
      }
      current = current[segment];
    } else {
      const object = record(current);
      if (!object || !(segment in object)) {
        error(path, `the property selector does not exist at ${segment}`);
      }
      current = object[segment];
    }
  }
  const final = segments[segments.length - 1];
  if (final === undefined) {
    error(path, "the property selector must identify a property");
  }
  if (typeof final === "number") {
    if (!Array.isArray(current) || current[final] === undefined) {
      error(path, `the property selector does not exist at array index ${final}`);
    }
    current[final] = version;
    return;
  }
  const object = record(current);
  if (!object || !(final in object)) {
    error(path, `the property selector does not exist at ${final}`);
  }
  object[final] = version;
}

function parseStructured(path: string, content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (parseError) {
    error(path, parseError instanceof Error ? parseError.message : String(parseError));
  }
}

function structuredUpdater(format: "json" | "yaml", defaultSelector = "version"): VersionFileUpdater {
  return {
    format,
    read(path, content) {
      let parsed: unknown;
      try {
        parsed = format === "json" ? parseStructured(path, content) : parseYaml(content);
      } catch (parseError) {
        error(path, parseError instanceof Error ? parseError.message : String(parseError));
      }
      const segments = parsePropertyPath(defaultSelector, path);
      return versionValue(path, readProperty(parsed, segments, path));
    },
    update(path, content, version) {
      let parsed: unknown;
      try {
        parsed = format === "json" ? parseStructured(path, content) : parseYaml(content);
      } catch (parseError) {
        error(path, parseError instanceof Error ? parseError.message : String(parseError));
      }
      const replacement = safeVersion(path, version);
      const segments = parsePropertyPath(defaultSelector, path);
      versionValue(path, readProperty(parsed, segments, path));
      writeProperty(parsed, segments, replacement, path);
      return format === "json" ? `${JSON.stringify(parsed, null, 2)}\n` : stringifyYaml(parsed);
    }
  };
}

interface TomlLocation {
  valueStart: number;
  valueEnd: number;
  value: string;
}

interface LineRange {
  text: string;
  start: number;
  end: number;
}

function lineRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  let start = 0;
  for (let cursor = 0; cursor <= content.length; cursor += 1) {
    if (cursor !== content.length && content[cursor] !== "\n") {
      continue;
    }
    const end = cursor > start && content[cursor - 1] === "\r" ? cursor - 1 : cursor;
    ranges.push({ text: content.slice(start, end), start, end });
    start = cursor + 1;
  }
  return ranges;
}

function trimTomlKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tomlSection(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) {
    return undefined;
  }
  return trimmed.slice(1, -1).trim();
}

function equalsOutsideQuotes(line: string): number {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false;
      } else if (quote === '"' && character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#") {
      return -1;
    } else if (character === "=") {
      return index;
    }
  }
  return -1;
}

function tomlQuotedValue(line: string, valueStart: number): { valueEnd: number; value: string } | null {
  const quote = line[valueStart];
  if (quote !== '"' && quote !== "'") {
    return null;
  }
  let escaped = false;
  for (let cursor = valueStart + 1; cursor < line.length; cursor += 1) {
    const character = line[cursor];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === quote) {
      return { valueEnd: cursor, value: line.slice(valueStart + 1, cursor) };
    }
  }
  return null;
}

function tomlLocation(content: string, path: string, selector: string): TomlLocation {
  const segments = parsePropertyPath(selector, path);
  if (segments.some((segment) => typeof segment !== "string")) {
    error(path, "TOML selectors must use dotted property names");
  }
  const names = segments as string[];
  const expectedSection = names.slice(0, -1).join(".");
  const expectedKey = names[names.length - 1] ?? "";
  let section = "";
  for (const range of lineRanges(content)) {
    const currentSection = tomlSection(range.text);
    if (currentSection !== undefined) {
      section = currentSection;
      continue;
    }
    const equals = equalsOutsideQuotes(range.text);
    if (equals < 0) {
      continue;
    }
    const key = trimTomlKey(range.text.slice(0, equals));
    const qualifiedKey = section ? `${section}.${key}` : key;
    if (key !== expectedKey || section !== expectedSection) {
      if (qualifiedKey !== names.join(".")) {
        continue;
      }
    }
    let valueStart = equals + 1;
    while (valueStart < range.text.length && (range.text[valueStart] === " " || range.text[valueStart] === "\t")) {
      valueStart += 1;
    }
    const quoted = tomlQuotedValue(range.text, valueStart);
    if (!quoted) {
      error(path, `the TOML property ${selector} must contain a quoted string`);
    }
    return { valueStart: range.start + valueStart + 1, valueEnd: range.start + quoted.valueEnd, value: quoted.value };
  }
  error(path, `the TOML property ${selector} was not found`);
}

function tomlUpdater(selector: string): VersionFileUpdater {
  return {
    format: "toml",
    read(path, content) {
      return versionValue(path, tomlLocation(content, path, selector).value);
    },
    update(path, content, version) {
      const replacement = safeVersion(path, version);
      const location = tomlLocation(content, path, selector);
      versionValue(path, location.value);
      return `${content.slice(0, location.valueStart)}${replacement}${content.slice(location.valueEnd)}`;
    }
  };
}

interface TextLocation {
  valueStart: number;
  valueEnd: number;
  value: string;
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let cursor = 0;
  while (true) {
    const found = content.indexOf(needle, cursor);
    if (found < 0) {
      return count;
    }
    count += 1;
    cursor = found + needle.length;
  }
}

function textLocation(content: string, path: string, pattern: string): TextLocation {
  const marker = "{{version}}";
  const markerAt = pattern.indexOf(marker);
  if (markerAt < 0 || countOccurrences(pattern, marker) !== 1) {
    error(path, 'text patterns must contain exactly one "{{version}}" placeholder');
  }
  const prefix = pattern.slice(0, markerAt);
  const suffix = pattern.slice(markerAt + marker.length);
  const locations: TextLocation[] = [];
  let cursor = 0;
  while (true) {
    const prefixAt = content.indexOf(prefix, cursor);
    if (prefixAt < 0) {
      break;
    }
    const valueStart = prefixAt + prefix.length;
    let valueEnd: number;
    if (suffix) {
      valueEnd = content.indexOf(suffix, valueStart);
      if (valueEnd < 0) {
        cursor = valueStart;
        continue;
      }
    } else {
      const newline = content.indexOf("\n", valueStart);
      valueEnd = newline < 0 ? content.length : newline;
      if (valueEnd > valueStart && content[valueEnd - 1] === "\r") {
        valueEnd -= 1;
      }
    }
    const value = content.slice(valueStart, valueEnd).trim();
    if (value && !value.includes("\r") && !value.includes("\n")) {
      locations.push({ valueStart, valueEnd, value });
    }
    cursor = Math.max(valueStart + 1, valueEnd + suffix.length);
  }
  if (locations.length !== 1) {
    error(path, locations.length === 0 ? `the text pattern ${pattern} was not found` : `the text pattern ${pattern} matched ${locations.length} locations; make it more specific`);
  }
  return locations[0] as TextLocation;
}

function textUpdater(pattern: string): VersionFileUpdater {
  return {
    format: "text",
    read(path, content) {
      return versionValue(path, textLocation(content, path, pattern).value);
    },
    update(path, content, version) {
      const replacement = safeVersion(path, version);
      const location = textLocation(content, path, pattern);
      versionValue(path, location.value);
      return `${content.slice(0, location.valueStart)}${replacement}${content.slice(location.valueEnd)}`;
    }
  };
}

function xmlNameCharacter(value: string | undefined, first: boolean): boolean {
  if (!value) {
    return false;
  }
  if (first) {
    return (value >= "A" && value <= "Z") || (value >= "a" && value <= "z") || value === "_" || value === ":";
  }
  return xmlNameCharacter(value, true) || (value >= "0" && value <= "9") || value === "-" || value === ".";
}

function parseXmlPath(path: string, xpath: string): { descendant: boolean; segments: string[] } {
  const value = xpath.trim();
  const descendant = value.startsWith("//");
  if (!descendant && !value.startsWith("/")) {
    error(path, "XML selectors must be absolute paths such as /project/version or //version");
  }
  const rawSegments = value.slice(descendant ? 2 : 1).split("/");
  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment || [...segment].some((character, index) => !xmlNameCharacter(character, index === 0))) {
      error(path, `XML selector ${xpath} contains an unsupported element name`);
    }
    segments.push(segment);
  }
  if (segments.length === 0) {
    error(path, "the XML selector must identify an element");
  }
  return { descendant, segments };
}

interface XmlFrame {
  name: string;
  contentStart: number;
  matches: boolean;
}

interface XmlLocation {
  valueStart: number;
  valueEnd: number;
  value: string;
}

function xmlTagEnd(content: string, start: number, path: string): number {
  let quote = "";
  for (let cursor = start + 1; cursor < content.length; cursor += 1) {
    const character = content[cursor];
    if (quote) {
      if (character === quote) {
        quote = "";
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return cursor;
    }
  }
  error(path, "XML contains an unterminated tag");
}

function xmlTagName(raw: string, path: string): string {
  let cursor = 0;
  while (cursor < raw.length && (raw[cursor] === " " || raw[cursor] === "\t" || raw[cursor] === "\r" || raw[cursor] === "\n")) {
    cursor += 1;
  }
  const start = cursor;
  while (cursor < raw.length && xmlNameCharacter(raw[cursor], cursor === start)) {
    cursor += 1;
  }
  const name = raw.slice(start, cursor);
  if (!name) {
    error(path, "XML contains a tag without a valid element name");
  }
  return name;
}

function xmlPathMatches(stack: readonly XmlFrame[], selector: { descendant: boolean; segments: string[] }): boolean {
  if (selector.descendant) {
    if (stack.length < selector.segments.length) {
      return false;
    }
    const offset = stack.length - selector.segments.length;
    return selector.segments.every((segment, index) => stack[offset + index]?.name === segment);
  }
  return stack.length === selector.segments.length && selector.segments.every((segment, index) => stack[index]?.name === segment);
}

function preserveWhitespace(value: string, replacement: string): string {
  let left = 0;
  while (left < value.length && (value[left] === " " || value[left] === "\t" || value[left] === "\r" || value[left] === "\n")) {
    left += 1;
  }
  let right = value.length;
  while (right > left && (value[right - 1] === " " || value[right - 1] === "\t" || value[right - 1] === "\r" || value[right - 1] === "\n")) {
    right -= 1;
  }
  return `${value.slice(0, left)}${replacement}${value.slice(right)}`;
}

function xmlLocation(content: string, path: string, xpath: string): XmlLocation {
  const selector = parseXmlPath(path, xpath);
  const stack: XmlFrame[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf("<", cursor);
    if (start < 0) {
      break;
    }
    if (content.startsWith("<!--", start)) {
      const endComment = content.indexOf("-->", start + 4);
      if (endComment < 0) {
        error(path, "XML contains an unterminated comment");
      }
      cursor = endComment + 3;
      continue;
    }
    if (content.startsWith("<![CDATA[", start)) {
      const endCdata = content.indexOf("]]>", start + 9);
      if (endCdata < 0) {
        error(path, "XML contains an unterminated CDATA section");
      }
      cursor = endCdata + 3;
      continue;
    }
    const end = xmlTagEnd(content, start, path);
    const raw = content.slice(start + 1, end);
    if (raw.startsWith("?") || raw.startsWith("!")) {
      cursor = end + 1;
      continue;
    }
    if (raw.startsWith("/")) {
      const closing = xmlTagName(raw.slice(1), path);
      const frame = stack.pop();
      if (!frame || frame.name !== closing) {
        error(path, `XML closing tag ${closing} does not match its opening tag`);
      }
      if (frame.matches) {
        const rawValue = content.slice(frame.contentStart, start);
        if (rawValue.includes("<")) {
          error(path, "the selected XML element contains nested markup; use a leaf element");
        }
        return { valueStart: frame.contentStart, valueEnd: start, value: rawValue.trim() };
      }
    } else {
      const selfClosing = raw.trimEnd().endsWith("/");
      const name = xmlTagName(raw, path);
      if (!selfClosing) {
        stack.push({ name, contentStart: end + 1, matches: xmlPathMatches([...stack, { name, contentStart: end + 1, matches: false }], selector) });
      } else if (xmlPathMatches([...stack, { name, contentStart: end + 1, matches: false }], selector)) {
        error(path, "the selected XML element is self-closing and has no version value");
      }
    }
    cursor = end + 1;
  }
  error(path, `the XML selector ${xpath} was not found`);
}

function xmlUpdater(xpath: string): VersionFileUpdater {
  return {
    format: "xml",
    read(path, content) {
      return versionValue(path, xmlLocation(content, path, xpath).value);
    },
    update(path, content, version) {
      const replacement = safeVersion(path, version);
      const location = xmlLocation(content, path, xpath);
      versionValue(path, location.value);
      return `${content.slice(0, location.valueStart)}${preserveWhitespace(content.slice(location.valueStart, location.valueEnd), replacement)}${content.slice(location.valueEnd)}`;
    }
  };
}

function formatValue(value: unknown): value is VersionFileFormat {
  return value === "json" || value === "yaml" || value === "toml" || value === "text" || value === "xml";
}

export function validateVersionFileConfig(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["must be an object"];
  }
  const spec = value as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof spec.path !== "string" || !spec.path.trim()) {
    issues.push("path must be a non-empty string");
  } else {
    const normalizedPath = spec.path.trim().replace(/\\/g, "/");
    const segments = normalizedPath.split("/");
    if (normalizedPath.startsWith("/") || /^[A-Za-z]:\//.test(normalizedPath) || segments.some((segment) => segment === "..")) {
      issues.push("path must stay inside the repository and must not be absolute or contain .. segments");
    }
  }
  if (!formatValue(spec.format)) {
    issues.push("format must be one of: json, yaml, toml, text, xml");
  }
  if (spec.package !== undefined && (typeof spec.package !== "string" || !spec.package.trim())) {
    issues.push("package must be a non-empty string when provided");
  }
  if (spec.property !== undefined && (typeof spec.property !== "string" || !spec.property.trim())) {
    issues.push("property must be a non-empty string when provided");
  }
  if (spec.pattern !== undefined && (typeof spec.pattern !== "string" || !spec.pattern)) {
    issues.push("pattern must be a non-empty string when provided");
  }
  if (spec.xpath !== undefined && (typeof spec.xpath !== "string" || !spec.xpath.trim())) {
    issues.push("xpath must be a non-empty string when provided");
  }
  if (spec.format === "text" && (typeof spec.pattern !== "string" || countOccurrences(spec.pattern, "{{version}}") !== 1)) {
    issues.push('text format requires exactly one "{{version}}" placeholder in pattern');
  }
  if (spec.format === "xml" && (typeof spec.xpath !== "string" || !spec.xpath.trim())) {
    issues.push("xml format requires xpath");
  }
  if ((spec.format === "json" || spec.format === "yaml" || spec.format === "toml") && spec.pattern !== undefined) {
    issues.push(`${spec.format} format does not use pattern; use property instead`);
  }
  if (spec.format !== "text" && spec.format !== "xml" && spec.xpath !== undefined) {
    issues.push(`${String(spec.format)} format does not use xpath`);
  }
  return issues;
}

export function createVersionFileUpdater(config: VersionFileConfig): VersionFileUpdater {
  const issues = validateVersionFileConfig(config);
  if (issues.length > 0) {
    error(config.path || "version file", issues.join("; "));
  }
  if (config.format === "json") {
    return structuredUpdater("json", config.property?.trim() || "version");
  }
  if (config.format === "yaml") {
    return structuredUpdater("yaml", config.property?.trim() || "version");
  }
  if (config.format === "toml") {
    return tomlUpdater(config.property?.trim() || "version");
  }
  if (config.format === "text") {
    return textUpdater(config.pattern ?? "");
  }
  return xmlUpdater(config.xpath ?? "");
}

export function readVersionFile(config: VersionFileConfig, content: string): string {
  return createVersionFileUpdater(config).read(config.path, content);
}

export function updateVersionFile(config: VersionFileConfig, content: string, version: string): VersionFileChange {
  return { path: config.path, content: createVersionFileUpdater(config).update(config.path, content, version) };
}
