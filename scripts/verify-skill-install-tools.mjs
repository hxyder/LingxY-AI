#!/usr/bin/env node
/**
 * verify-skill-install-tools.mjs — C18 #2b (UPGRADE_PLAN.md §C18)
 *
 * Locks the LLM-callable skill install pipeline:
 *   1. preview_skill_from_github(url) — low risk, no confirmation,
 *      stages + returns preview + state_token in metadata.
 *   2. install_skill_from_github(state_token) — HIGH risk, requires
 *      confirmation, consumes the token to finalize.
 *   3. State registry: 10-min TTL, 5-entry cap, LRU eviction.
 *   4. Surface gating: shouldExposeSkillInstall requires verb + URL
 *      in the same live-user-intent source, mirroring
 *      shouldExposeOpenUrl.
 *
 * Constitution (CADRE C):
 *   - 不打补丁: action tools delegate to stage / finalize from
 *     github-install.mjs. Surface gate is class-level (verb regex
 *     + URL regex co-occurrence in same source).
 *   - 不针对特定提问: tokens are opaque random IDs; no per-token
 *     branching anywhere in the pipeline.
 */

import {
  PREVIEW_SKILL_FROM_GITHUB_TOOL,
  INSTALL_SKILL_FROM_GITHUB_TOOL
} from "../src/service/action_tools/tools/skill-install-tools.mjs";
import {
  createInstallStateRegistry
} from "../src/service/ai/skills/install-state.mjs";
import {
  shouldExposeSkillInstall,
  filterToolsForTask
} from "../src/service/executors/tool_using/tool-surface.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------
// 1. Tool descriptors have the right risk profile.
// ---------------------------------------------------------------------
{
  check("preview tool: id correct", PREVIEW_SKILL_FROM_GITHUB_TOOL.id === "preview_skill_from_github");
  check("preview tool: risk_level=low",
    PREVIEW_SKILL_FROM_GITHUB_TOOL.risk_level === "low");
  check("preview tool: requires_confirmation=false",
    PREVIEW_SKILL_FROM_GITHUB_TOOL.requires_confirmation === false);
  check("preview tool: required_capabilities includes network + file_write",
    PREVIEW_SKILL_FROM_GITHUB_TOOL.required_capabilities.includes("network")
    && PREVIEW_SKILL_FROM_GITHUB_TOOL.required_capabilities.includes("file_write"));

  check("install tool: id correct", INSTALL_SKILL_FROM_GITHUB_TOOL.id === "install_skill_from_github");
  check("install tool: risk_level=HIGH",
    INSTALL_SKILL_FROM_GITHUB_TOOL.risk_level === "high");
  check("install tool: requires_confirmation=TRUE",
    INSTALL_SKILL_FROM_GITHUB_TOOL.requires_confirmation === true);
}

// ---------------------------------------------------------------------
// 2. preview_skill_from_github: empty url → success=false without
//    invoking the runtime (input-validation guard).
// ---------------------------------------------------------------------
{
  const r = await PREVIEW_SKILL_FROM_GITHUB_TOOL.execute({ url: "" }, { runtime: {} });
  check("preview: empty url → success=false", r.success === false);
  check("preview: empty url → error=missing_url",
    r.metadata?.error === "missing_url");
}

// preview_skill_from_github full path (clone+stage+put) is covered
// by scripts/verify-skill-stage-finalize.mjs; replicating it here
// would re-exercise git probe/clone which slows the suite. The
// descriptor + state registry + surface gating tests below are what
// this verifier uniquely locks.

// ---------------------------------------------------------------------
// 4. install tool: missing state_token returns helpful error.
// ---------------------------------------------------------------------
{
  const registry = createInstallStateRegistry();
  const runtime = { skillInstallState: registry };
  const r = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute({ state_token: "" }, { runtime });
  check("install: empty state_token → success=false", r.success === false);
  check("install: error code = missing_state_token",
    r.metadata?.error === "missing_state_token");
}

