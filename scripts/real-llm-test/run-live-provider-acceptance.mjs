#!/usr/bin/env node
// Opt-in live provider acceptance harness.
//
// Default mode is deterministic dry-run: it validates report shape and writes
// a secret-free evidence template. Live mode requires either --live or
// LINGXY_LIVE_PROVIDER_ACCEPTANCE=1.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import pricing from "../../src/service/cost/pricing.mjs";
import {
  buildLiveProviderAcceptanceReport,
  redactLiveProviderAcceptanceReport,
  validateLiveProviderAcceptanceReport
} from "../../src/shared/live-provider-acceptance-harness.mjs";
import { collectTokenMetrics } from "./token-metrics.mjs";

function parseArgs(argv) {
  const out = {
    port: Number(process.env.UCA_PORT || 4350),
    spawnRuntime: true,
    taskTimeoutMs: 180_000,
    live: process.env.LINGXY_LIVE_PROVIDER_ACCEPTANCE === "1",
    outputDir: path.resolve(".tmp", "live-provider-acceptance")
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

function currentGit(args) {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
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

async function getJson(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: { "x-lingxy-desktop-actor": "desktop_console" },
    signal: AbortSignal.timeout(15_000)
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`GET ${pathname} ${response.status}: ${text.slice(0, 200)}`);
  return data;
}

async function postTask() {
  const response = await fetch(`${BASE_URL}/task`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lingxy-desktop-actor": "desktop_console"
    },
    body: JSON.stringify({
      userCommand: "Reply with exactly: LINGXY_LIVE_PROVIDER_ACCEPTANCE_OK",
      sourceType: "console",
      sourceApp: "live-provider-acceptance",
      background: true
    }),
    signal: AbortSignal.timeout(60_000)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`POST /task ${response.status}: ${text.slice(0, 200)}`);
  const taskId = data?.task_id ?? data?.task?.task_id ?? null;
  if (!taskId) throw new Error(`POST /task missing task id: ${text.slice(0, 200)}`);
  return taskId;
}

function finalText(record = {}) {
  if (record?.task?.final_text) return String(record.task.final_text);
  for (let i = (record.events ?? []).length - 1; i >= 0; i -= 1) {
    const event = record.events[i];
    if (event?.payload?.text && ["inline_result", "success", "partial_success", "failed"].includes(event.event_type)) {
      return String(event.payload.text);
    }
  }
  return "";
}

function terminalWithSignal(record = {}) {
  const status = record?.task?.status;
  return ["success", "partial_success", "failed", "cancelled"].includes(status)
    && Boolean(finalText(record) || (record.artifacts ?? []).length > 0);
}

async function pollTask(taskId) {
  const deadline = Date.now() + ARGS.taskTimeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await fetch(`${BASE_URL}/task/${encodeURIComponent(taskId)}`, {
      headers: { "x-lingxy-desktop-actor": "desktop_console" },
      signal: AbortSignal.timeout(10_000)
    });
    if (response.ok) {
      last = await response.json();
      if (terminalWithSignal(last)) return last;
    }
    await sleep(1000);
  }
  return last;
}

function chooseProvider(providers = []) {
  return providers.find((provider) => provider?.configured === true && provider?.available !== false)
    ?? providers.find((provider) => provider?.configured === true)
    ?? providers[0]
    ?? null;
}

function providerEvidence(provider = null) {
  if (!provider) return "no provider returned by /ai/providers";
  return `provider ${provider.id ?? "unknown"} configured=${provider.configured === true} available=${provider.available === true}`;
}

function estimateCost(provider = null, usage = null) {
  const tokenUsage = usage?.token_usage ?? null;
  if (!tokenUsage) return { estimated_usd: null, rate_source: "no_token_usage" };
  const providerId = provider?.id ?? provider?.provider_id ?? null;
  const rates = pricing.executors?.[providerId] ?? null;
  if (!rates) return { estimated_usd: null, rate_source: "rate_not_configured" };
  const usd = ((Number(tokenUsage.input_tokens ?? 0) / 1_000_000) * Number(rates.in ?? 0))
    + ((Number(tokenUsage.output_tokens ?? 0) / 1_000_000) * Number(rates.out ?? 0));
  return {
    estimated_usd: Math.round(usd * 1_000_000) / 1_000_000,
    rate_source: `src/service/cost/pricing.json#executors.${providerId}`
  };
}

