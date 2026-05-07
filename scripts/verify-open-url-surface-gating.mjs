#!/usr/bin/env node
/**
 * verify-open-url-surface-gating.mjs — B2-a (a) in UPGRADE_PLAN.md
 *
 * Regression: 109 corpus turned up 8x forbidden_tool_called (most
 * severe failure class). The dominant pattern was the LLM picking
 * `open_url` for "give me the link for X / send me the URL for Y"
 * type prompts — open_url is *navigate to URL*, not *fetch URL
 * content*; nothing the user asked for actually happens.
 *
 * Constitution: 不打补丁 / 不针对特定提问.
 *   - The fix is at the framework's tool-surface layer:
 *     filterToolsForTask removes open_url unless the user explicitly
 *     asked to navigate (URL/domain + open verb) OR success_contract
 *     names open_url OR goal === "browser_control".
 *   - No per-prompt regex; the gate runs across every task.
 */

import assert from "node:assert/strict";
import {
  filterToolsForTask,
  shouldExposeOpenUrl
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

const tools = [
  { id: "open_url", policy_group: "browser_control" },
  { id: "fetch_url_content", policy_group: "external_web_read" },
  { id: "web_search_fetch", policy_group: "external_web_read" }
];

function task({ user_command, spec = {}, capabilities = [] } = {}) {
  return {
    user_command,
    context_packet: {
      semantic_router_decision: { needed_capabilities: capabilities }
    },
    task_spec: spec
  };
}

function ids(list) {
  return list.map((tool) => tool.id);
}

// ------------------------------------------------------------------
// 1. "give me the link for ChatGPT plugins" — must NOT expose open_url.
//    The user asked for a *link in the reply*, not navigation.
// ------------------------------------------------------------------
{
  const t = task({ user_command: "给我 ChatGPT 插件的链接" });
  check(
    "give-me-link-zh: shouldExposeOpenUrl=false",
    shouldExposeOpenUrl(t) === false
  );
  check(
    "give-me-link-zh: filterToolsForTask strips open_url",
    !ids(filterToolsForTask(tools, t)).includes("open_url")
  );
}

// ------------------------------------------------------------------
// 2. "send me the link for the docs" — same shape, English path.
// ------------------------------------------------------------------
{
  const t = task({ user_command: "send me the link for the API docs" });
  check(
    "send-me-link-en: shouldExposeOpenUrl=false",
    shouldExposeOpenUrl(t) === false
  );
}

// ------------------------------------------------------------------
// 3. Bare URL "https://example.com" — must NOT expose open_url
//    (user wants the page summarised, not navigated).
// ------------------------------------------------------------------
{
  const t = task({ user_command: "https://example.com" });
  check(
    "url-only: shouldExposeOpenUrl=false (no open verb)",
    shouldExposeOpenUrl(t) === false
  );
  check(
    "url-only: filterToolsForTask strips open_url",
    !ids(filterToolsForTask(tools, t)).includes("open_url")
  );
}

// ------------------------------------------------------------------
// 4. Strong-unlock CN: "打开 https://github.com" — MUST expose.
// ------------------------------------------------------------------
{
  const t = task({ user_command: "打开 https://github.com" });
  check(
    "open-cmd-zh: shouldExposeOpenUrl=true (verb + URL)",
    shouldExposeOpenUrl(t) === true
  );
  check(
    "open-cmd-zh: filterToolsForTask keeps open_url",
    ids(filterToolsForTask(tools, t)).includes("open_url")
  );
}

// ------------------------------------------------------------------
// 5. Strong-unlock EN: "open github.com please" — MUST expose.
// ------------------------------------------------------------------
{
  const t = task({ user_command: "open github.com please" });
  check(
    "open-cmd-en: shouldExposeOpenUrl=true (verb + domain)",
    shouldExposeOpenUrl(t) === true
  );
}

// ------------------------------------------------------------------
// 6. CN navigate verbs: "访问 / 进入 / 跳转 / 前往 / 浏览" — all expose.
// ------------------------------------------------------------------
{
  for (const verb of ["访问", "进入", "跳转", "前往", "浏览"]) {
    const t = task({ user_command: `${verb} https://example.com 看看内容` });
    check(
      `cn-verb '${verb}' + URL: shouldExposeOpenUrl=true`,
      shouldExposeOpenUrl(t) === true
    );
  }
}

// ------------------------------------------------------------------
// 7. EN navigate verbs: visit / navigate / go to — all expose.
// ------------------------------------------------------------------
{
  for (const verb of ["visit", "navigate to", "go to"]) {
    const t = task({ user_command: `${verb} https://example.com` });
    check(
      `en-verb '${verb}' + URL: shouldExposeOpenUrl=true`,
      shouldExposeOpenUrl(t) === true
    );
  }
}

// ------------------------------------------------------------------
// 8. success_contract.required_tool_names = ["open_url"] forces expose.
// ------------------------------------------------------------------
{
  const t = task({
    user_command: "any unrelated text",
    spec: { success_contract: { required_tool_names: ["open_url"] } }
  });
  check(
    "required_tool_names override: shouldExposeOpenUrl=true",
    shouldExposeOpenUrl(t) === true
  );
}

// ------------------------------------------------------------------
// 9. goal === "browser_control" forces expose.
// ------------------------------------------------------------------
{
  const t = task({
    user_command: "any unrelated text",
    spec: { goal: "browser_control" }
  });
  check(
    "goal=browser_control: shouldExposeOpenUrl=true",
    shouldExposeOpenUrl(t) === true
  );
}

// ------------------------------------------------------------------
// 10. Capability needed_capabilities=["browser_control"] alone is NOT
//     enough — without explicit user navigation intent, open_url
//     stays hidden. (This is the regression seed: SR mis-routed
//     content-fetch into browser_control.)
// ------------------------------------------------------------------
{
  const t = task({
    user_command: "summarise the latest deepseek research",
    capabilities: ["browser_control"]
  });
  check(
    "browser_control capability without navigation intent: open_url hidden",
    !ids(filterToolsForTask(tools, t)).includes("open_url")
  );
}

// ------------------------------------------------------------------
// 11. fetch_url_content / web_search_fetch are NEVER affected by this
//     gate — the gate is open_url-specific.
// ------------------------------------------------------------------
{
  const t = task({ user_command: "give me the link for X" });
  const surface = filterToolsForTask(tools, t);
  check(
    "fetch_url_content survives the open_url gate",
    ids(surface).includes("fetch_url_content")
  );
  check(
    "web_search_fetch survives the open_url gate",
    ids(surface).includes("web_search_fetch")
  );
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
