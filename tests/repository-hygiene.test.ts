import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function yamlFile(path: string): Record<string, unknown> {
  const value: unknown = parseYaml(readFileSync(join(root, path), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain a YAML object`);
  }
  return value as Record<string, unknown>;
}

describe("repository trust surfaces", () => {
  it("keeps required policy and issue files present", () => {
    for (const path of ["LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "docs/vercel.md", "website/index.html", "website/styles.css", "website/vercel.json", ".github/dependabot.yml", ".github/ISSUE_TEMPLATE/bug_report.yml", ".github/ISSUE_TEMPLATE/feature_request.yml"]) {
      expect(existsSync(join(root, path)), path).toBe(true);
    }
  });

  it("keeps the public static site explicitly Vercel-compatible and hardened", () => {
    const vercel = JSON.parse(readFileSync(join(root, "website/vercel.json"), "utf8")) as Record<string, unknown>;
    expect(vercel.$schema).toBe("https://openapi.vercel.sh/vercel.json");
    expect(vercel.framework).toBeNull();
    expect(vercel.cleanUrls).toBe(true);
    expect(vercel.headers).toBeInstanceOf(Array);
    expect(readFileSync(join(root, "website/index.html"), "utf8")).not.toContain("style=");
  });

  it("keeps action workflows syntactically valid and explicitly permissioned", () => {
    const ci = yamlFile(".github/workflows/ci.yml");
    const security = yamlFile(".github/workflows/security.yml");
    const ciJobs = ci.jobs as Record<string, unknown>;
    const verify = ciJobs.verify as Record<string, unknown>;
    const verifySteps = verify.steps as Array<Record<string, unknown>>;
    expect(verifySteps.some((step) => step.run === "git diff --exit-code -- dist/index.cjs dist/index.cjs.map")).toBe(true);
    expect((security.permissions as Record<string, unknown>).contents).toBe("read");
    expect((security.jobs as Record<string, unknown>).codeql).toBeTruthy();
    expect((security.jobs as Record<string, unknown>)["dependency-review"]).toBeTruthy();
  });
});
