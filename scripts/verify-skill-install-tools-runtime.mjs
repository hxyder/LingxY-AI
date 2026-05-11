#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREVIEW_SKILL_FROM_GITHUB_TOOL, INSTALL_SKILL_FROM_GITHUB_TOOL } from "../src/service/action_tools/tools/skill-install-tools.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import {
  filterToolsForTask,
  shouldExposeSkillInstall
} from "../src/service/executors/tool_using/tool-surface.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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

// ── 2. Surface gating: class-level verb + GitHub URL, not prompt-specific ──
{
  const surfacePath = path.join(root, "src/service/executors/tool_using/tool-surface.mjs");
  const surfaceSrc = readFileSync(surfacePath, "utf8");
  assert(surfaceSrc.includes("shouldExposeSkillInstall"),
    "tool-surface must define shouldExposeSkillInstall");
  assert(surfaceSrc.includes("install_skill_from_github"),
    "tool-surface gating must reference install_skill_from_github");
  const task = (text) => ({
    user_command: text,
    context_packet: { semantic_router_decision: { needed_capabilities: [] } },
    task_spec: {}
  });
  assert.equal(shouldExposeSkillInstall(task("install this skill from https://github.com/owner/repo")), true,
    "skill install tools must surface for install-skill plus GitHub URL");
  assert.equal(shouldExposeSkillInstall(task("install something for me")), false,
    "skill install tools must stay hidden for install text without GitHub URL");
  assert.equal(shouldExposeSkillInstall(task("read https://github.com/owner/repo")), false,
    "skill install tools must stay hidden for GitHub URL without install-skill intent");
  const visible = filterToolsForTask([
    { id: "preview_skill_from_github" },
    { id: "install_skill_from_github" },
    { id: "web_search_fetch", policy_group: "external_web_read" }
  ], task("install this skill from https://github.com/owner/repo")).map((tool) => tool.id);
  assert(visible.includes("preview_skill_from_github") && visible.includes("install_skill_from_github"),
    "filterToolsForTask must expose both skill-install tools for the install workflow");
}

// ── 3. Preview: success path with stubbed stage ──
{
  const stageCalls = [];
  const putCalls = [];
  const discardCalls = [];
  const ctx = {
    runtime: {
      skillInstallState: {
        put: (info) => {
          putCalls.push(info);
          return "test-token-abc123";
        },
        consume: (token) => token === "test-token-abc123" ? { owner: "test", repo: "skill" } : null,
      }
    },
    _testSeam: {
      stageSkill: async ({ url, runtime }) => {
        stageCalls.push({ url, runtime });
        return {
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
        }
      },
      discardInstall: async (info) => { discardCalls.push(info); },
    }
  };
  const result = await PREVIEW_SKILL_FROM_GITHUB_TOOL.execute(
    { url: "https://github.com/test-owner/test-repo" },
    ctx
  );
  assert(result.success === true, "stubbed preview must succeed");
  assert.equal(stageCalls.length, 1, "preview must call the injected stage function once");
  assert.equal(stageCalls[0].url, "https://github.com/test-owner/test-repo",
    "preview must pass the requested URL to stage");
  assert.equal(stageCalls[0].runtime, ctx.runtime,
    "preview must pass runtime through to stage");
  assert.equal(putCalls.length, 1, "preview must store stagingInfo in runtime.skillInstallState");
  assert.equal(putCalls[0].preview.contentHash, "abc123",
    "preview must put contentHash-bound stagingInfo into the state registry");
  assert.equal(discardCalls.length, 0, "successful preview must not discard staging info");
  assert(result.metadata?.state_token === "test-token-abc123",
    "preview must return state_token in metadata");
  assert(result.metadata?.content_hash === "abc123",
    "preview must return content_hash in metadata");
  assert(result.metadata?.owner === "test-owner",
    "preview must return owner in metadata");
}

// ── 4. Install: success path with stubbed finalize ──
{
  const stagingInfo = {
    owner: "test-owner",
    repo: "test-repo",
    branch: "main",
    subPath: null,
    preview: { contentHash: "abc123" }
  };
  const consumeCalls = [];
  const finalizeCalls = [];
  const ctx = {
    runtime: {
      skillInstallState: {
        put: (_info) => "install-token",
        consume: (token) => {
          consumeCalls.push(token);
          return token === "install-token" ? stagingInfo : null;
        },
      }
    },
    _testSeam: {
      finalizeInstall: async (info, opts) => {
        finalizeCalls.push({ info, opts });
        return {
          ok: true,
          owner: "test-owner",
          repo: "test-repo",
          branch: "main",
          subPath: null,
          rootPath: "/skills/test-owner/test-repo",
          descriptor: { heading: "Installed Skill", description: "Installed" },
          warnings: []
        };
      }
    }
  };
  const result = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute(
    { state_token: "install-token" },
    ctx
  );
  assert(result.success === true, "stubbed install must succeed");
  assert.deepEqual(consumeCalls, ["install-token"],
    "install must consume the exact state_token");
  assert.equal(finalizeCalls.length, 1, "install must call finalize once");
  assert.equal(finalizeCalls[0].info, stagingInfo,
    "install must finalize the exact stagingInfo returned by consume");
  assert.equal(finalizeCalls[0].info.preview.contentHash, "abc123",
    "install must preserve the contentHash-bound stagingInfo into finalize");
  assert.equal(finalizeCalls[0].opts.runtime, ctx.runtime,
    "install must pass runtime through to finalize");
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
  let discarded = null;
  const stagingInfo = { owner: "o", repo: "r", branch: "m", targetIdentifier: "o/r", descriptor: { heading: "H", description: "D" }, preview: { markdown: "# T", sizeBytes: 1, contentHash: "h" } };
  const ctx = {
    runtime: { skillInstallState: null },
    _testSeam: {
      stageSkill: async () => ({ ok: true, stagingInfo }),
      discardInstall: async (info) => { discarded = info; },
    }
  };
  const result = await PREVIEW_SKILL_FROM_GITHUB_TOOL.execute(
    { url: "https://github.com/o/r" },
    ctx
  );
  assert(result.success === false, "preview must fail without state registry");
  assert.equal(discarded, stagingInfo,
    "preview must discard staged install when runtime registry is unavailable");
}

if (!process.exitCode) {
  console.log("[skill-install-runtime] preview/install seams, cleanup, confirmation gate, contentHash, and surface gating verified");
}
