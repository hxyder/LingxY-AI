#!/usr/bin/env node
/**
 * verify-network-task-allowance.mjs — C16 (R 2026-05-08 invariant)
 *
 * R wrote (UPGRADE_PLAN.md §1, A3-β rejection):
 *   "tool policy / intent router 仍要允许 search-required、URL-read、
 *    connector、cloud-provider 这些网络任务正常执行".
 *
 * This verifier locks that invariant. Recent framework changes
 * (B2-a (a) open_url surface gating, B2-a (c) stable-QA SR override)
 * could conceivably over-block legitimate network tasks. This test
 * codifies the contract so a future tool-surface change that hides
 * web_search_fetch / fetch_url_content / account_send_email under a
 * normal "needs the web" task fails the gate.
 *
 * The verifier exercises the SURFACE / OVERRIDE layers in isolation
 * (they are deterministic given the right inputs) — it does NOT run
 * the full SR LLM pipeline. The contract: given a task that wants
 * external_web_read or email_calendar_action capability, the visible
 * tool list MUST include the corresponding network tools.
 *
 * Constitution check (CADRE C):
 *   - 不打补丁: tests are class-level — "any task with capability X
 *     surfaces the corresponding tools". No per-prompt allowlists.
 *   - 不针对特定提问: every passing case is a property of the
 *     capability ↔ tool group mapping, not a specific prompt.
 */

import {
  filterToolsForTask,
  shouldExposeOpenUrl
} from "../src/service/executors/tool_using/tool-surface.mjs";
import {
  applyStableQAOverride
} from "../src/service/core/intent/stable-qa-override.mjs";
import {
  POLICY_GROUPS,
  toolsInGroup
} from "../src/service/core/policy/policy-groups.mjs";

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

// All visible tools the runtime has (a representative sample). Mixes
// network read + write paths so the surface filter is exercised
// against both halves of "connector tasks".
const REGISTRY_SAMPLE = [
  // network — search / URL fetch (read-only external)
  { id: "web_search", policy_group: "external_web_read", required_capabilities: ["network"] },
  { id: "web_search_fetch", policy_group: "external_web_read", required_capabilities: ["network"] },
  { id: "fetch_url_content", policy_group: "external_web_read", required_capabilities: ["network"] },
  // network — connector READ (codex round-1: was missing from the
  // first version of this verifier; account_list_* are first-class
  // mailbox/calendar reads)
  { id: "account_list_emails", required_capabilities: ["network"] },
  { id: "account_list_events", required_capabilities: ["network"] },
  { id: "account_search_drive", required_capabilities: ["network"] },
  // network — connector WRITE
  { id: "account_send_email", policy_group: "email_send", required_capabilities: ["network"] },
  { id: "account_create_event", policy_group: "calendar_create", required_capabilities: ["network"] },
  { id: "account_upload_file", policy_group: "file_upload", required_capabilities: ["network"] },
  { id: "connector_workflow_run", policy_group: "email_send", required_capabilities: ["network"] },
  // network — browser navigate
  { id: "open_url", policy_group: "browser_control", required_capabilities: ["network"] },
  // local — should pass through irrespective of capability filtering
  { id: "read_file_text", policy_group: "local_file_text_read", required_capabilities: ["file_read"] },
  { id: "generate_document", policy_group: "artifact_generation", required_capabilities: ["file_write"] }
];

function task({ user_command, capabilities = [], spec = {} } = {}) {
  return {
    user_command,
    context_packet: {
      semantic_router_decision: { needed_capabilities: capabilities }
    },
    task_spec: spec
  };
}

function ids(list) {
  return list.map((t) => t.id);
}

// ---------------------------------------------------------------------
// 1. external_web_read capability → web_search* + fetch_url_content
//    visible. The user said "search-required" tasks must run.
// ---------------------------------------------------------------------
{
  const t = task({
    user_command: "search latest AI papers",
    capabilities: ["external_web_read"]
  });
  const visible = ids(filterToolsForTask(REGISTRY_SAMPLE, t));
  check("search-required: web_search_fetch is visible", visible.includes("web_search_fetch"));
  check("search-required: fetch_url_content is visible", visible.includes("fetch_url_content"));
  check("search-required: web_search is visible", visible.includes("web_search"));
}

