#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { buildReleasePlan } from "./release.js";
import { parseChange } from "./changes.js";
import { parseConfig } from "./config.js";
import { readPackageVersion } from "./version-files.js";

const packageJson = await readFile("package.json", "utf8");
const configContent = await readFile(".releaserail.yml", "utf8").catch(() => "");
const config = parseConfig(configContent);
const currentVersion = readPackageVersion(packageJson);
const title = process.argv.slice(2).join(" ") || "fix: generated local preview";
const plan = buildReleasePlan({ currentVersion, config, changes: [parseChange({ title, source: "commit" })] });
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
