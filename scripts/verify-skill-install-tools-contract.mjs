#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

function fail(message) {
  console.error(`[skill-install-tools] ${message}`);
  process.exitCode = 1;
}

// CAP-1 skill-install-tools contract preflight. No physical move.

// 1. Both tools exist in BUILTIN_ACTION_TOOLS
const previewTool = BUILTIN_ACTION_TOOLS.find(t => t.id === "preview_skill_from_github");
assert(previewTool, "BUILTIN_ACTION_TOOLS must include preview_skill_from_github");
assert(previewTool.risk_level === "low", "preview_skill_from_github risk_level must be low");
assert(previewTool.requires_confirmation === false,
  "preview_skill_from_github must not require confirmation");

const installTool = BUILTIN_ACTION_TOOLS.find(t => t.id === "install_skill_from_github");
assert(installTool, "BUILTIN_ACTION_TOOLS must include install_skill_from_github");
assert(installTool.risk_level === "high", "install_skill_from_github risk_level must be high");
assert(installTool.requires_confirmation === true,
  "install_skill_from_github must require confirmation");

// 2. Both tools in expected confirmation-gated list
const confirmationIds = BUILTIN_ACTION_TOOLS
  .filter(t => t.requires_confirmation).map(t => t.id);
assert(confirmationIds.includes("install_skill_from_github"),
  "install_skill_from_github must be confirmation-gated");

// 3. Current owner file exists
const currentPath = "src/service/action_tools/tools/skill-install-tools.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);

// 4. Current owner exports both tools
const skillSrc = read(currentPath);
assert(skillSrc.includes("export const PREVIEW_SKILL_FROM_GITHUB_TOOL"),
  "skill-install-tools must export PREVIEW_SKILL_FROM_GITHUB_TOOL");
assert(skillSrc.includes("export const INSTALL_SKILL_FROM_GITHUB_TOOL"),
  "skill-install-tools must export INSTALL_SKILL_FROM_GITHUB_TOOL");

// 5. No-touch contracts
assert(skillSrc.includes("stageSkillFromGitHub"),
  "preview tool must delegate to stageSkillFromGitHub");
assert(skillSrc.includes("finalizeStagedInstall"),
  "install tool must delegate to finalizeStagedInstall");
assert(skillSrc.includes("contentHash"),
  "install must bind approval to contentHash");
assert(skillSrc.includes("createActionResult"),
  "skill-install-tools must use createActionResult");

// 6. Surface gating exists in tool-surface.mjs
const toolSurfacePath = "src/service/executors/tool_using/tool-surface.mjs";
assert(existsSync(path.join(root, toolSurfacePath)),
  "tool-surface.mjs missing");
const surfaceSrc = read(toolSurfacePath);
assert(surfaceSrc.includes("shouldExposeSkillInstall"),
  "tool-surface.mjs must define shouldExposeSkillInstall");

// 7. Boundary doc exists
const boundaryPath = "docs/architecture/skill-install-tools-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "skill-install-tools boundary doc missing");
const boundaryDoc = read(boundaryPath);
assert(boundaryDoc.includes("Skill Install Tools Boundary"), "boundary doc must have title");
assert(boundaryDoc.includes("Preflight only in this phase"), "boundary doc must state preflight-only status");

if (!process.exitCode) {
  console.log("[skill-install-tools] contract verified");
}