// ---------------------------------------------------------------------
// 5. install tool: unknown state_token returns "expired or already
//    used" hint.
// ---------------------------------------------------------------------
{
  const registry = createInstallStateRegistry();
  const runtime = { skillInstallState: registry };
  const r = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute(
    { state_token: "deadbeef-0000-0000-0000-000000000000" },
    { runtime }
  );
  check("install: unknown token → success=false", r.success === false);
  check("install: error code = state_token_invalid",
    r.metadata?.error === "state_token_invalid");
  check("install: observation hints at preview-then-retry flow",
    typeof r.observation === "string"
    && r.observation.includes("preview_skill_from_github"));
}

// ---------------------------------------------------------------------
// 6. install tool: registry not on runtime → fails cleanly (defensive).
// ---------------------------------------------------------------------
{
  const r = await INSTALL_SKILL_FROM_GITHUB_TOOL.execute(
    { state_token: "abc" },
    { runtime: {} }
  );
  check("install: no registry → success=false", r.success === false);
  check("install: no registry → error=no_state_registry",
    r.metadata?.error === "no_state_registry");
}

// ---------------------------------------------------------------------
// 7. State registry: TTL eviction.
// ---------------------------------------------------------------------
{
  let clock = 1000;
  const evicted = [];
  const reg = createInstallStateRegistry({
    ttlMs: 10000,
    now: () => clock,
    discardImpl: async (info) => evicted.push(info?.stagingDir ?? "?")
  });
  const token = reg.put({ stagingDir: "/tmp/A", preview: { contentHash: "hash-A" } });
  check("registry: put returns a token", typeof token === "string" && token.length > 0);
  check("registry: get returns the stagingInfo", reg.get(token)?.stagingDir === "/tmp/A");
  // Advance clock past TTL.
  clock = 12000;
  check("registry: get after expiry returns null", reg.get(token) === null);
  check("registry: evicted entry was discarded",
    evicted.length === 1 && evicted[0] === "/tmp/A");
}

// ---------------------------------------------------------------------
// 8. State registry: max-entries cap evicts oldest.
// ---------------------------------------------------------------------
{
  const evicted = [];
  const reg = createInstallStateRegistry({
    maxEntries: 2,
    discardImpl: async (info) => evicted.push(info?.stagingDir ?? "?")
  });
  const t1 = reg.put({ stagingDir: "/tmp/1", preview: { contentHash: "h1" } });
  const t2 = reg.put({ stagingDir: "/tmp/2", preview: { contentHash: "h2" } });
  const t3 = reg.put({ stagingDir: "/tmp/3", preview: { contentHash: "h3" } });
  check("max-entries: oldest evicted on overflow",
    evicted.length === 1 && evicted[0] === "/tmp/1");
  check("max-entries: t1 is no longer in registry", reg.get(t1) === null);
  check("max-entries: t2 still present", reg.get(t2)?.stagingDir === "/tmp/2");
  check("max-entries: t3 still present", reg.get(t3)?.stagingDir === "/tmp/3");
  check("max-entries: size = 2", reg.size() === 2);
}

// ---------------------------------------------------------------------
// 9. State registry: consume removes without discarding (caller
//    finalize takes over the staging dir).
// ---------------------------------------------------------------------
{
  const evicted = [];
  const reg = createInstallStateRegistry({
    discardImpl: async (info) => evicted.push(info?.stagingDir ?? "?")
  });
  const token = reg.put({ stagingDir: "/tmp/X", preview: { contentHash: "h" } });
  const consumed = reg.consume(token);
  check("consume: returns the stagingInfo", consumed?.stagingDir === "/tmp/X");
  check("consume: subsequent get returns null", reg.get(token) === null);
  check("consume: discardImpl was NOT called (caller owns it now)",
    evicted.length === 0);
}

