#!/usr/bin/env node
// Opt-in live acceptance for generated artifacts across follow-up turns:
// create, inspect, transform, execute file-based checks, and topic-switch isolation.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
    taskTimeoutMs: 240_000,
    live: process.env.LINGXY_FOLLOWUP_ARTIFACT_ACCEPTANCE === "1",
    outputDir: path.resolve(".tmp", "followup-artifact-acceptance")
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

async function postTask({
  userCommand,
  conversationId = null,
  parentTaskId = null,
  sourceApp = "followup-artifact-acceptance"
}) {
  const body = {
    userCommand,
    sourceType: "console",
    sourceApp,
    background: true
  };
  if (conversationId) body.conversation_id = conversationId;
  if (parentTaskId) body.parent_task_id = parentTaskId;
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
  return taskId;
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
  return Boolean(finalText(record) || artifactPaths(record).length > 0);
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
  const taskId = await postTask(input);
  return pollTask(taskId);
}

function eventToolIds(record = {}) {
  const ids = [];
  for (const event of record.events ?? []) {
    const id = event?.payload?.tool_id ?? event?.payload?.tool ?? event?.payload?.id;
    if (typeof id === "string" && id) ids.push(id);
  }
  return [...new Set(ids)];
}

function artifactPaths(record = {}) {
  const paths = [];
  for (const artifact of record.artifacts ?? []) {
    if (typeof artifact?.path === "string" && artifact.path) paths.push(artifact.path);
  }
  for (const event of record.events ?? []) {
    const payload = event?.payload ?? {};
    if (typeof payload.path === "string") paths.push(payload.path);
    if (Array.isArray(payload.artifact_paths)) {
      paths.push(...payload.artifact_paths.filter((item) => typeof item === "string"));
    }
    if (Array.isArray(payload.artifacts)) {
      for (const item of payload.artifacts) {
        if (typeof item === "string") paths.push(item);
        else if (typeof item?.path === "string") paths.push(item.path);
      }
    }
  }
  return [...new Set(paths)];
}

function readTextIfSmall(filePath) {
  if (!filePath || !existsSync(filePath)) return "";
  const size = statSync(filePath).size;
  if (size > 2_000_000) return "";
  return readFileSync(filePath, "utf8");
}

function artifactWithContent(record, { extension, includes }) {
  for (const filePath of artifactPaths(record)) {
    if (extension && !filePath.toLowerCase().endsWith(extension)) continue;
    const text = readTextIfSmall(filePath);
    if (includes.every((marker) => text.includes(marker))) {
      return { path: filePath, textHead: text.slice(0, 180) };
    }
  }
  return null;
}

