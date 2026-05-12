#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[skill-surface] ${message}`);
  process.exitCode = 1;
}

function walk(dir, files = []) {
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
  if (!existsSync(absoluteDir)) return files;
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(absoluteDir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(mjs|js|md)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function importModule(rel) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

function assertExports(moduleNamespace, rel, names) {
  for (const name of names) {
    assert.equal(typeof moduleNamespace[name], "function",
      `${rel} must export function ${name}`);
  }
}

// CAP-4A: lock the moved skill runtime surface under capabilities/skills.

const ownerDir = "src/service/capabilities/skills";
const oldOwnerDir = "src/service/ai/skills";
const expectedFiles = [
  "builtin.mjs",
  "discovery.mjs",
  "github-install.mjs",
  "install-state.mjs",
  "lifecycle.mjs",
  "registry-validation.mjs",
  "registry.mjs",
  "README.md"
];

assert(existsSync(path.join(root, ownerDir)), `skill owner dir missing: ${ownerDir}`);
assert(!existsSync(path.join(root, oldOwnerDir)),
  `${oldOwnerDir} must not exist after CAP-4A physical move`);
for (const file of expectedFiles) {
  assert(existsSync(path.join(root, ownerDir, file)), `skill owner file missing: ${ownerDir}/${file}`);
}

const discovery = await importModule(`${ownerDir}/discovery.mjs`);
assertExports(discovery, `${ownerDir}/discovery.mjs`, [
  "resolveSkillRootPath",
  "deriveSkillRegistryId",
  "readSkillDescription",
  "validateSkillDescriptorMarkdown",
  "readSkillDescriptor",
  "listSkillDirectories"
]);

const lifecycle = await importModule(`${ownerDir}/lifecycle.mjs`);
assertExports(lifecycle, `${ownerDir}/lifecycle.mjs`, [
  "resolveEditableSkillEntryPath",
  "resolveDeletableSkillEntryPath",
  "slugifySkillId",
  "createSkillMarkdown",
  "createEditableSkill",
  "duplicateEditableSkill",
  "deleteEditableSkill",
  "listSkillHistory",
  "backupSkillMarkdown",
  "writeSkillMarkdownWithBackup",
  "rollbackSkillMarkdown",
  "testEditableSkill"
]);

const githubInstall = await importModule(`${ownerDir}/github-install.mjs`);
assert.equal(typeof githubInstall.SKILL_INSTALL_ERROR, "object",
  "github-install.mjs must export SKILL_INSTALL_ERROR");
assertExports(githubInstall, `${ownerDir}/github-install.mjs`, [
  "validateGitHubSkillUrl",
  "validateSubPath",
  "validateBranchName",
  "probeGitInstalled",
  "deriveFinalDirName",
  "stageSkillFromGitHub",
  "discardStagedInstall",
  "finalizeStagedInstall",
  "installSkillFromGitHub"
]);

const installState = await importModule(`${ownerDir}/install-state.mjs`);
assertExports(installState, `${ownerDir}/install-state.mjs`, ["createInstallStateRegistry"]);

const registry = await importModule(`${ownerDir}/registry.mjs`);
assertExports(registry, `${ownerDir}/registry.mjs`, ["skillStateKey", "createSkillRegistry"]);

const registryValidation = await importModule(`${ownerDir}/registry-validation.mjs`);
assertExports(registryValidation, `${ownerDir}/registry-validation.mjs`, ["validateSkillRegistryDescriptor"]);

const builtin = await importModule(`${ownerDir}/builtin.mjs`);
assertExports(builtin, `${ownerDir}/builtin.mjs`, ["createConfiguredSkillRegistry"]);
assert(Array.isArray(builtin.BUILTIN_SKILL_REGISTRIES),
  "builtin.mjs must export BUILTIN_SKILL_REGISTRIES array");

const validDescriptor = discovery.validateSkillDescriptorMarkdown("# Demo\n\ndescription: Test skill\n");
assert.equal(validDescriptor.ok, true, "valid skill descriptor should pass");
const invalidDescriptor = discovery.validateSkillDescriptorMarkdown("description: Missing heading\n");
assert.equal(invalidDescriptor.ok, false, "descriptor without heading should fail");

const registryId = discovery.deriveSkillRegistryId("%CODEX_HOME%/skills", { source: "builtin" });
assert(registryId.startsWith("builtin-skills-"), "derived registry id should include source and basename");
assert.equal(registry.skillStateKey("reg", "skill"), "reg:skill", "skillStateKey shape changed");

const installRegistry = installState.createInstallStateRegistry({
  ttlMs: 50,
  maxEntries: 1,
  now: () => 1000,
  discardImpl: async () => {}
});
const token = installRegistry.put({ owner: "o", repo: "r", preview: { contentHash: "abc" } });
assert.equal(installRegistry.get(token)?.owner, "o", "install-state get must return staged info");
assert.equal(installRegistry.inspect(token)?.contentHash, "abc", "install-state inspect must expose contentHash");
assert.equal(installRegistry.consume(token)?.repo, "r", "install-state consume must return staged info");
assert.equal(installRegistry.get(token), null, "install-state consume must remove token");

const githubUrl = githubInstall.validateGitHubSkillUrl("https://github.com/openai/codex/tree/main/skills/demo");
assert.equal(githubUrl.ok, true, "GitHub tree skill URL should remain supported");
assert.equal(githubInstall.validateGitHubSkillUrl("https://user:pass@github.com/o/r").ok, false,
  "GitHub skill URL credentials must remain rejected");

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "linxi-skill-surface-"));
try {
  const skillDir = path.join(tmpRoot, "demo");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), "# Demo\n\ndescription: Demo skill\n", "utf8");
  const dirs = discovery.listSkillDirectories(tmpRoot);
  assert.deepEqual(dirs.map((value) => path.basename(value)), ["demo"],
    "listSkillDirectories must discover direct skill children");
  const descriptor = discovery.readSkillDescriptor(skillDir, "runtime");
  assert.equal(descriptor.id, "demo", "readSkillDescriptor id changed");
  assert.equal(descriptor.valid, true, "readSkillDescriptor should validate a normal SKILL.md");
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

