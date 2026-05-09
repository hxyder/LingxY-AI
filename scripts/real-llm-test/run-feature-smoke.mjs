// Live feature smoke for fresh, non-corpus prompts.
//
// This runner intentionally uses /task with background=true, matching the
// desktop console submission path. It exercises broad framework surfaces with
// real providers while keeping side effects bounded.
//
// Usage:
//   node scripts/real-llm-test/run-feature-smoke.mjs --port 4320

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function parseArgs(argv) {
  const out = { port: 4320, taskTimeoutMs: 420_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--task-timeout") out.taskTimeoutMs = Number(argv[++i]);
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = `http://127.0.0.1:${ARGS.port}`;
const REPORT_DIR = path.resolve(".tmp", "real-api-feature-smoke");

function nowStamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
}

async function probeHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* wait */ }
    await sleep(250);
  }
  return false;
}

async function startRuntime() {
  if (await probeHealth(1000)) return null;
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

function finalText(record) {
  if (record?.task?.final_text) return String(record.task.final_text);
  const events = Array.isArray(record?.events) ? record.events : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e?.payload?.text && ["inline_result", "success", "partial_success", "failed"].includes(e.event_type)) {
      return String(e.payload.text);
    }
  }
  return "";
}

function calledTools(record) {
  return (record?.events ?? [])
    .filter((e) => e?.event_type === "tool_call_completed")
    .map((e) => e.payload?.tool_id)
    .filter(Boolean);
}

function scheduleNextRunAt(record) {
  for (const e of record?.events ?? []) {
    if (e?.event_type === "tool_call_completed" && e.payload?.tool_id === "create_scheduled_task") {
      return e.payload?.metadata?.next_run_at ?? e.payload?.result?.next_run_at ?? null;
    }
    if (e?.event_type === "task_created" && e.payload?.next_run_at) return e.payload.next_run_at;
  }
  return null;
}

function localYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hasFinalSignal(record) {
  const status = record?.task?.status;
  return ["success", "failed", "partial_success", "cancelled"].includes(status)
    && Boolean(finalText(record) || (record?.artifacts ?? []).length > 0);
}

