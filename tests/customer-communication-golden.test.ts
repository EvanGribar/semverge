import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { renderAnnouncement, renderChangelogSection, renderCustomerNotes } from "../src/notes.js";
import type { ChangeInput } from "../src/types.js";

const fixtureDirectory = fileURLToPath(new URL("./fixtures/customer-communication/", import.meta.url));
const fixtureNames = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -5))
  .sort();

function readFixture(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

interface CustomerCommunicationFixture {
  version: string;
  date: string;
  changes: ChangeInput[];
}

describe("golden customer communication fixtures", () => {
  it("covers the representative release shapes", () => {
    expect(fixtureNames).toEqual([
      "api-technical",
      "breaking-migration",
      "bugfix-only",
      "improvements",
      "internal-docs-only",
      "major-capability",
      "monorepo-package",
      "prerelease-beta",
      "sparse-conventional",
      "subset-breaking"
    ]);
  });

  for (const name of fixtureNames) {
    it(`keeps ${name} customer output stable and audience-specific`, () => {
      const fixture = JSON.parse(readFixture(join(fixtureDirectory, `${name}.json`))) as CustomerCommunicationFixture;
      const changes = fixture.changes.map((change) => parseChange(change));
      const customerNotes = renderCustomerNotes(fixture.version, changes);
      const announcement = renderAnnouncement(fixture.version, changes);
      const changelog = renderChangelogSection(fixture.version, fixture.date, changes);

      expect(customerNotes).toBe(readFixture(join(fixtureDirectory, `${name}.customer.md`)));
      expect(announcement).toBe(readFixture(join(fixtureDirectory, `${name}.announcement.md`)));
      expect(changelog).toBe(readFixture(join(fixtureDirectory, `${name}.changelog.md`)));
    });
  }

  it("preserves legitimate API terminology while keeping package internals out of customer output", () => {
    const api = readFixture(join(fixtureDirectory, "api-technical.customer.md"));
    const packageNotes = readFixture(join(fixtureDirectory, "monorepo-package.customer.md"));
    const packageChangelog = readFixture(join(fixtureDirectory, "monorepo-package.changelog.md"));
    expect(api).toContain("cursor tokens");
    expect(packageNotes).not.toContain("export adapter internals");
    expect(packageChangelog).toContain("rename export adapter internals");
  });
});
