import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertNoUserSkillData(label, value) {
  const text = JSON.stringify(value);
  const forbidden = [
    /%APPDATA%/i,
    /AppData[\\/]+Roaming[\\/]+UCA/i,
    /data[\\/]+integrations[\\/]+skills/i,
    /skills[\\/]+external/i,
    /anthropics--skills/i
  ];
  for (const pattern of forbidden) {
    assert.equal(
      pattern.test(text),
      false,
      `${label} must not package user-installed external skill data (${pattern})`
    );
  }
}

const packageJson = readJson("package.json");
assertNoUserSkillData("electron build.files", packageJson.build?.files ?? []);
assertNoUserSkillData("electron build.extraResources", packageJson.build?.extraResources ?? []);

const releaseConfig = readJson("tools/release/release-config.json");
assertNoUserSkillData("trial required_assets", releaseConfig.required_assets ?? []);

const githubInstallSource = readText("src/service/capabilities/skills/github-install.mjs");
assert.match(githubInstallSource, /source:\s*"github_install"/);
assert.match(githubInstallSource, /deriveSkillRegistryId\(normalised,\s*\{\s*source:\s*"github_install"\s*\}\)/);

const runtimeSource = readText("src/service/ai/integrations/runtime.mjs");
assert.match(runtimeSource, /function normalizeSkillRegistryEntry/);
assert.match(runtimeSource, /deriveSkillRegistryId\(rootPath,\s*\{\s*source\s*\}\)/);

const registrySource = readText("src/service/capabilities/skills/registry.mjs");
assert.match(registrySource, /const seen = new Map\(\)/);
assert.match(registrySource, /seen\.has\(key\)/);
assert.match(registrySource, /inactiveReason:\s*"duplicate_skill_id"/);
assert.match(registrySource, /inactiveReason:\s*"disabled_by_user"/);
assert.match(registrySource, /localOnly:\s*thirdParty/);
assert.match(registrySource, /thirdParty/);

console.log("Skill local-only boundary verification passed.");