// ---------------------------------------------------------------------
// 2. email_calendar_action capability → connector tools visible.
//    "邮箱/日历/Drive connector" must run.
// ---------------------------------------------------------------------
{
  const t = task({
    user_command: "send a draft to alice@example.com",
    capabilities: ["email_calendar_action"]
  });
  const visible = ids(filterToolsForTask(REGISTRY_SAMPLE, t));
  check("connector: account_send_email is visible", visible.includes("account_send_email"));
  check("connector: account_create_event is visible", visible.includes("account_create_event"));
  check("connector: account_upload_file is visible", visible.includes("account_upload_file"));
  check("connector: connector_workflow_run is visible", visible.includes("connector_workflow_run"));
  // codex round-1: connector READ tasks (list emails / events / drive
  // search) must also surface under email_calendar_action, not just
  // write-class tools. The matcher in tool-surface uses regex
  // /^(account_|connector_)/, so narrowing it to send/create/upload
  // would break read paths — this assert pins the read surface too.
  check("connector-read: account_list_emails is visible", visible.includes("account_list_emails"));
  check("connector-read: account_list_events is visible", visible.includes("account_list_events"));
  check("connector-read: account_search_drive is visible", visible.includes("account_search_drive"));
}

// ---------------------------------------------------------------------
// 2b. Provider allowance — basic smoke check that resolveProviderForTask
//     is exported and callable. The full provider-routing matrix lives
//     in scripts/verify-provider-routing.mjs (50/50 pass) — this check
//     is just "the symbol is wired so the runtime never accidentally
//     refuses to look up a provider for chat / planner / vision".
//     codex round-1 noted "cloud-provider tasks" weren't audited; the
//     deep coverage stays where it lives, this is a presence guard.
// ---------------------------------------------------------------------
{
  const { resolveProviderForTask, resolveCodeCliRuntimeForTask, describeResolvedProvider }
    = await import("../src/service/executors/shared/provider-resolver.mjs");
  check("provider-resolver: resolveProviderForTask is exported", typeof resolveProviderForTask === "function");
  check("provider-resolver: resolveCodeCliRuntimeForTask is exported", typeof resolveCodeCliRuntimeForTask === "function");
  check("provider-resolver: describeResolvedProvider is exported", typeof describeResolvedProvider === "function");
  // Calling with no provider configured should return null cleanly,
  // not throw — that's the "no provider" allowance shape.
  let result;
  let threw = false;
  try { result = resolveProviderForTask("chat", { /* clean env */ }, {}); }
  catch { threw = true; }
  check("provider-resolver: doesn't throw on chat task with empty env", threw === false);
  check("provider-resolver: returns null or provider-shaped object", result === null || typeof result === "object");
}

// ---------------------------------------------------------------------
// 3. URL-read tasks: "summarize https://example.com" — fetch_url_content
//    must be visible (this is the domain of "URL 分析"). open_url
//    SHOULD NOT be visible (B2-a (a): no nav verb).
// ---------------------------------------------------------------------
{
  const t = task({
    user_command: "总结 https://example.com 的内容",
    capabilities: ["external_web_read"]
  });
  const visible = ids(filterToolsForTask(REGISTRY_SAMPLE, t));
  check("URL-read: fetch_url_content is visible", visible.includes("fetch_url_content"));
  check("URL-read: open_url stays hidden (no nav verb)", !visible.includes("open_url"));
}

// ---------------------------------------------------------------------
// 4. URL-navigate tasks: "打开 https://github.com" — open_url IS
//    visible. This is the legit "open in lingxy_browser" path.
// ---------------------------------------------------------------------
{
  const t = task({
    user_command: "打开 https://github.com 看看",
    capabilities: ["browser_control"]
  });
  const visible = ids(filterToolsForTask(REGISTRY_SAMPLE, t));
  check("URL-navigate: open_url is visible (verb + URL)", visible.includes("open_url"));
  check("URL-navigate: shouldExposeOpenUrl=true", shouldExposeOpenUrl(t) === true);
}