// ---------------------------------------------------------------------
// 10. shouldExposeSkillInstall: verb + URL co-occurrence required.
// ---------------------------------------------------------------------
{
  function task(text) {
    return {
      user_command: text,
      context_packet: { semantic_router_decision: { needed_capabilities: [] } },
      task_spec: {}
    };
  }
  // Positive cases — install verb + github URL in the same source.
  for (const text of [
    "请帮我安装这个技能 https://github.com/openai/agents",
    "install this skill from https://github.com/openai/agents-framework/tree/main/skills/research",
    "添加这个技能 https://github.com/owner/repo",
    "add this skill: https://github.com/owner/repo"
  ]) {
    check(`expose: '${text.slice(0, 50)}' → true`, shouldExposeSkillInstall(task(text)));
  }
  // Negative — verb without URL.
  check("hide: 'install something for me' (no URL) → false",
    shouldExposeSkillInstall(task("install something for me")) === false);
  // Negative — URL without verb (just sharing a link).
  check("hide: 'check out https://github.com/openai/agents' (no verb) → false",
    shouldExposeSkillInstall(task("check out https://github.com/openai/agents")) === false);
  // Negative — URL but install verb is in unrelated context.
  check("hide: 'how do I install npm' (no URL) → false",
    shouldExposeSkillInstall(task("how do I install npm")) === false);
}

// ---------------------------------------------------------------------
// 11. shouldExposeSkillInstall: required_tool_names override.
// ---------------------------------------------------------------------
{
  const t = {
    user_command: "anything",
    task_spec: { success_contract: { required_tool_names: ["install_skill_from_github"] } }
  };
  check("expose: required_tool_names override → true", shouldExposeSkillInstall(t));
}

// ---------------------------------------------------------------------
// 12. filterToolsForTask: skill-install tools hidden by default.
// ---------------------------------------------------------------------
{
  const tools = [
    { id: "preview_skill_from_github" },
    { id: "install_skill_from_github" },
    { id: "web_search_fetch", policy_group: "external_web_read" }
  ];
  const taskNoIntent = {
    user_command: "search latest AI papers",
    context_packet: { semantic_router_decision: { needed_capabilities: ["external_web_read"] } },
    task_spec: {}
  };
  const visible = filterToolsForTask(tools, taskNoIntent).map((t) => t.id);
  check("filter: preview_skill_from_github hidden when no install intent",
    !visible.includes("preview_skill_from_github"));
  check("filter: install_skill_from_github hidden when no install intent",
    !visible.includes("install_skill_from_github"));
  check("filter: web_search_fetch still visible (regression)",
    visible.includes("web_search_fetch"));
}

// ---------------------------------------------------------------------
// 13. filterToolsForTask: both skill-install tools surface together
//     when the user invokes the install workflow.
// ---------------------------------------------------------------------
{
  const tools = [
    { id: "preview_skill_from_github" },
    { id: "install_skill_from_github" }
  ];
  const taskInstall = {
    user_command: "请帮我安装这个技能 https://github.com/openai/agents",
    context_packet: { semantic_router_decision: { needed_capabilities: [] } },
    task_spec: {}
  };
  const visible = filterToolsForTask(tools, taskInstall).map((t) => t.id);
  check("filter: preview_skill_from_github surfaces under install intent",
    visible.includes("preview_skill_from_github"));
  check("filter: install_skill_from_github surfaces under install intent",
    visible.includes("install_skill_from_github"));
}

// ---------------------------------------------------------------------
// 14. registry.inspect: introspection without TTL refresh.
// ---------------------------------------------------------------------
{
  const reg = createInstallStateRegistry();
  const token = reg.put({
    stagingDir: "/tmp/X",
    owner: "openai",
    repo: "agents",
    branch: "main",
    subPath: "skills/research",
    preview: { contentHash: "abc123" }
  });
  const info = reg.inspect(token);
  check("inspect: owner exposed", info?.owner === "openai");
  check("inspect: repo exposed", info?.repo === "agents");
  check("inspect: subPath exposed", info?.subPath === "skills/research");
  check("inspect: contentHash exposed", info?.contentHash === "abc123");
  check("inspect: createdAt + expiresAt present",
    typeof info?.createdAt === "number" && typeof info?.expiresAt === "number");
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
