#!/usr/bin/env node
// Opt-in live acceptance for follow-up continuity, user memory governance,
// scoped context memory, and token/cache traces.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  detectLiveProviderAcceptanceSecretLeaks,
  redactLiveProviderAcceptanceReport
} from "../../src/shared/live-provider-acceptance-harness.mjs";
import { collectTokenMetrics } from "./token-metrics.mjs";

const TERMINAL_STATUSES = new Set(["success", "partial_success", "failed", "cancelled"]);

function parseArgs(argv) {
  const out = {
    port: Number(process.env.UCA_PORT || 4350),
    spawnRuntime: true,
    taskTimeoutMs: 180_000,
    live: process.env.LINGXY_CONTEXT_MEMORY_CACHE_ACCEPTANCE === "1",
    outputDir: path.resolve(".tmp", "context-memory-cache-acceptance")
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--task-timeout") out.taskTimeoutMs = Number(argv[++i]);
    else if (arg === "--no-spawn") out.spawnRuntime = false;
    else if (arg === "--live") out.live = true;
    else if (arg === "--output-dir") out.outputDir = path.resolve(argv[++i]);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = `http://127.0.0.1:${ARGS.port}`;
const ACTOR_HEADERS = { "x-lingxy-desktop-actor": "desktop_console" };

function currentGit(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

function safeIdPart() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

async function probeHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // wait for runtime
    }
    await sleep(250);
  }
  return false;
}

async function startRuntimeIfNeeded() {
  if (await probeHealth(1500)) return null;
  if (!ARGS.spawnRuntime) throw new Error(`No runtime at ${BASE_URL} and --no-spawn was set.`);
  const child = spawn(process.execPath, ["scripts/start-runtime.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, UCA_PORT: String(ARGS.port) },
    stdio: ["ignore", "inherit", "inherit"]
  });
  if (!await probeHealth(60_000)) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    throw new Error("runtime did not become healthy");
  }
  return child;
}

async function requestJson(method, pathname, body = null, timeoutMs = 30_000) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      ...ACTOR_HEADERS,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${method} ${pathname} ${response.status}: ${text.slice(0, 220)}`);
  return data;
}

async function getJson(pathname) {
  return requestJson("GET", pathname, null, 15_000);
}

async function postJson(pathname, body, timeoutMs = 30_000) {
  return requestJson("POST", pathname, body, timeoutMs);
}

async function postTask({
  userCommand,
  conversationId = null,
  parentTaskId = null,
  projectId = null,
  sourceApp = "context-memory-cache-acceptance"
}) {
  const body = {
    userCommand,
    sourceType: "console",
    sourceApp,
    background: true
  };
  if (conversationId) body.conversation_id = conversationId;
  if (parentTaskId) body.parent_task_id = parentTaskId;
  if (projectId) {
    body.project_id = projectId;
    body.selectionMetadata = { project_id: projectId };
  }
  const response = await fetch(`${BASE_URL}/task`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...ACTOR_HEADERS
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`POST /task ${response.status}: ${text.slice(0, 220)}`);
  const taskId = data?.task_id ?? data?.task?.task_id ?? null;
  if (!taskId) throw new Error(`POST /task missing task_id: ${text.slice(0, 220)}`);
  return { taskId, immediate: data?.task ? data : null };
}

function finalText(record = {}) {
  if (typeof record?.task?.final_text === "string" && record.task.final_text.trim()) {
    return record.task.final_text;
  }
  for (let i = (record.events ?? []).length - 1; i >= 0; i -= 1) {
    const event = record.events[i];
    if (typeof event?.payload?.text === "string" && event.payload.text.trim()) {
      if (["inline_result", "success", "partial_success", "failed"].includes(event.event_type)) {
        return event.payload.text;
      }
    }
  }
  return "";
}

function hasFinalSignal(record = {}) {
  return Boolean(finalText(record) || (record.artifacts ?? []).length > 0);
}

async function pollTask(taskId) {
  const deadline = Date.now() + ARGS.taskTimeoutMs;
  const backoffs = [100, 200, 400, 800, 1500, 3000];
  let i = 0;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/task/${encodeURIComponent(taskId)}`, {
        headers: ACTOR_HEADERS,
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        last = await response.json();
        if (TERMINAL_STATUSES.has(last?.task?.status) && hasFinalSignal(last)) return last;
      }
    } catch {
      // tolerate runtime flaps while the task is running
    }
    await sleep(backoffs[Math.min(i, backoffs.length - 1)]);
    i += 1;
  }
  return last;
}

