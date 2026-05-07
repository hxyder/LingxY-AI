#!/usr/bin/env node
/**
 * verify-failure-classifier.mjs — C15 (UPGRADE_PLAN.md §C15)
 *
 * R rule (2026-05-08, post-A3-β): "离线时也不要假装不能做，而是
 * 明确提示'这个任务需要联网/需要配置 provider'，本地可做部分继续做."
 *
 * The classifier maps a failed network-class tool result to one of:
 *   - network_unreachable: offline / DNS / TCP refused / timeout
 *   - provider_missing:    no API key / no usable provider
 *   - auth_missing:        no connected account / OAuth expired
 *   - rate_limited:        429 / quota exceeded
 *   - other:               unknown shape (caller composes a generic line)
 *
 * Constitution (CADRE C):
 *   - 不打补丁: classifier is a pure function on (error, observation,
 *     toolId). No per-task carve-outs.
 *   - 不针对特定提问: regex patterns are domain-class, not prompt-
 *     specific. Adding a new connector tool just means adding the id
 *     prefix (or letting the existing /^account_/ etc. match).
 */

import {
  classifyToolFailure,
  detectNetworkFailureInTranscript,
  formatFailureMessage,
  isNetworkClassTool
} from "../src/service/executors/tool_using/failure-classifier.mjs";
import { localFallbackFinal } from "../src/service/executors/tool_using/finalization.mjs";

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
// 1. classifyToolFailure: each kind has multiple recognisable signals.
// ---------------------------------------------------------------------
{
  // network_unreachable
  for (const error of [
    "fetch failed: ECONNREFUSED 127.0.0.1:443",
    "ETIMEDOUT after 30000ms",
    "getaddrinfo ENOTFOUND example.com",
    "AbortError: timeout",
    "Network request failed",
    // codex round-1 additions
    "EAI_AGAIN temporary failure in name resolution",
    "ECONNABORTED",
    "ENETDOWN",
    "socket hang up",
    "EPROTO",
    // TLS / cert
    "Error: CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID"
  ]) {
    const result = classifyToolFailure({ error, toolId: "fetch_url_content" });
    check(`network_unreachable: '${error.slice(0, 40)}…'`, result.kind === "network_unreachable");
  }

  // provider_missing
  for (const error of [
    "No API key configured for OpenAI",
    "API key is missing",
    "provider not configured",
    "no usable provider for chat",
    "未配置任何 provider"
  ]) {
    const result = classifyToolFailure({ error });
    check(`provider_missing: '${error.slice(0, 40)}…'`, result.kind === "provider_missing");
  }

  // auth_missing
  for (const error of [
    "no connected account for google",
    "401 Unauthorized",
    "invalid_grant: refresh token expired",
    "Please connect your Google account",
    "未连接邮箱",
    // codex round-1: proxy auth
    "407 Proxy Authentication Required",
    "Proxy Authentication Required: Bad gateway"
  ]) {
    const result = classifyToolFailure({ error });
    check(`auth_missing: '${error.slice(0, 40)}…'`, result.kind === "auth_missing");
  }

  // rate_limited
  for (const error of [
    "429 Too Many Requests",
    "rate limit exceeded",
    "quota exceeded for the day",
    "频率限制，请稍后再试",
    // codex round-1: provider-specific aliases
    "RESOURCE_EXHAUSTED: please retry later",
    "insufficient_quota: you exceeded your current quota"
  ]) {
    const result = classifyToolFailure({ error });
    check(`rate_limited: '${error.slice(0, 40)}…'`, result.kind === "rate_limited");
  }

  // other (unknown)
  for (const error of [
    "internal server error",
    "schema validation failed: missing field 'to'",
    "tool_id not found"
  ]) {
    const result = classifyToolFailure({ error });
    check(`other: '${error.slice(0, 40)}…'`, result.kind === "other");
  }
}

