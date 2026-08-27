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
    for (const path of ["LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "docs/ai.md", "docs/customer-communication.md", "docs/public-consumer.md", "docs/vercel.md", "website/index.html", "website/styles.css", "website/vercel.json", ".github/dependabot.yml", ".github/ISSUE_TEMPLATE/config.yml", ".github/ISSUE_TEMPLATE/bug_report.yml", ".github/ISSUE_TEMPLATE/feature_request.yml", ".github/pull_request_template.md", "fixtures/external-consumer/.github/workflows/semverge.yml"]) {
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

  it("keeps release execution out of unmerged pull-request workflows", () => {
    const release = yamlFile(".github/workflows/release.yml");
    const job = (release.jobs as Record<string, unknown>).semverge as Record<string, unknown>;
    expect(job.if).toBe("github.event_name != 'pull_request' || github.event.pull_request.merged == true");
  });

  it("keeps the external-consumer proof pinned and read-only", () => {
    const path = "fixtures/external-consumer/.github/workflows/semverge.yml";
    const content = readFileSync(join(root, path), "utf8");
    const workflow = yamlFile(path);
    const permissions = workflow.permissions as Record<string, unknown>;
    const job = (workflow.jobs as Record<string, unknown>).plan as Record<string, unknown>;
    const steps = job.steps as Array<Record<string, unknown>>;
    const actionStep = steps.find((step) => step.uses === "EvanGribar/semverge@v0");

    expect(permissions).toEqual({ contents: "read", "pull-requests": "read" });
    expect(actionStep).toBeTruthy();
    expect((actionStep?.with as Record<string, unknown>)?.["dry-run"]).toBe("true");
    expect(content).toContain("github.token");
    expect(content).not.toContain("secrets.");
  });
});