// Skill owners must stay service/runtime code. They must not reach into desktop,
// Electron, renderer, providers, MCP, or connector implementation modules.
const forbiddenOwnerImports = [
  "src/desktop/",
  "electron",
  "../providers/",
  "../mcp/",
  "../../capabilities/connectors/",
  "src/service/capabilities/connectors/",
  "src/service/capabilities/providers/",
  "src/service/capabilities/mcp/"
];
for (const file of walk(ownerDir)) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (!rel.endsWith(".mjs")) continue;
  const source = read(rel);
  for (const needle of forbiddenOwnerImports) {
    assert(!source.includes(needle),
      `${rel} must not import or reference forbidden owner dependency ${needle}`);
  }
}

// Desktop UI/view-model files must not import skill runtime internals.
for (const uiRoot of ["src/desktop/renderer", "src/desktop/console", "src/desktop/overlay"]) {
  for (const file of walk(uiRoot)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const source = read(rel);
    assert(!source.includes("src/service/capabilities/skills") && !source.includes("/capabilities/skills/"),
      `${rel} must not import skill runtime internals`);
  }
}

// Existing product callers must still delegate to the skill owner rather than
// duplicating skill lifecycle or installer logic.
const actionTools = read("src/service/action_tools/tools/index.mjs");
assert(actionTools.includes("../../capabilities/skills/lifecycle.mjs"),
  "action tool aggregator must delegate editable skill creation to lifecycle.mjs");
assert(actionTools.includes("createEditableSkill") && actionTools.includes("slugifySkillId"),
  "editable skill action helpers must keep lifecycle delegation");

const skillInstallTools = read("src/service/capabilities/tools/skill-install-tools.mjs");
assert(skillInstallTools.includes("../skills/github-install.mjs"),
  "skill install tools must delegate to github-install.mjs");
for (const name of ["stageSkillFromGitHub", "finalizeStagedInstall", "discardStagedInstall"]) {
  assert(skillInstallTools.includes(name), `skill install tools must use ${name}`);
}

const runtimeIntegrations = read("src/service/ai/integrations/runtime.mjs");
assert(runtimeIntegrations.includes("../../capabilities/skills/registry.mjs"),
  "AI integration runtime must use the skill registry owner");
assert(runtimeIntegrations.includes("../../capabilities/skills/discovery.mjs"),
  "AI integration runtime must use the skill discovery owner");

const configRoutes = read("src/service/core/http-routes/config-provider-routes.mjs");
for (const routeNeedle of [
  "../../capabilities/skills/lifecycle.mjs",
  "../../capabilities/skills/github-install.mjs",
  "../../capabilities/skills/registry.mjs",
  "../../capabilities/skills/registry-validation.mjs"
]) {
  assert(configRoutes.includes(routeNeedle),
    `skill config routes must still delegate to ${routeNeedle}`);
}

const aiStatusRoutes = read("src/service/core/http-routes/ai-status-routes.mjs");
assert(aiStatusRoutes.includes('url.pathname === "/ai/skills"'),
  "/ai/skills service route must remain registered");

const bootstrap = read("src/service/core/service-bootstrap.mjs");
assert(bootstrap.includes("../capabilities/skills/install-state.mjs"),
  "service bootstrap must wire skill install-state owner");

const boundaryDoc = "docs/architecture/skill-surface-boundary.md";
assert(existsSync(path.join(root, boundaryDoc)), "skill surface boundary doc missing");
const boundarySource = read(boundaryDoc);
assert(boundarySource.includes("Skill Surface Boundary"), "skill surface boundary doc title missing");
assert(boundarySource.includes("src/service/capabilities/skills/"),
  "skill surface boundary doc must name target skills capability root");

for (const forbidden of [
  path.join(root, "src", "user-skills"),
  path.join(root, "src", "service", "user-skills"),
  path.join(root, "src", "service", "capabilities", "user-skills")
]) {
  assert(!existsSync(forbidden) || !statSync(forbidden).isDirectory(),
    `user-installed skill data must not live under src/: ${path.relative(root, forbidden)}`);
}

if (!process.exitCode) {
  console.log("[skill-surface] skill surface contract verified");
}