function buildUsageTrace(provider, metrics) {
  const tokenUsage = metrics?.token_usage ?? null;
  const calls = metrics?.llm_usage_calls ?? [];
  return {
    observed: Boolean(tokenUsage),
    tokenUsage: tokenUsage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cache_hit_tokens: 0,
      cache_miss_tokens: 0
    },
    costEstimate: estimateCost(provider, metrics),
    llmUsageCallCount: Number(metrics?.llm_usage_call_count ?? 0),
    callSites: calls.map((call) => ({
      call_site: call.call_site ?? "unknown",
      provider_id: call.provider_id ?? null,
      provider_kind: call.provider_kind ?? null,
      model: call.model ?? null,
      model_role: call.model_role ?? null,
      transport: call.transport ?? null
    }))
  };
}

function compactProvider(provider = null) {
  if (!provider) return { id: null, status: "missing" };
  return {
    id: provider.id ?? null,
    name: provider.displayName ?? provider.name ?? provider.id ?? null,
    kind: provider.kind ?? null,
    configured: provider.configured === true,
    available: provider.available === true,
    detail: provider.detail ?? null,
    capabilities: provider.capabilities ?? null
  };
}

function compactModelRoles(modelRoles = null) {
  const surface = modelRoles?.managementSurface ?? {};
  return {
    schemaVersion: modelRoles?.schemaVersion ?? null,
    counts: modelRoles?.counts ?? null,
    featureFlag: modelRoles?.featureFlag ?? surface.featureFlag ?? null,
    roles: (modelRoles?.roles ?? []).map((role) => ({
      role: role.role,
      status: role.status,
      ready: role.ready === true,
      configured: role.configured === true,
      providerId: role.route?.providerId ?? null,
      model: role.route?.model ?? null,
      source: role.route?.source ?? null,
      costMeasurementKey: `model_role.${role.role}`
    })),
    managementSurface: {
      id: surface.id ?? null,
      roleCount: Array.isArray(surface.roles) ? surface.roles.length : 0,
      testActionCount: Array.isArray(surface.testActions) ? surface.testActions.length : 0
    }
  };
}

async function buildDryRunReport() {
  return buildLiveProviderAcceptanceReport({
    commit: currentGit(["rev-parse", "--short", "HEAD"]),
    branch: currentGit(["branch", "--show-current"]),
    mode: "dry_run",
    liveOptIn: false,
    runtimeBaseUrl: BASE_URL,
    scenarios: [
      {
        id: "provider_setup_health",
        status: "skipped",
        command: "node scripts/real-llm-test/run-live-provider-acceptance.mjs --live",
        evidence: "dry-run validates the report contract without contacting a paid provider",
        notes: "set LINGXY_LIVE_PROVIDER_ACCEPTANCE=1 or pass --live for real provider execution"
      },
      {
        id: "short_text_task",
        status: "skipped",
        command: "POST /task",
        evidence: "not run in dry-run mode"
      },
      {
        id: "model_role_routing",
        status: "skipped",
        command: "GET /config/integrations",
        evidence: "not run in dry-run mode"
      },
      {
        id: "token_cost_trace",
        status: "skipped",
        command: "GET /task/:id",
        evidence: "not run in dry-run mode"
      },
      ...[
        "missing_key_recovery",
        "rate_limit_recovery",
        "invalid_model_recovery",
        "provider_failure_recovery"
      ].map((id) => ({
        id,
        status: "skipped",
        command: "live provider fault injection",
        evidence: "fault injection is intentionally opt-in and not exercised in dry-run mode",
        recovery: "runner must record user-visible recovery copy when this failure class is induced"
      }))
    ],
    notes: ["dry-run wrote a valid redacted report; no provider request was made"]
  });
}

