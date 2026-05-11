#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_SKILL_FROM_GITHUB_TOOL, INSTALL_SKILL_FROM_GITHUB_TOOL } from "../src/service/action_tools/tools/skill-install-tools.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`[skill-install-runtime] ${message}`);
  process.exitCode = 1;
}

// CAP-1 skill-install-tools runtime preflight. Tests preview + install
// with stubbed stage/finalize/discard via ctx._testSeam. No physical move.

// ── 1. Confirmation gate: install requires_confirmation ──
{
  const installTool = BUILTIN_ACTION_TOOLS.find(t => t.id === "install_skill_from_github");
  assert(installTool?.requires_confirmation === true,
    "install_skill_from_github must require confirmation");
  const previewTool = BUILTIN_ACTION_TOOLS.find(t => t.id === "preview_skill_from_github");
  assert(previewTool?.requires_confirmation === false,
    "preview_skill_from_github must NOT require confirmation");
}

// ── 2. Surface gating: shouldExposeSkillInstall exists ──
{
  const surfaceSrc = readFileSync(path.join(root, "src/service/executors/tool_using/tool-surface.mjs"), "utf8");
  assert(surfaceSrc.includes("shouldExposeSkillInstall"),
    "tool-surface must define shouldExposeSkillInstall");
  assert(surfaceSrc.includes("install_skill_from_github"),
    "tool-surface gating must reference install_skill_from_github");
}

// ── 3. Preview: success path with stubbed stage ──
{
  const ctx = {
    runtime: {
      skillInstallState: {
        put: (_info) => "test-token-abc123",
        consume: (token) => token === "test-token-abc123" ? { owner: "test", repo: "skill" } : null,
      }
    },
    _testSeam: {
      stageSkill: async ({ url }) => ({
        ok: true,
        stagingInfo: {
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subPath: null,
          targetIdentifier: "test-owner/test-repo",
          descriptor: { heading: "Test Skill", description: "A test skill" },
          preview: { markdown: "# Test Skill\n\nHello world", sizeBytes: 30, contentHash: "abc123" }
        }
      }),
      discardInstall: async (_info) => {},
    }
  };
  const result = await PREVIEW_SKILL_FROM_GITHUB_TOOL.execute(
    { url: "https://github.com/test-owner/test-repo" },
    ctx
  );
  assert(result.success === true, "stubbed preview must succeed");
  assert(result.metadata?.state_token === "test-token-abc123",
    "preview must return state_token in metadata");
  assert(result.metadata?.content_hash === "abc123",
    "preview must return content_hash in metadata");
  assert(result.metadata?.owner === "test-owner",
    "preview must return owner in metadata");
}

// ── 4. Install: success path with stubbed finalize ──
{
  const ctx = {
    runtime: {
      skillInstallState: {
        put: (_info) => "install-token",
        consume: (token) => token === "install-token" ? { owner: "test", repo: "skill" } : null,
      }
    },
    _testSeam: {
      finalizeInstall: async (_info, _opts) => ({
        ok: true,
        owner: "test-owner",
        repo: "test-repo",
        branch: "main",
        subPath: null,
        rootPath: "/skills/test-owner/test-repo",
        descriptor: { heading: "Installed Skill", description: "Installed" },
        warnings: []
      })
    }
  };
  const result = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute(
    { state_token: "install-token" },
    ctx
  );
  assert(result.success === true, "stubbed install must succeed");
  assert(result.metadata?.owner === "test-owner",
    "install must return owner in metadata");
  assert(result.metadata?.root_path === "/skills/test-owner/test-repo",
    "install must return root_path in metadata");
}

// ── 5. Install: missing state_token → rejection ──
{
  const result = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute(
    { state_token: "" },
    { runtime: { skillInstallState: { consume: () => null } } }
  );
  assert(result.success === false, "install must reject empty state_token");
  assert(result.observation.includes("state_token"),
    "install rejection must mention state_token");
}

// ── 6. Install: expired/invalid state_token → rejection ──
{
  const ctx = {
    runtime: {
      skillInstallState: {
        put: (_info) => "tok",
        consume: (_token) => null // simulate expiry
      }
    }
  };
  const result = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute(
    { state_token: "expired-token" },
    ctx
  );
  assert(result.success === false, "install must reject expired state_token");
  assert(result.observation.includes("not found") || result.observation.includes("expired"),
    "install rejection must mention token not found/expired");
}

// ── 7. Preview: missing url → rejection ──
{
  const result = await PREVIEW_SKILL_FROM_GITHUB_TOOL.execute(
    { url: "" },
    {}
  );
  assert(result.success === false, "preview must reject empty url");
  assert(result.observation.includes("url"),
    "preview rejection must mention url");
}

// ── 8. Preview: no state registry → graceful failure ──
{
  const ctx = {
    runtime: { skillInstallState: null },
    _testSeam: {
      stageSkill: async () => ({ ok: true, stagingInfo: { owner: "o", repo: "r", branch: "m", targetIdentifier: "o/r", descriptor: { heading: "H", description: "D" }, preview: { markdown: "# T", sizeBytes: 1, contentHash: "h" } } }),
      discardInstall: async (_info) => { /* called when registry is null — expected cleanup */ },
    }
  };
  const result = await PREVIEW_SKILL_FROM_GITHUB_TOOL.execute(
    { url: "https://github.com/o/r" },
    ctx
  );
  assert(result.success === false, "preview must fail without state registry");
}

if (!process.exitCode) {
  console.log("[skill-install-runtime] preview, install, confirmation gate, contentHash, and surface gating verified");
}