async function runTask(input) {
  const posted = await postTask(input);
  return pollTask(posted.taskId);
}

function passedWithMarker(record, marker) {
  return TERMINAL_STATUSES.has(record?.task?.status)
    && record?.task?.status !== "failed"
    && finalText(record).includes(marker);
}

function compactTask(record = {}) {
  const metrics = collectTokenMetrics(record.events ?? []);
  return {
    task_id: record?.task?.task_id ?? null,
    status: record?.task?.status ?? null,
    parent_task_id: record?.task?.parent_task_id ?? null,
    conversation_id: record?.task?.conversation_id ?? null,
    final_text_head: finalText(record).slice(0, 160),
    token_usage: metrics.token_usage,
    llm_usage_call_count: metrics.llm_usage_call_count,
    prompt_estimate_calibration: metrics.prompt_estimate_calibration,
    llm_call_sites: (metrics.llm_usage_calls ?? []).map((call) => ({
      call_site: call.call_site,
      provider_id: call.provider_id,
      provider_kind: call.provider_kind,
      model: call.model,
      cache_hit_tokens: call.usage?.cache_hit_tokens ?? 0,
      cache_miss_tokens: call.usage?.cache_miss_tokens ?? 0
    }))
  };
}

function sumTokenUsage(tasks = []) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    llm_usage_call_count: 0
  };
  for (const task of tasks) {
    const usage = task?.token_usage ?? {};
    totals.input_tokens += Number(usage.input_tokens ?? 0);
    totals.output_tokens += Number(usage.output_tokens ?? 0);
    totals.total_tokens += Number(usage.total_tokens ?? 0);
    totals.cache_hit_tokens += Number(usage.cache_hit_tokens ?? 0);
    totals.cache_miss_tokens += Number(usage.cache_miss_tokens ?? 0);
    totals.llm_usage_call_count += Number(task?.llm_usage_call_count ?? 0);
  }
  if (totals.total_tokens === 0) totals.total_tokens = totals.input_tokens + totals.output_tokens;
  return totals;
}

function scenario(id, status, command, evidence, extra = {}) {
  return { id, status, command, evidence, ...extra };
}

async function buildDryRunReport() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commit: currentGit(["rev-parse", "--short", "HEAD"]),
    branch: currentGit(["branch", "--show-current"]),
    mode: "dry_run",
    liveOptIn: false,
    runtimeBaseUrl: BASE_URL,
    scenarios: [
      scenario("memory_backup_restore", "skipped", "GET/POST /config/user-memory", "dry run only"),
      scenario("memory_proposal_review", "skipped", "POST /config/user-memory/proposals", "dry run only"),
      scenario("user_memory_injection", "skipped", "POST /task", "dry run only"),
      scenario("project_memory_scope", "skipped", "POST /task project_id", "dry run only"),
      scenario("followup_context", "skipped", "POST /task parent_task_id + conversation_id", "dry run only"),
      scenario("token_cache_trace", "skipped", "collect llm_usage", "dry run only")
    ],
    tokenCache: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cache_hit_tokens: 0,
      cache_miss_tokens: 0,
      cost_display: "not_displayed_token_trace_only"
    },
    redaction: "reports omit prompts beyond short final text heads and redact secret-like values"
  };
}