async function postTask(item) {
  const body = {
    userCommand: item.userCommand,
    sourceType: "console",
    sourceApp: "real-api-feature-smoke",
    background: true
  };
  if (item.filePaths?.length) body.filePaths = item.filePaths;
  if (item.imagePaths?.length) body.imagePaths = item.imagePaths;
  const r = await fetch(`${BASE_URL}/task`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lingxy-desktop-actor": "desktop_console" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`POST /task ${r.status}: ${text.slice(0, 200)}`);
  const taskId = data?.task_id ?? data?.task?.task_id;
  if (!taskId) throw new Error(`POST /task missing task_id: ${text.slice(0, 200)}`);
  return taskId;
}

async function pollTask(taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE_URL}/task/${encodeURIComponent(taskId)}`, {
      headers: { "x-lingxy-desktop-actor": "desktop_console" },
      signal: AbortSignal.timeout(10_000)
    });
    if (r.ok) {
      last = await r.json();
      if (hasFinalSignal(last)) return last;
    }
    await sleep(1000);
  }
  return last;
}

function grade(item, record, error) {
  const status = record?.task?.status ?? "unknown";
  const tools = calledTools(record);
  const artifacts = Array.isArray(record?.artifacts) ? record.artifacts : [];
  const text = finalText(record);
  const nextRunAt = scheduleNextRunAt(record);
  const reasons = [];
  const expect = item.expect ?? {};

  if (error) reasons.push(`harness_error: ${error}`);
  if (expect.terminal && !expect.terminal.includes(status)) reasons.push(`terminal_unexpected: ${status}`);
  for (const tool of expect.mustNotCall ?? []) {
    if (tools.includes(tool)) reasons.push(`forbidden_tool_called: ${tool}`);
  }
  if (expect.mustCallOneOf && !expect.mustCallOneOf.some((tool) => tools.includes(tool))) {
    reasons.push(`missing_required_tool_group: ${expect.mustCallOneOf.join("|")}`);
  }
  if (expect.preferred && status === "success" && !expect.preferred.some((tool) => tools.includes(tool))) {
    reasons.push(`preferred_tools_not_used: ${expect.preferred.join("|")}; called=${tools.join("|") || "(none)"}`);
  }
  if (expect.mustHaveArtifact && artifacts.length === 0) reasons.push("missing_artifact");
  if (expect.artifactKind && artifacts.length > 0) {
    const okKind = artifacts.some((a) => String(a.path ?? "").toLowerCase().endsWith(`.${expect.artifactKind}`));
    if (!okKind) reasons.push(`artifact_kind_mismatch: ${artifacts.map((a) => a.path).join(",")}`);
  }
  if (expect.textIncludesAny && !expect.textIncludesAny.some((needle) => text.toLowerCase().includes(String(needle).toLowerCase()))) {
    reasons.push(`text_missing_any: ${expect.textIncludesAny.join("|")}`);
  }
  if (expect.sameLocalDateAsToday && nextRunAt) {
    const expected = localYmd(new Date());
    const actual = localYmd(new Date(nextRunAt));
    if (actual !== expected) reasons.push(`schedule_date_unexpected: got ${actual}, expected ${expected}`);
  }
  return {
    passed: reasons.length === 0,
    reasons,
    status,
    tools,
    nextRunAt,
    artifactPaths: artifacts.map((a) => a.path),
    finalTextHead: text.slice(0, 240)
  };
}

async function buildCases() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-feature-smoke-"));
  const filePath = path.join(tempDir, "release-notes.txt");
  await writeFile(
    filePath,
    [
      "LingxY Smoke Release Notes",
      "Version: 7.4.2",
      "Highlights: offline draft cache, task popup reliability, and connector approval bridge.",
      "Known risk: preview windows must stay isolated per task."
    ].join("\n"),
    "utf8"
  );
  return [
    {
      id: "feature.docx.research.service-worker-cache",
      area: "artifact+web",
      userCommand: "请查找 Service Worker Cache API 和 HTTP Cache 在 PWA 离线策略里的差异，生成一个 docx，包含表格、风险点和推荐做法。",
      expect: {
        terminal: ["success", "partial_success"],
        mustHaveArtifact: true,
        artifactKind: "docx",
        mustCallOneOf: ["web_search_fetch", "fetch_url_content", "web_search"]
      }
    },
    {
      id: "feature.url.text-only.sqlite",
      area: "url-policy",
      userCommand: "把 https://www.sqlite.org/index.html 当作纯文本返回，不要打开、访问或读取页面。",
      expect: {
        terminal: ["success", "partial_success", "failed"],
        mustNotCall: ["open_url", "fetch_url_content", "web_search_fetch", "web_search"]
      }
    },
    {
      id: "feature.url.open.example",
      area: "url-open",
      userCommand: "打开 https://example.org",
      expect: {
        terminal: ["success", "partial_success", "failed"],
        preferred: ["open_url"]
      }
    },
    {
      id: "feature.schedule.tonight",
      area: "scheduler",
      userCommand: "今晚 11 点提醒我归档这轮功能测试结果。",
      expect: {
        terminal: ["success", "partial_success", "failed"],
        preferred: ["create_scheduled_task"],
        sameLocalDateAsToday: true
      }
    },
    {
      id: "feature.web.current-version",
      area: "web-read",
      userCommand: "查找当前 SQLite 最新稳定版本号，用一句话回答并给来源。",
      expect: {
        terminal: ["success", "partial_success"],
        mustCallOneOf: ["web_search_fetch", "fetch_url_content", "web_search"],
        textIncludesAny: ["SQLite", "版本", "version"]
      }
    },
    {
      id: "feature.local-file.summary",
      area: "local-file",
      userCommand: "读取这个文件并用两条 bullet 总结重点。",
      filePaths: [filePath],
      expect: {
        terminal: ["success", "partial_success"],
        mustCallOneOf: ["read_file_text", "read_folder_text"],
        textIncludesAny: ["7.4.2", "preview", "popup", "connector"]
      }
    },
    {
      id: "feature.stable-qa.no-tool",
      area: "fast-chat",
      userCommand: "用三句话解释为什么 CRDT 的最终一致性适合离线协作。",
      expect: {
        terminal: ["success"],
        mustNotCall: ["web_search_fetch", "fetch_url_content", "web_search", "open_url"],
        textIncludesAny: ["CRDT", "离线", "一致"]
      }
    }
  ];
}

async function runOne(item) {
  const started = Date.now();
  let taskId = null;
  let record = null;
  let error = null;
  try {
    taskId = await postTask(item);
    record = await pollTask(taskId, ARGS.taskTimeoutMs);
  } catch (err) {
    error = err?.message ?? String(err);
  }
  const result = {
    id: item.id,
    area: item.area,
    taskId,
    elapsedMs: Date.now() - started,
    userCommand: item.userCommand,
    grade: grade(item, record, error)
  };
  console.log(`${result.grade.passed ? "PASS" : "FAIL"} ${item.id} ${result.elapsedMs}ms status=${result.grade.status} tools=${result.grade.tools.join("|") || "(none)"}`);
  if (!result.grade.passed) {
    for (const reason of result.grade.reasons) console.log(`  - ${reason}`);
  }
  return result;
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const child = await startRuntime();
  let results;
  try {
    const cases = await buildCases();
    results = [];
    for (const item of cases) results.push(await runOne(item));
  } finally {
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
  const summary = {
    total: results.length,
    passed: results.filter((r) => r.grade.passed).length,
    byArea: Object.fromEntries(
      [...new Set(results.map((r) => r.area))].map((area) => {
        const items = results.filter((r) => r.area === area);
        return [area, { total: items.length, passed: items.filter((r) => r.grade.passed).length }];
      })
    )
  };
  const jsonPath = path.join(REPORT_DIR, `report-${nowStamp()}.json`);
  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2), "utf8");
  console.log(JSON.stringify({ summary, jsonPath }, null, 2));
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[feature-smoke] fatal:", err);
  process.exit(2);
});