// ---------------------------------------------------------------------
// 2. Order matters: 429 > auth > provider > network. A 429 with a
//    timeout-suffixed error string must classify as rate_limited
//    (the actionable fix is "wait", not "reconnect").
// ---------------------------------------------------------------------
{
  const result = classifyToolFailure({
    error: "HTTP 429 Too Many Requests; ETIMEDOUT during retry"
  });
  check("priority: 429 + ETIMEDOUT classifies as rate_limited", result.kind === "rate_limited");

  const result2 = classifyToolFailure({
    error: "401 Unauthorized; ENOTFOUND on retry"
  });
  check("priority: 401 + ENOTFOUND classifies as auth_missing", result2.kind === "auth_missing");
}

// ---------------------------------------------------------------------
// 3. isNetworkClassTool: known IDs + connector / provider prefixes.
// ---------------------------------------------------------------------
{
  for (const id of [
    "web_search_fetch", "fetch_url_content", "open_url", "send_email_smtp",
    "account_send_email", "account_list_emails", "account_search_drive",
    "connector_workflow_run",
    "google.gmail.send_email", "microsoft.outlook.send_email"
  ]) {
    check(`isNetworkClassTool('${id}') = true`, isNetworkClassTool(id) === true);
  }
  for (const id of [
    "read_file_text", "generate_document", "write_file", "render_diagram",
    "verify_file_exists", "take_screenshot", "list_files"
  ]) {
    check(`isNetworkClassTool('${id}') = false`, isNetworkClassTool(id) === false);
  }
}