async function buildLiveReport() {
  const child = await startRuntimeIfNeeded();
  let backupMemory = null;
  let restored = false;
  const tasks = [];
  const runId = safeIdPart();
  const memoryMarker = `LXMEM-${runId}`.toUpperCase();
  const projectMarker = `LXPROJ-${runId}`.toUpperCase();
  const followMarker = `LXFOLLOW-${runId}`.toUpperCase();
  const projectId = `acceptance_project_${runId}`;
  const followConversationId = `acceptance_conversation_${runId}`;
  const scenarios = [];

  try {
    const health = await getJson("/health");
    const initialMemory = await getJson("/config/user-memory");
    backupMemory = initialMemory.userMemory ?? {};
    scenarios.push(scenario(
      "memory_backup_restore",
      health?.ok === true && backupMemory ? "pass" : "fail",
      "GET /health + GET /config/user-memory",
      health?.ok === true ? "runtime healthy and user memory backup captured" : "runtime health check failed"
    ));

    const projectMemory = {
      ...(backupMemory ?? {}),
      projectMemories: [
        ...(backupMemory?.projectMemories ?? []),
        {
          id: `project_${runId}`,
          projectId,
          text: `Project acceptance marker is ${projectMarker}.`
        }
      ]
    };
    await postJson("/config/user-memory", { userMemory: projectMemory });

    const proposalPayload = await postJson("/config/user-memory/proposals", {
      type: "user_preference",
      scope: "global",
      source: "context_memory_cache_acceptance",
      text: `Approved acceptance memory marker is ${memoryMarker}.`
    });
    const proposalId = proposalPayload.proposal?.proposalId;
    if (!proposalId) throw new Error("memory proposal response missing proposalId");
    const approvedPayload = await postJson(`/config/user-memory/proposals/${encodeURIComponent(proposalId)}`, {
      action: "approve"
    });
    const approvedMemory = approvedPayload.userMemory?.approvedMemories?.find((item) =>
      String(item?.text ?? "").includes(memoryMarker)
    );
    const review = approvedPayload.userMemory?.reviewHistory?.find((item) =>
      item?.proposalId === proposalId && item?.action === "approve_proposal"
    );
    scenarios.push(scenario(
      "memory_proposal_review",
      approvedMemory && review ? "pass" : "fail",
      "POST /config/user-memory/proposals + POST /config/user-memory/proposals/:id action=approve",
      approvedMemory && review
        ? `proposal ${proposalId} approved into governed memory ${approvedMemory.id}`
        : `proposal approval missing governed memory or review history; proposal=${proposalId ?? "missing"}`
    ));

    const memoryTask = await runTask({
      userCommand: "根据已审核用户记忆回答：批准的验收记忆标记是什么？只回答标记本身。",
      sourceApp: "context-memory-cache-acceptance:memory"
    });
    tasks.push(compactTask(memoryTask));
    scenarios.push(scenario(
      "user_memory_injection",
      passedWithMarker(memoryTask, memoryMarker) ? "pass" : "fail",
      "POST /task with approved global user memory",
      passedWithMarker(memoryTask, memoryMarker)
        ? `model answered approved memory marker ${memoryMarker}`
        : `status=${memoryTask?.task?.status ?? "unknown"}; final=${finalText(memoryTask).slice(0, 120)}`
    ));

    const projectTask = await runTask({
      userCommand: "根据当前项目记忆回答：带有 LXPROJ 前缀的项目验收标记是什么？只回答标记本身。",
      projectId,
      sourceApp: "context-memory-cache-acceptance:project"
    });
    tasks.push(compactTask(projectTask));
    scenarios.push(scenario(
      "project_memory_scope",
      passedWithMarker(projectTask, projectMarker) ? "pass" : "fail",
      "POST /task with project_id selection metadata",
      passedWithMarker(projectTask, projectMarker)
        ? `model answered scoped project marker ${projectMarker}`
        : `status=${projectTask?.task?.status ?? "unknown"}; final=${finalText(projectTask).slice(0, 120)}`
    ));

    const seedTask = await runTask({
      userCommand: `请记住本轮追问验收代号 ${followMarker}，并只回复“已记录”。`,
      conversationId: followConversationId,
      sourceApp: "context-memory-cache-acceptance:followup-seed"
    });
    tasks.push(compactTask(seedTask));
    const followTask = await runTask({
      userCommand: "继续：只回答刚才的追问验收代号。",
      conversationId: seedTask?.task?.conversation_id ?? followConversationId,
      parentTaskId: seedTask?.task?.task_id ?? null,
      sourceApp: "context-memory-cache-acceptance:followup"
    });
    tasks.push(compactTask(followTask));
    const followLinked = followTask?.task?.parent_task_id === seedTask?.task?.task_id
      && followTask?.task?.conversation_id === seedTask?.task?.conversation_id;
    scenarios.push(scenario(
      "followup_context",
      passedWithMarker(followTask, followMarker) && followLinked ? "pass" : "fail",
      "POST /task seed, then POST /task parent_task_id + conversation_id",
      passedWithMarker(followTask, followMarker) && followLinked
        ? `follow-up linked to parent ${seedTask?.task?.task_id} and answered ${followMarker}`
        : `linked=${followLinked}; status=${followTask?.task?.status ?? "unknown"}; final=${finalText(followTask).slice(0, 120)}`
    ));

    const tokenCache = sumTokenUsage(tasks);
    scenarios.push(scenario(
      "token_cache_trace",
      tokenCache.llm_usage_call_count > 0 && tokenCache.total_tokens > 0 ? "pass" : "fail",
      "collect llm_usage from acceptance task events",
      tokenCache.llm_usage_call_count > 0
        ? `tokens=${tokenCache.total_tokens}; input=${tokenCache.input_tokens}; output=${tokenCache.output_tokens}; cache_hit=${tokenCache.cache_hit_tokens}; cache_miss=${tokenCache.cache_miss_tokens}`
        : "no llm_usage token/cache events observed"
    ));

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      commit: currentGit(["rev-parse", "--short", "HEAD"]),
      branch: currentGit(["branch", "--show-current"]),
      mode: "live",
      liveOptIn: true,
      runtimeBaseUrl: BASE_URL,
      scenarios,
      markers: { memoryMarker, projectMarker, followMarker, projectId, followConversationId },
      tasks,
      tokenCache: {
        ...sumTokenUsage(tasks),
        cost_display: "not_displayed_token_trace_only"
      },
      redaction: "reports omit prompts beyond short final text heads and redact secret-like values"
    };
  } finally {
    if (backupMemory) {
      try {
        await postJson("/config/user-memory", { userMemory: backupMemory });
        restored = true;
      } catch (error) {
        scenarios.push(scenario(
          "memory_backup_restore",
          "fail",
          "POST /config/user-memory restore",
          `failed to restore backup memory: ${error?.message ?? String(error)}`
        ));
      }
    }
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
    if (!restored && backupMemory) {
      console.error("[context-memory-cache-acceptance] warning: failed to restore user memory backup");
    }
  }
}

