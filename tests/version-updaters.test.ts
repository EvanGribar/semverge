import { describe, expect, it } from "vitest";
import { parseChange } from "../src/changes.js";
import { parseConfig, validateConfigContent } from "../src/config.js";
import { discoverPackages } from "../src/packages.js";
import { buildWorkspaceReleasePlan } from "../src/workspace-release.js";
import { readVersionFile, updateVersionFile } from "../src/version-updaters.js";

describe("configurable version updaters", () => {
  it("updates a nested JSON property with a JSONPath-compatible selector", () => {
    const config = { path: "manifest.json", format: "json" as const, property: "$.release.version" };
    const content = JSON.stringify({ release: { version: "1.0.0", name: "demo" } });
    expect(readVersionFile(config, content)).toBe("1.0.0");
    const change = updateVersionFile(config, content, "1.1.0");
    expect(JSON.parse(change.content)).toEqual({ release: { version: "1.1.0", name: "demo" } });
  });

  it("rejects prototype keys in structured selectors", () => {
    const config = { path: "manifest.json", format: "json" as const, property: "__proto__.version" };
    expect(() => updateVersionFile(config, JSON.stringify({ version: "1.0.0" }), "1.1.0")).toThrow("prototype keys");
  });

  it("updates YAML and TOML properties while preserving TOML comments and layout", () => {
    const yamlConfig = { path: "release.yml", format: "yaml" as const, property: "project.version" };
    expect(readVersionFile(yamlConfig, "project:\n  version: 1.0.0\n")).toBe("1.0.0");
    expect(updateVersionFile(yamlConfig, "project:\n  version: 1.0.0\n", "1.1.0").content).toContain("version: 1.1.0");

    const tomlConfig = { path: "pyproject.toml", format: "toml" as const, property: "project.version" };
    const content = "[project]\nname = \"demo\"\nversion = \"1.0.0\" # keep this comment\n";
    expect(readVersionFile(tomlConfig, content)).toBe("1.0.0");
    expect(updateVersionFile(tomlConfig, content, "1.1.0").content).toBe("[project]\nname = \"demo\"\nversion = \"1.1.0\" # keep this comment\n");
  });

  it("uses a literal text marker instead of evaluating a configured regular expression", () => {
    const config = { path: "VERSION", format: "text" as const, pattern: "VERSION={{version}}" };
    expect(readVersionFile(config, "VERSION=1.0.0\n")).toBe("1.0.0");
    expect(updateVersionFile(config, "VERSION=1.0.0\n", "1.1.0").content).toBe("VERSION=1.1.0\n");
    expect(() => updateVersionFile({ ...config, pattern: "VERSION={{version}}\nVERSION={{version}}" }, "VERSION=1.0.0\n", "1.1.0")).toThrow("exactly one");
    const wholeFile = { path: "VERSION", format: "text" as const, pattern: "{{version}}" };
    expect(updateVersionFile(wholeFile, "1.0.0\n", "1.1.0").content).toBe("1.1.0\n");
  });

  it("updates a leaf XML element selected by a restricted XPath", () => {
    const config = { path: "pom.xml", format: "xml" as const, xpath: "/project/version" };
    const content = "<project>\n  <version>1.0.0</version>\n</project>\n";
    expect(readVersionFile(config, content)).toBe("1.0.0");
    expect(updateVersionFile(config, content, "1.1.0").content).toBe("<project>\n  <version>1.1.0</version>\n</project>\n");
    expect(() => readVersionFile(config, "<project><version><value>1.0.0</value></version></project>")).toThrow("nested markup");
  });

  it("validates updater descriptors and parses them into the public config", () => {
    const content = `versionFiles:
  - path: Dockerfile
    format: text
    pattern: 'ARG VERSION={{version}}'
  - path: metadata.yaml
    format: yaml
    property: release.version
`;
    const config = parseConfig(content);
    expect(config.versionFiles).toEqual([
      { path: "Dockerfile", format: "text", pattern: "ARG VERSION={{version}}" },
      { path: "metadata.yaml", format: "yaml", property: "release.version" }
    ]);
    expect(validateConfigContent(content)).toEqual([]);
    expect(validateConfigContent("versionFiles:\n  - path: VERSION\n    format: text\n    pattern: VERSION={{version}}={{version}}\n")).toContainEqual(expect.objectContaining({ path: "versionFiles[0]" }));
  });

  it("applies configured files to a release plan and requires package binding for ambiguous independent releases", () => {
    const config = parseConfig(`versionFiles:
  - path: VERSION
    format: text
    pattern: VERSION={{version}}
`);
    const files = { "package.json": JSON.stringify({ name: "demo", version: "1.0.0" }), VERSION: "VERSION=1.0.0\n" };
    const discovered = discoverPackages(files, ["package.json"], config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      changes: [parseChange({ title: "fix: repair release metadata", source: "commit" })],
      config,
      files
    });
    expect(plan.versionChanges.find((change) => change.path === "VERSION")?.content).toBe("VERSION=1.0.1\n");

    const independentConfig = parseConfig(`monorepo:
  mode: independent
versionFiles:
  - path: VERSION
    format: text
    pattern: VERSION={{version}}
`);
    const independentFiles = {
      "package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"] }),
      "packages/one/package.json": JSON.stringify({ name: "one", version: "1.0.0" }),
      "packages/two/package.json": JSON.stringify({ name: "two", version: "1.0.0" }),
      VERSION: "VERSION=1.0.0\n"
    };
    const independent = discoverPackages(independentFiles, Object.keys(independentFiles), independentConfig);
    expect(() => buildWorkspaceReleasePlan({
      packages: independent.packages,
      mode: independent.mode,
      changes: [
        parseChange({ title: "fix(one): repair one", source: "commit", files: ["packages/one/src/index.js"] }),
        parseChange({ title: "feat(two): add two", source: "commit", files: ["packages/two/src/index.js"] })
      ],
      config: independentConfig,
      files: independentFiles
    })).toThrow("must set package");
  });

  it("discovers a repository that uses only configured version files", () => {
    const config = parseConfig(`versionFiles:
  - path: VERSION
    format: text
    pattern: VERSION={{version}}
  - path: Dockerfile
    format: text
    pattern: ARG APP_VERSION={{version}}
`);
    const files = {
      VERSION: "VERSION=1.4.2\n",
      Dockerfile: "FROM node:20\nARG APP_VERSION=1.4.2\n"
    };
    const discovered = discoverPackages(files, Object.keys(files), config);
    expect(discovered.mode).toBe("single");
    expect(discovered.packages).toMatchObject([{ ecosystem: "generic", name: "root", version: "1.4.2" }]);

    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes: [parseChange({ title: "fix: refresh the image", source: "commit", files: ["Dockerfile"] })],
      date: "2026-08-04"
    });
    expect(plan.version).toBe("1.4.3");
    expect(plan.versionChanges).toEqual(expect.arrayContaining([
      { path: "VERSION", content: "VERSION=1.4.3\n" },
      { path: "Dockerfile", content: "FROM node:20\nARG APP_VERSION=1.4.3\n" }
    ]));
  });

  it("supports independent generic targets when every version location is bound", () => {
    const config = parseConfig(`monorepo:
  mode: independent
versionFiles:
  - path: services/api/VERSION
    format: text
    pattern: VERSION={{version}}
    package: api
  - path: services/web/VERSION
    format: text
    pattern: VERSION={{version}}
    package: web
`);
    const files = {
      "services/api/VERSION": "VERSION=1.0.0\n",
      "services/web/VERSION": "VERSION=2.0.0\n"
    };
    const discovered = discoverPackages(files, Object.keys(files), config);
    const plan = buildWorkspaceReleasePlan({
      packages: discovered.packages,
      mode: discovered.mode,
      files,
      config,
      changes: [parseChange({ title: "fix(api): repair the API", source: "commit", files: ["services/api/server.go"] })],
      date: "2026-08-04"
    });

    expect(plan.packages.map((item) => [item.package.name, item.plan.version])).toEqual([["api", "1.0.1"]]);
    expect(plan.versionChanges).toEqual([{ path: "services/api/VERSION", content: "VERSION=1.0.1\n" }]);
    expect(plan.unchangedPackages.map((item) => item.name)).toEqual(["web"]);
  });

  it("rejects generic version files that disagree on the current version", () => {
    const config = parseConfig(`versionFiles:
  - path: VERSION
    format: text
    pattern: VERSION={{version}}
  - path: image/VERSION
    format: text
    pattern: VERSION={{version}}
`);
    expect(() => discoverPackages({ VERSION: "VERSION=1.0.0\n", "image/VERSION": "VERSION=2.0.0\n" }, ["VERSION", "image/VERSION"], config)).toThrow("do not agree");
  });
});
