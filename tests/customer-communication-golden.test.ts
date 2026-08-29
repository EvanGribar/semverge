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
      const fixture = JSON.parse(readFileSync(join(fixtureDirectory, `${name}.json`), "utf8")) as CustomerCommunicationFixture;
      const changes = fixture.changes.map((change) => parseChange(change));
      const customerNotes = renderCustomerNotes(fixture.version, changes);
      const announcement = renderAnnouncement(fixture.version, changes);
      const changelog = renderChangelogSection(fixture.version, fixture.date, changes);

      expect(customerNotes).toBe(readFileSync(join(fixtureDirectory, `${name}.customer.md`), "utf8"));
      expect(announcement).toBe(readFileSync(join(fixtureDirectory, `${name}.announcement.md`), "utf8"));
      expect(changelog).toBe(readFileSync(join(fixtureDirectory, `${name}.changelog.md`), "utf8"));
    });
  }

  it("preserves legitimate API terminology while keeping package internals out of customer output", () => {
    const api = readFileSync(join(fixtureDirectory, "api-technical.customer.md"), "utf8");
    const packageNotes = readFileSync(join(fixtureDirectory, "monorepo-package.customer.md"), "utf8");
    const packageChangelog = readFileSync(join(fixtureDirectory, "monorepo-package.changelog.md"), "utf8");
    expect(api).toContain("cursor tokens");
    expect(packageNotes).not.toContain("export adapter internals");
    expect(packageChangelog).toContain("rename export adapter internals");
  });
});