function validateReport(report = {}) {
  const requiredIds = [
    "memory_backup_restore",
    "memory_proposal_review",
    "user_memory_injection",
    "project_memory_scope",
    "followup_context",
    "token_cache_trace"
  ];
  const missing = [];
  if (report.schemaVersion !== 1) missing.push("schemaVersion");
  if (!["dry_run", "live"].includes(report.mode)) missing.push("mode");
  if (!Array.isArray(report.scenarios)) missing.push("scenarios");
  for (const id of requiredIds) {
    if (!report.scenarios?.some((scenario) => scenario.id === id)) missing.push(`scenario.${id}`);
  }
  if (!report.tokenCache || typeof report.tokenCache !== "object") missing.push("tokenCache");
  if (report.tokenCache?.cost_display !== "not_displayed_token_trace_only") missing.push("tokenCache.cost_display");
  const leaks = detectLiveProviderAcceptanceSecretLeaks(report);
  return { ok: missing.length === 0 && leaks.length === 0, missing, leaks };
}

function writeReport(report) {
  mkdirSync(ARGS.outputDir, { recursive: true });
  const file = path.join(ARGS.outputDir, `report-${nowStamp()}.json`);
  const redacted = redactLiveProviderAcceptanceReport(report);
  writeFileSync(file, JSON.stringify(redacted, null, 2), "utf8");
  return file;
}

async function main() {
  const report = ARGS.live ? await buildLiveReport() : await buildDryRunReport();
  const redacted = redactLiveProviderAcceptanceReport(report);
  const file = writeReport(redacted);
  const validation = validateReport(redacted);
  const failing = ARGS.live
    ? redacted.scenarios.filter((item) => item.status === "fail").map((item) => item.id)
    : [];
  console.log(JSON.stringify({
    ok: validation.ok && failing.length === 0,
    mode: redacted.mode,
    liveOptIn: redacted.liveOptIn,
    report: path.relative(process.cwd(), file),
    tokenCache: redacted.tokenCache,
    failing,
    missing: validation.missing,
    leaks: validation.leaks
  }, null, 2));
  if (!validation.ok || failing.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[context-memory-cache-acceptance] fatal:", error);
  process.exit(2);
});