function compactTask(record = {}) {
  const metrics = collectTokenMetrics(record.events ?? []);
  return {
    task_id: record?.task?.task_id ?? null,
    status: record?.task?.status ?? null,
    parent_task_id: record?.task?.parent_task_id ?? null,
    conversation_id: record?.task?.conversation_id ?? null,
    final_text_head: finalText(record).slice(0, 180),
    tool_ids: eventToolIds(record),
    artifact_paths: artifactPaths(record),
    token_usage: metrics.token_usage,
    llm_usage_call_count: metrics.llm_usage_call_count
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

function passFail(condition) {
  return condition ? "pass" : "fail";
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
      scenario("html_artifact_created", "skipped", "POST /task generate html", "dry run only"),
      scenario("followup_html_from_artifact", "skipped", "POST /task parent html", "dry run only"),
      scenario("followup_execute_generated_artifact_check", "skipped", "POST /task parent html + run_script", "dry run only"),
      scenario("same_conversation_topic_switch", "skipped", "POST /task same conversation new topic", "dry run only"),
      scenario("new_topic_followup_isolation", "skipped", "POST /task parent topic-switch", "dry run only"),
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
    redaction: "reports include artifact paths and short result heads only; secret-like values are redacted"
  };
}

async function buildLiveReport() {
  const child = await startRuntimeIfNeeded();
  const runId = safeIdPart();
  const conversationId = `artifact_acceptance_${runId}`;
  const htmlMarker = `LXHTML-${runId}`.toUpperCase();
  const summaryMarker = `LXSUMMARY-${runId}`.toUpperCase();
  const execMarker = `LXEXEC-${runId}`.toUpperCase();
  const topicMarker = "5";
  const topicFollowMarker = "20";
  const tasks = [];
  const scenarios = [];

  try {
    const htmlTask = await runTask({
      conversationId,
      userCommand: `生成一个 HTML 文件，文件名 followup_artifact_seed_${runId}.html，title 和正文都必须包含 ${htmlMarker}。必须保存为真实文件，不要只在回复里给代码。`,
      sourceApp: "followup-artifact-acceptance:html"
    });
    const htmlArtifact = artifactWithContent(htmlTask, { extension: ".html", includes: [htmlMarker] });
    tasks.push(compactTask(htmlTask));
    scenarios.push(scenario(
      "html_artifact_created",
      passFail(htmlTask?.task?.status !== "failed" && Boolean(htmlArtifact)),
      "POST /task generate html artifact",
      htmlArtifact
        ? `artifact ${htmlArtifact.path} contains ${htmlMarker}`
        : `status=${htmlTask?.task?.status ?? "unknown"}; artifacts=${artifactPaths(htmlTask).join(", ")}`
    ));

    const derivedTask = await runTask({
      conversationId,
      parentTaskId: htmlTask?.task?.task_id ?? null,
      userCommand: `继续：读取上一个生成的 HTML 文件，并基于它生成第二个 HTML 摘要文件，文件名 followup_artifact_summary_${runId}.html，title 和正文必须包含 ${summaryMarker} 和 ${htmlMarker}。`,
      sourceApp: "followup-artifact-acceptance:derived-html"
    });
    const derivedArtifact = artifactWithContent(derivedTask, { extension: ".html", includes: [summaryMarker, htmlMarker] });
    const derivedLinked = derivedTask?.task?.parent_task_id === htmlTask?.task?.task_id
      && derivedTask?.task?.conversation_id === conversationId;
    tasks.push(compactTask(derivedTask));
    scenarios.push(scenario(
      "followup_html_from_artifact",
      passFail(derivedTask?.task?.status !== "failed" && Boolean(derivedArtifact) && derivedLinked),
      "POST /task parent html artifact, generate derived html",
      derivedArtifact && derivedLinked
        ? `follow-up html ${derivedArtifact.path} contains both markers`
        : `linked=${derivedLinked}; status=${derivedTask?.task?.status ?? "unknown"}; final=${finalText(derivedTask).slice(0, 120)}`
    ));

    const execTask = await runTask({
      conversationId,
      parentTaskId: derivedTask?.task?.task_id ?? null,
      userCommand: `继续：用 Node.js 执行一段脚本读取上一个生成的 HTML 文件，确认文件内容包含 ${summaryMarker} 和 ${htmlMarker}，并只回答 ${execMarker}。`,
      sourceApp: "followup-artifact-acceptance:execute"
    });
    const execLinked = execTask?.task?.parent_task_id === derivedTask?.task?.task_id
      && execTask?.task?.conversation_id === conversationId;
    const execUsedTool = eventToolIds(execTask).includes("run_script");
    const execAnswered = finalText(execTask).includes(execMarker);
    tasks.push(compactTask(execTask));
    scenarios.push(scenario(
      "followup_execute_generated_artifact_check",
      passFail(execTask?.task?.status !== "failed" && execLinked && execUsedTool && execAnswered),
      "POST /task parent generated artifact, validate with run_script",
      execLinked && execUsedTool && execAnswered
        ? `run_script validated generated artifact content and final answer included ${execMarker}`
        : `linked=${execLinked}; run_script=${execUsedTool}; status=${execTask?.task?.status ?? "unknown"}; final=${finalText(execTask).slice(0, 120)}`
    ));

    const topicTask = await runTask({
      conversationId,
      userCommand: "换个完全无关的问题：2+3 等于几？只回答数字，不要引用之前生成的文件或标记。",
      sourceApp: "followup-artifact-acceptance:topic-switch"
    });
    const topicText = finalText(topicTask);
    const topicClean = /\b5\b/u.test(topicText)
      && !topicText.includes(htmlMarker)
      && !topicText.includes(summaryMarker)
      && !topicText.includes(execMarker)
      && !topicTask?.task?.parent_task_id;
    tasks.push(compactTask(topicTask));
    scenarios.push(scenario(
      "same_conversation_topic_switch",
      passFail(topicTask?.task?.status !== "failed" && topicClean),
      "POST /task same conversation without parent_task_id",
      topicClean
        ? "new-topic turn answered 5 without stale artifact markers or parent binding"
        : `parent=${topicTask?.task?.parent_task_id ?? "null"}; final=${topicText.slice(0, 120)}`
    ));

    const topicFollowTask = await runTask({
      conversationId,
      parentTaskId: topicTask?.task?.task_id ?? null,
      userCommand: "继续：把刚才那个数字乘以 4，只回答数字。",
      sourceApp: "followup-artifact-acceptance:topic-followup"
    });
    const topicFollowText = finalText(topicFollowTask);
    const topicFollowClean = topicFollowTask?.task?.parent_task_id === topicTask?.task?.task_id
      && topicFollowTask?.task?.conversation_id === conversationId
      && topicFollowText.includes(topicFollowMarker)
      && !topicFollowText.includes(htmlMarker)
      && !topicFollowText.includes(summaryMarker)
      && !topicFollowText.includes(execMarker);
    tasks.push(compactTask(topicFollowTask));
    scenarios.push(scenario(
      "new_topic_followup_isolation",
      passFail(topicFollowTask?.task?.status !== "failed" && topicFollowClean),
      "POST /task parent topic-switch turn",
      topicFollowClean
        ? "follow-up bound to the new math turn and answered 20 without stale artifact markers"
        : `parent=${topicFollowTask?.task?.parent_task_id ?? "null"}; final=${topicFollowText.slice(0, 120)}`
    ));

    const tokenCache = sumTokenUsage(tasks);
    scenarios.push(scenario(
      "token_cache_trace",
      passFail(tokenCache.llm_usage_call_count > 0 && tokenCache.total_tokens > 0),
      "collect llm_usage from artifact follow-up task events",
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
      markers: { htmlMarker, summaryMarker, execMarker, conversationId },
      scenarios,
      tasks,
      tokenCache: {
        ...tokenCache,
        cost_display: "not_displayed_token_trace_only"
      },
      redaction: "reports include artifact paths and short result heads only; secret-like values are redacted"
    };
  } finally {
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
}

function validateReport(report = {}) {
  const requiredIds = [
    "html_artifact_created",
      "followup_html_from_artifact",
      "followup_execute_generated_artifact_check",
    "same_conversation_topic_switch",
    "new_topic_followup_isolation",
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
  console.error("[followup-artifact-acceptance] fatal:", error);
  process.exit(2);
});
