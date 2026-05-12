import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { redactForExport, redactRuntimeConfigForExport } from "./export-bundle.mjs";
import { buildPolicyTraceExport } from "../security/policy-trace-export.mjs";

const DIAGNOSTIC_SCHEMA_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  recentTasks: 20,
  taskEventTasks: 8,
  taskEventsPerTask: 40,
  auditLogs: 80,
  desktopErrors: 80,
  crashDumps: 20
});

function limitArray(items = [], limit = 20) {
  return Array.isArray(items) ? items.slice(0, Math.max(0, limit)) : [];
}

function sortByTimeDesc(items = [], field = "updated_at") {
  return [...items].sort((a, b) => `${b?.[field] ?? ""}`.localeCompare(`${a?.[field] ?? ""}`));
}

function redactTextPreview(value, maxLength = 240) {
  const text = `${value ?? ""}`;
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|rk|pk|key)-[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
    .slice(0, maxLength);
}

function redactPathForDiagnostics(value) {
  if (typeof value !== "string" || !value) return value ?? null;
  let next = value;
  const home = os.homedir();
  if (home && next.toLowerCase().startsWith(home.toLowerCase())) {
    next = `<home>${next.slice(home.length)}`;
  }
  const appData = process.env.APPDATA;
  if (appData && next.toLowerCase().startsWith(appData.toLowerCase())) {
    next = `<appdata>${next.slice(appData.length)}`;
  }
  return next.replace(/\\/g, "/");
}

function safeList(call, fallback = []) {
  try {
    const value = call?.();
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function taskDiagnosticSummary(task = {}) {
  return redactForExport({
    task_id: task.task_id,
    status: task.status,
    sub_status: task.sub_status ?? null,
    intent: task.intent ?? null,
    executor: task.executor ?? null,
    execution_mode: task.execution_mode ?? null,
    source_type: task.context_packet?.source_type ?? null,
    created_at: task.created_at ?? null,
    updated_at: task.updated_at ?? null,
    deleted_at: task.deleted_at ?? null,
    parent_task_id: task.parent_task_id ?? null,
    user_command_preview: redactTextPreview(task.user_command),
    failure_user_message: redactTextPreview(task.failure_user_message)
  });
}

function scheduleDiagnosticSummary(schedule = {}) {
  return redactForExport({
    schedule_id: schedule.schedule_id,
    name: schedule.name,
    enabled: schedule.enabled,
    trigger_type: schedule.trigger_type,
    next_run_at: schedule.next_run_at ?? null,
    last_run_at: schedule.last_run_at ?? null,
    last_run_status: schedule.last_run_status ?? null,
    last_run_task_id: schedule.last_run_task_id ?? null,
    run_count: schedule.run_count ?? 0,
    failure_count: schedule.failure_count ?? 0,
    consecutive_failure_count: schedule.consecutive_failure_count ?? 0
  });
}

async function readJsonlTail(filePath, limit) {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/u)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return redactForExport(JSON.parse(line));
        } catch {
          return { raw: redactTextPreview(line, 600) };
        }
      });
  } catch {
    return [];
  }
}

async function listCrashDumps(logsDir, limit) {
  if (!logsDir) return [];
  const crashDir = path.join(logsDir, "crash-dumps");
  try {
    const entries = await readdir(crashDir);
    const items = [];
    for (const name of entries) {
      const fullPath = path.join(crashDir, name);
      try {
        const info = await stat(fullPath);
        if (!info.isFile()) continue;
        items.push({
          name,
          size_bytes: info.size,
          mtime: info.mtime.toISOString()
        });
      } catch {
        // Ignore entries that disappear while building diagnostics.
      }
    }
    return sortByTimeDesc(items, "mtime").slice(0, limit);
  } catch {
    return [];
  }
}

function buildTaskEventSamples(store, tasks, limits) {
  if (typeof store?.getTaskEvents !== "function") return [];
  return limitArray(tasks, limits.taskEventTasks).map((task) => {
    const events = safeList(() => store.getTaskEvents(task.task_id));
    return {
      task_id: task.task_id,
      events: limitArray(events.slice(-limits.taskEventsPerTask), limits.taskEventsPerTask).map((event) => redactForExport(event))
    };
  });
}

export async function buildRuntimeDiagnosticBundle(runtime, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const store = runtime?.store ?? runtime?.storeAdapter ?? null;
  const config = runtime?.configStore?.load?.() ?? {};
  const tasks = sortByTimeDesc(safeList(() => store?.listTasks?.({ deleted: "any" })));
  const schedules = sortByTimeDesc(safeList(() => store?.listSchedules?.()), "updated_at");
  const auditLogs = sortByTimeDesc(safeList(() => store?.listAuditLogs?.()), "ts");
  const conversations = safeList(() => store?.listConversations?.({ archived: "any", limit: 5000 }));
  const logsDir = runtime?.paths?.logsDir ?? null;

  return {
    schema_version: DIAGNOSTIC_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    app: {
      name: "LingxY",
      diagnostic_kind: "local_support_bundle",
      telemetry: "none"
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: redactPathForDiagnostics(process.cwd())
    },
    runtime: {
      baseDir: redactPathForDiagnostics(runtime?.paths?.baseDir),
      dataDir: redactPathForDiagnostics(runtime?.paths?.dataDir),
      logsDir: redactPathForDiagnostics(logsDir),
      outputsDir: redactPathForDiagnostics(runtime?.paths?.outputsDir),
      dbPath: redactPathForDiagnostics(runtime?.paths?.dbPath)
    },
    counts: {
      tasks: tasks.length,
      failedTasks: tasks.filter((task) => task.status === "failed").length,
      runningTasks: tasks.filter((task) => task.status === "running").length,
      conversations: conversations.length,
      schedules: schedules.length,
      auditLogs: auditLogs.length,
      pendingApprovals: safeList(() => store?.listPendingApprovals?.()).length
    },
    config: redactRuntimeConfigForExport(config),
    recentTasks: limitArray(tasks, limits.recentTasks).map(taskDiagnosticSummary),
    taskEventSamples: buildTaskEventSamples(store, tasks, limits),
    schedules: limitArray(schedules, 30).map(scheduleDiagnosticSummary),
    recentAuditLogs: limitArray(auditLogs, limits.auditLogs).map((entry) => redactForExport(entry)),
    policyTrace: buildPolicyTraceExport(runtime, {
      auditLimit: limits.auditLogs,
      approvalLimit: limits.auditLogs,
      taskEventLimit: limits.taskEventTasks * limits.taskEventsPerTask
    }),
    desktopErrors: logsDir ? await readJsonlTail(path.join(logsDir, "desktop-errors.jsonl"), limits.desktopErrors) : [],
    crashDumps: await listCrashDumps(logsDir, limits.crashDumps),
    manifest: {
      includes: [
        "environment",
        "redacted_config",
        "counts",
        "recent_tasks",
        "task_event_samples",
        "schedules",
        "recent_audit_logs",
        "policy_trace",
        "desktop_error_log",
        "crash_dump_manifest"
      ],
      excludes: [
        "provider_api_keys",
        "oauth_tokens",
        "email_passwords",
        "secret_store",
        "raw_artifact_files",
        "sqlite_database",
        "raw_crash_dump_files"
      ]
    }
  };
}