async function buildLiveReport() {
  const child = await startRuntimeIfNeeded();
  try {
    const health = await getJson("/health");
    const providersPayload = await getJson("/ai/providers");
    const integrations = await getJson("/config/integrations");
    const provider = chooseProvider(providersPayload.providers ?? []);
    const scenarios = [];

    scenarios.push({
      id: "provider_setup_health",
      status: health?.ok === true && provider?.configured === true ? "pass" : "fail",
      command: "GET /health + GET /ai/providers",
      evidence: `${health?.ok === true ? "runtime healthy" : "runtime unhealthy"}; ${providerEvidence(provider)}`
    });

    let taskRecord = null;
    let taskError = null;
    try {
      const taskId = await postTask();
      taskRecord = await pollTask(taskId);
    } catch (error) {
      taskError = error?.message ?? String(error);
    }
    const text = finalText(taskRecord);
    const taskStatus = taskRecord?.task?.status ?? "unknown";
    const taskPassed = !taskError
      && ["success", "partial_success"].includes(taskStatus)
      && /LINGXY_LIVE_PROVIDER_ACCEPTANCE_OK/u.test(text);
    scenarios.push({
      id: "short_text_task",
      status: taskPassed ? "pass" : "fail",
      command: "POST /task background=true; GET /task/:id until terminal",
      evidence: taskPassed
        ? `task ${taskRecord?.task?.task_id ?? "unknown"} returned expected acceptance marker`
        : `status=${taskStatus}; error=${taskError ?? "none"}; final_text_head=${text.slice(0, 80)}`
    });

    const modelRoles = compactModelRoles(integrations.modelRoles);
    const readyRoles = (modelRoles.roles ?? []).filter((role) => role.ready);
    scenarios.push({
      id: "model_role_routing",
      status: readyRoles.length > 0 ? "pass" : "partial",
      command: "GET /config/integrations",
      evidence: readyRoles.length > 0
        ? `ready roles: ${readyRoles.map((role) => role.role).join(", ")}`
        : "model role summary present, but no role reported ready"
    });

    const metrics = collectTokenMetrics(taskRecord?.events ?? []);
    const usageTrace = buildUsageTrace(provider, metrics);
    scenarios.push({
      id: "token_cost_trace",
      status: usageTrace.observed ? "pass" : "fail",
      command: "collect llm_usage from GET /task/:id events",
      evidence: usageTrace.observed
        ? `tokens=${usageTrace.tokenUsage.total_tokens}; cost_rate=${usageTrace.costEstimate.rate_source}`
        : "no llm_usage token trace observed on the live task"
    });

    for (const id of [
      "missing_key_recovery",
      "rate_limit_recovery",
      "invalid_model_recovery",
      "provider_failure_recovery"
    ]) {
      scenarios.push({
        id,
        status: "skipped",
        command: "fault injection not executed",
        evidence: "live destructive/paid fault induction was not requested for this run",
        recovery: "when induced, the report must include user-visible recovery copy and no secret values"
      });
    }

    return buildLiveProviderAcceptanceReport({
      commit: currentGit(["rev-parse", "--short", "HEAD"]),
      branch: currentGit(["branch", "--show-current"]),
      mode: "live",
      liveOptIn: true,
      runtimeBaseUrl: BASE_URL,
      provider: compactProvider(provider),
      providerSetup: integrations.providerSetup ?? { status: "unknown" },
      modelRoles,
      usageTrace,
      scenarios,
      notes: ["fault recovery rows are opt-in to avoid intentionally burning quota or invalidating user credentials"]
    });
  } finally {
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
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
  const file = writeReport(report);
  const validation = validateLiveProviderAcceptanceReport(report);
  console.log(JSON.stringify({
    ok: validation.ok,
    mode: report.mode,
    liveOptIn: report.liveOptIn,
    report: path.relative(process.cwd(), file),
    missing: validation.missing,
    leaks: validation.leaks
  }, null, 2));
  if (!validation.ok) process.exitCode = 1;
  if (ARGS.live && report.scenarios.some((scenario) => scenario.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[live-provider-acceptance] fatal:", error);
  process.exit(2);
});