// ---------------------------------------------------------------------
// 5. Stable-QA override does NOT kick in when freshness signals are
//    present — legit search tasks pass through.
// ---------------------------------------------------------------------
{
  // Time-word freshness: "解释 今天 X" — override should NOT fire.
  const baseDecision = { web_policy: "required", source_mode: "internet", confidence: 0.9 };
  const r1 = applyStableQAOverride({
    text: "解释一下 今天 美股 为什么大跌",
    decision: { ...baseDecision }
  });
  check("freshness time-word: stable-QA override does NOT fire (search allowed)", r1.applied === false);

  // Topic-word freshness: "如何 报税" — override should NOT fire.
  const r2 = applyStableQAOverride({
    text: "如何报税",
    decision: { ...baseDecision }
  });
  check("freshness topic-word '报税': stable-QA override does NOT fire (search allowed)", r2.applied === false);

  // explicit_single_url signal: bare URL → override defers.
  const r3 = applyStableQAOverride({
    text: "总结这个页面",
    decision: { ...baseDecision },
    signals: { explicit_single_url: { matched: true } }
  });
  check("explicit_single_url signal: stable-QA override does NOT fire (URL-analyse allowed)", r3.applied === false);

  // explicit_search signal: user said "search" / "搜索" / "查".
  const r4 = applyStableQAOverride({
    text: "解释一下深度学习",
    decision: { ...baseDecision },
    signals: { explicit_search: { matched: true } }
  });
  check("explicit_search signal: stable-QA override defers (search allowed)", r4.applied === false);
}

// ---------------------------------------------------------------------
// 6. Stable-QA override DOES fire on pure stable Q&A (the regression
//    fix from B2-a (c)) — confirms the override has teeth, not
//    silently disabled.
// ---------------------------------------------------------------------
{
  const baseDecision = { web_policy: "required", source_mode: "internet", confidence: 0.9 };
  const r = applyStableQAOverride({
    text: "什么是 RAG",
    decision: { ...baseDecision }
  });
  check("pure stable QA '什么是 RAG': override fires (web_policy=forbidden)", r.applied === true);
  check("pure stable QA: source_mode set to no_external", r.decision.source_mode === "no_external");
}

// ---------------------------------------------------------------------
// 7. Policy-group invariant — every network capability has a
//    populated tool list. If someone empties any of these lists by
//    mistake, the SR contract becomes meaningless.
// ---------------------------------------------------------------------
{
  for (const group of ["external_web_read", "email_send", "calendar_create", "file_upload"]) {
    const members = toolsInGroup(group);
    check(
      `policy-group ${group}: non-empty (network capability has tools to satisfy it)`,
      Array.isArray(members) && members.length > 0
    );
  }
}

// ---------------------------------------------------------------------
// 8. Local tools NOT requiring network are NOT accidentally swept up
//    by a network capability filter. (Sanity: capability filtering
//    is shape-correct.)
// ---------------------------------------------------------------------
{
  const t = task({
    user_command: "search foo",
    capabilities: ["external_web_read"]
  });
  const visible = ids(filterToolsForTask(REGISTRY_SAMPLE, t));
  check("capability isolation: read_file_text NOT in external_web_read surface",
    !visible.includes("read_file_text"));
  check("capability isolation: generate_document NOT in external_web_read surface",
    !visible.includes("generate_document"));
}

// ---------------------------------------------------------------------
// 9. Multi-capability tasks (search + write artifact) surface BOTH
//    networks AND artifact tools. Mixed-mode tasks must run.
// ---------------------------------------------------------------------
{
  const t = task({
    user_command: "research the news and produce a summary doc",
    capabilities: ["external_web_read", "artifact_generation"]
  });
  const visible = ids(filterToolsForTask(REGISTRY_SAMPLE, t));
  check("mixed: external_web_read tool visible", visible.includes("web_search_fetch"));
  check("mixed: artifact_generation tool visible", visible.includes("generate_document"));
}

// ---------------------------------------------------------------------
// 10. POLICY_GROUPS membership is frozen — drift would silently hide
//     network tools.
// ---------------------------------------------------------------------
{
  for (const group of ["external_web_read", "email_send", "calendar_create", "file_upload", "artifact_generation"]) {
    check(
      `POLICY_GROUPS.${group} array is frozen`,
      Object.isFrozen(POLICY_GROUPS[group])
    );
  }
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