// ---------------------------------------------------------------------
// 4. detectNetworkFailureInTranscript: pulls the FIRST classified
//    failure; ignores successes and ignores tool failures with
//    non-network classification.
// ---------------------------------------------------------------------
{
  const transcript = [
    { type: "tool_result", tool: "read_file_text", success: true, observation: "ok" },
    { type: "tool_result", tool: "fetch_url_content", success: false, error: "ETIMEDOUT" },
    { type: "tool_result", tool: "web_search_fetch", success: false, error: "401 Unauthorized" }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("detectNetworkFailure: returns the FIRST network-class failure", detected?.kind === "network_unreachable");
  check("detectNetworkFailure: carries the toolId of the failure", detected?.toolId === "fetch_url_content");
}

{
  // No network failures at all.
  const transcript = [
    { type: "tool_result", tool: "read_file_text", success: true, observation: "ok" },
    { type: "tool_result", tool: "generate_document", success: false, error: "schema_invalid" }
  ];
  check("detectNetworkFailure: returns null when no network-class failure",
    detectNetworkFailureInTranscript(transcript) === null);
}

{
  // Network failure with "other" classification — should be skipped
  // (caller will fall back to generic message rather than inventing
  // a non-existent class label).
  const transcript = [
    { type: "tool_result", tool: "fetch_url_content", success: false, error: "internal server error" }
  ];
  check("detectNetworkFailure: skips 'other'-class network failures",
    detectNetworkFailureInTranscript(transcript) === null);
}

// ---------------------------------------------------------------------
// 5. formatFailureMessage: returns bilingual {zh, en}; mentions tool
//    id; suggests a specific next step.
// ---------------------------------------------------------------------
{
  const msg = formatFailureMessage({ kind: "network_unreachable", toolId: "fetch_url_content" });
  check("formatFailureMessage: zh contains '需要联网'", msg.zh.includes("需要联网"));
  check("formatFailureMessage: en contains 'network'", /network/i.test(msg.en));
  check("formatFailureMessage: mentions toolId", msg.zh.includes("fetch_url_content"));
}

{
  const msg = formatFailureMessage({ kind: "provider_missing", toolId: "" });
  check("provider_missing: en mentions 'Console → Providers'", msg.en.includes("Console → Providers"));
  check("provider_missing: zh mentions 'Console → Providers'", msg.zh.includes("Console → Providers"));
}

{
  const msg = formatFailureMessage({ kind: "auth_missing", toolId: "account_send_email" });
  check("auth_missing: en mentions 'Connectors'", msg.en.includes("Connectors"));
  check("auth_missing: zh mentions '重新连接'", msg.zh.includes("重新连接"));
}

{
  const msg = formatFailureMessage({ kind: "rate_limited" });
  check("rate_limited: en mentions 'rate limit'", /rate limit/i.test(msg.en));
  check("rate_limited: zh mentions '速率限制'", msg.zh.includes("速率限制"));
}

{
  const msg = formatFailureMessage({ kind: "offline_mode_blocks", toolId: "fetch_url_content" });
  check("offline_mode_blocks: zh mentions '离线模式'", msg.zh.includes("离线模式"));
  check("offline_mode_blocks: en mentions 'Offline Mode'", msg.en.includes("Offline Mode"));
  check("offline_mode_blocks: zh hints at Console → Privacy",
    msg.zh.includes("Console → Privacy"));
}

{
  const msg = formatFailureMessage({ kind: "kill_switch_enabled", toolId: "" });
  check("kill_switch_enabled: zh mentions '全局停止'", msg.zh.includes("全局停止"));
  check("kill_switch_enabled: en mentions 'kill switch'", /kill switch/i.test(msg.en));
}

{
  const msg = formatFailureMessage({ kind: "other" });
  check("other: returns null (caller composes generic message)", msg === null);
}

// ---------------------------------------------------------------------
// 5b. detectNetworkFailureInTranscript also classifies tool_denied
//     entries that come from the security broker (offline_mode toggle
//     and global kill switch — USER-DELIBERATE blocks). The fix is
//     "toggle off the setting", not "reconnect network", so the
//     message must be different from a network_unreachable.
// ---------------------------------------------------------------------
{
  const transcript = [
    {
      type: "tool_denied",
      tool: "fetch_url_content",
      reason: "offline_mode_blocks_network_tool"
    }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("tool_denied: offline_mode_blocks_network_tool → kind=offline_mode_blocks",
    detected?.kind === "offline_mode_blocks");
  check("tool_denied: carries the toolId", detected?.toolId === "fetch_url_content");
}

{
  const transcript = [
    {
      type: "tool_denied",
      tool: "web_search_fetch",
      reason: "kill_switch_enabled"
    }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("tool_denied: kill_switch_enabled → kind=kill_switch_enabled",
    detected?.kind === "kill_switch_enabled");
}

{
  // Unknown denial reason (e.g. user_denied from approval card) — must
  // not classify as a network blocker. user_denied is a different flow.
  const transcript = [
    { type: "tool_denied", tool: "account_send_email", reason: "user_denied" }
  ];
  check("tool_denied: unknown reason (user_denied) → null",
    detectNetworkFailureInTranscript(transcript) === null);
}

{
  // tool_denied appears BEFORE a tool_result network failure. The
  // denied entry should win because it's the reason the task didn't
  // proceed in the first place.
  const transcript = [
    { type: "tool_denied", tool: "fetch_url_content", reason: "offline_mode_blocks_network_tool" },
    { type: "tool_result", tool: "fetch_url_content", success: false, error: "ENOTFOUND" }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("ordering: tool_denied before tool_result → tool_denied wins",
    detected?.kind === "offline_mode_blocks");
}

// ---------------------------------------------------------------------
// 6. End-to-end via localFallbackFinal: when transcript carries a
//    classified network failure AND a successful tool produced
//    observations, the fallback shows BOTH the local progress AND
//    the classified message. Per R's rule "本地可做部分继续做".
// ---------------------------------------------------------------------
{
  const task = {
    user_command: "搜索最新 AI 论文并总结",
    task_spec: {}
  };
  const transcript = [
    {
      type: "tool_result",
      tool: "read_file_text",
      success: true,
      observation: "user note: focus on retrieval-augmented agents"
    },
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: false,
      error: "ECONNREFUSED 127.0.0.1:443"
    }
  ];
  const final = localFallbackFinal({ task, transcript });
  check("e2e/zh: local progress preserved (note observation appears)",
    final.includes("retrieval-augmented agents"));
  check("e2e/zh: classified network message appended",
    final.includes("需要联网") && final.includes("web_search_fetch"));
}

{
  const task = {
    user_command: "search for the latest news on quantum computing",
    task_spec: {}
  };
  const transcript = [
    {
      type: "tool_result",
      tool: "fetch_url_content",
      success: false,
      error: "API key is missing"
    }
  ];
  const final = localFallbackFinal({ task, transcript });
  check("e2e/en: classified provider_missing message renders",
    /provider configured/i.test(final) && /Console.+Providers/.test(final));
}

{
  const task = {
    user_command: "send email to alice",
    task_spec: {}
  };
  const transcript = [
    {
      type: "tool_result",
      tool: "account_send_email",
      success: false,
      error: "no connected account for google"
    }
  ];
  const final = localFallbackFinal({ task, transcript });
  check("e2e/en (no obs): auth_missing message stands alone",
    /connected account/i.test(final) && /Connectors/.test(final));
}

// ---------------------------------------------------------------------
// 6b. Integration test against the REAL tool_using transcript shape
//     (codex round-1 finding). agent-loop builds entries with shape:
//     { type:"tool_result", tool, args, success, observation, metadata,
//       artifact_paths, [error] }. The `error` field was newly added
//     in this commit so the classifier can see typed error strings
//     directly (not just observation prose). This test asserts the
//     classifier reads from the real shape.
// ---------------------------------------------------------------------
{
  // Real tool_using shape with error populated separately from observation.
  const transcript = [
    {
      type: "tool_result",
      tool: "fetch_url_content",
      args: { url: "https://example.com" },
      success: false,
      observation: "Failed to fetch the page.",
      metadata: { tool_id: "fetch_url_content" },
      artifact_paths: [],
      error: "fetch failed: ENOTFOUND example.com"
    }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("integration: classifier reads tool_using-shape entry.error",
    detected?.kind === "network_unreachable");
}

{
  // Auth-missing case via account_send_email (real connector shape).
  const transcript = [
    {
      type: "tool_result",
      tool: "account_send_email",
      args: { provider: "google", to: "alice@example.com" },
      success: false,
      observation: "Connector workflow halted before send.",
      metadata: { tool_id: "account_send_email" },
      artifact_paths: [],
      error: "no connected account for google"
    }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("integration: account_send_email entry.error → auth_missing",
    detected?.kind === "auth_missing");
}

{
  // Provider missing via web_search_fetch with the typed error.
  const transcript = [
    {
      type: "tool_result",
      tool: "web_search_fetch",
      args: { query: "x" },
      success: false,
      observation: "search backend unavailable",
      metadata: { tool_id: "web_search_fetch" },
      artifact_paths: [],
      error: "API key is missing for the configured search provider"
    }
  ];
  const detected = detectNetworkFailureInTranscript(transcript);
  check("integration: web_search_fetch entry.error → provider_missing",
    detected?.kind === "provider_missing");
}

// ---------------------------------------------------------------------
// 6c. E2E via localFallbackFinal for the user-deliberate block paths.
//     User toggled offline mode → final_text says "你已启用离线模式";
//     user toggled kill switch → final_text says "全局停止开关".
//
// codex round-1 pointed out that the agent-loop's security-denied
// return path used to short-circuit with a raw "Blocked tool ...:
// offline_mode_blocks_network_tool" string before localFallbackFinal
// ran. That call site now ALSO routes through localFallbackFinal so
// the same bilingual classified message reaches the user. The two
// e2e tests here cover both shapes; the real call-site change is
// in agent-loop.mjs:1816 — exercised through this finaliser path.
// ---------------------------------------------------------------------
{
  const task = { user_command: "搜索最新论文", task_spec: {} };
  const transcript = [
    { type: "tool_denied", tool: "fetch_url_content", reason: "offline_mode_blocks_network_tool" }
  ];
  const final = localFallbackFinal({ task, transcript });
  check("e2e/zh: offline_mode_blocks message rendered",
    final.includes("离线模式") && final.includes("Console → Privacy"));
}

{
  const task = { user_command: "send email", task_spec: {} };
  const transcript = [
    { type: "tool_denied", tool: "account_send_email", reason: "kill_switch_enabled" }
  ];
  const final = localFallbackFinal({ task, transcript });
  check("e2e/en: kill_switch_enabled message rendered",
    /kill switch/i.test(final) && /Console.+Privacy/.test(final));
}

// ---------------------------------------------------------------------
// 6d. Integration test: drive the REAL agent-loop denial path via a
//     stub broker that returns offline_mode_blocks_network_tool. This
//     proves the user actually sees the classified message — not the
//     raw "Blocked tool ..." literal — when the security broker
//     denies a network tool. (codex round-1 caught this seam.)
// ---------------------------------------------------------------------
{
  const { runToolAgentLoop } = await import("../src/service/executors/tool_using/agent-loop.mjs");
  const stubProvider = {
    async generate() {
      return { content: [{ type: "text", text: "fallback prose" }] };
    }
  };
  // Planner returns a single fetch_url_content tool call.
  const stubPlanner = async () => ({
    type: "tool_call",
    tool: "fetch_url_content",
    args: { url: "https://example.com" }
  });
  const fetchTool = {
    id: "fetch_url_content",
    name: "Fetch URL Content",
    description: "stub",
    policy_group: "external_web_read",
    required_capabilities: ["network"],
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"]
    },
    risk_level: "low",
    execute: async () => ({ success: true, observation: "should not run" })
  };
  const stubRuntime = {
    actionToolRegistry: {
      list() { return [fetchTool]; },
      get(id) { return id === "fetch_url_content" ? fetchTool : null; },
      evaluate() { return { requires_confirmation: false }; },
      async call() { throw new Error("registry.call should not be invoked when broker denies"); }
    },
    securityBroker: {
      authorizeToolCall() {
        return { allowed: false, reason: "offline_mode_blocks_network_tool" };
      }
    },
    emitTaskEvent() {},
    store: { appendAuditLog() {} },
    toolContext: {},
    toolOutputDir: "/tmp"
  };
  const task = {
    task_id: "task_offline_e2e",
    user_command: "搜索最新论文",
    task_spec: {}
  };
  const result = await runToolAgentLoop({
    task,
    runtime: stubRuntime,
    planner: stubPlanner,
    provider: stubProvider,
    maxIterations: 1
  });
  check("real-loop denial: status = partial_success", result.status === "partial_success");
  check("real-loop denial: final_text contains classified offline-mode message",
    result.final_text.includes("离线模式") && result.final_text.includes("Console → Privacy"));
  check("real-loop denial: final_text does NOT show raw 'offline_mode_blocks_network_tool' to the user",
    !result.final_text.includes("offline_mode_blocks_network_tool"));
}

// ---------------------------------------------------------------------
// 7. Regression: when there's NO network failure at all, the existing
//    fallback shape is unchanged (don't accidentally inject "needs
//    network" into pure local-only failures).
// ---------------------------------------------------------------------
{
  const task = { user_command: "总结这个文件", task_spec: {} };
  const transcript = [
    { type: "tool_result", tool: "read_file_text", success: false, error: "ENOENT: file not found" }
  ];
  const final = localFallbackFinal({ task, transcript });
  check("regression: no network failure → no '需要联网' / 'network' injection",
    !final.includes("需要联网") && !/needs the network/i.test(final));
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
