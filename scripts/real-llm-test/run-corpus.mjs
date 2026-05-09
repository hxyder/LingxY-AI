// Real-LLM functional test harness.
//
// Spawns the LingxY runtime (or attaches to an already-running one),
// fires every corpus prompt at /task, polls until terminal, captures
// {status, final_text, tool_calls, artifact_paths, events}, and grades
// each result against the corpus's `expect` block. Writes a JSON report
// and a Markdown summary alongside the harness for the user to read.
//
// Usage:
//   node scripts/real-llm-test/run-corpus.mjs                # all 150
//   node scripts/real-llm-test/run-corpus.mjs --limit 10     # smoke test
//   node scripts/real-llm-test/run-corpus.mjs --concurrency 3
//   node scripts/real-llm-test/run-corpus.mjs --port 4310
//   node scripts/real-llm-test/run-corpus.mjs --no-spawn     # use running runtime
//   node scripts/real-llm-test/run-corpus.mjs --id K.url_only
//   node scripts/real-llm-test/run-corpus.mjs --id K.url_only,M.give_me_link_zh
//   node scripts/real-llm-test/run-corpus.mjs --foreground   # wait in POST
//   node scripts/real-llm-test/run-corpus.mjs --corpus ./corpus-function-audit-100.mjs

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { summariseEvalMetrics } from "./eval-metrics.mjs";
import { collectTokenMetrics } from "./token-metrics.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = __dirname;
const DEFAULT_CORPUS = "./corpus.mjs";

function parseArgs(argv) {
  const out = {
    limit: null,
    concurrency: 1,
    port: 4310,
    spawnRuntime: true,
    taskTimeoutMs: 180_000,
    corpus: DEFAULT_CORPUS,
    allowLiveWrites: false,
    autoApproveLiveWrites: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--no-spawn") out.spawnRuntime = false;
    else if (a === "--task-timeout") out.taskTimeoutMs = Number(argv[++i]);
    else if (a === "--category") out.categoryFilter = argv[++i];
    else if (a === "--corpus") out.corpus = argv[++i];
    else if (a === "--allow-live-writes") out.allowLiveWrites = true;
    else if (a === "--auto-approve-live-writes") out.autoApproveLiveWrites = true;
    else if (a === "--foreground") out.foreground = true;
    else if (a === "--id") {
      out.idFilter = new Set(String(argv[++i] ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean));
    }
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = `http://127.0.0.1:${ARGS.port}`;

function resolveCorpusPath(rawPath = DEFAULT_CORPUS) {
  const value = String(rawPath || DEFAULT_CORPUS);
  return path.isAbsolute(value)
    ? value
    : path.resolve(__dirname, value);
}

async function loadCorpus(rawPath) {
  const corpusPath = resolveCorpusPath(rawPath);
  const module = await import(pathToFileURL(corpusPath).href);
  const corpus = module.TEST_CORPUS ?? module.default;
  if (!Array.isArray(corpus)) {
    throw new Error(`Corpus ${corpusPath} must export TEST_CORPUS or default array`);
  }
  return {
    corpusPath,
    corpus
  };
}

async function probeHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

async function startRuntimeIfNeeded() {
  if (await probeHealth(1500)) {
    console.log(`[harness] reusing existing runtime at ${BASE_URL}`);
    return null;
  }
  if (!ARGS.spawnRuntime) {
    throw new Error(`No runtime at ${BASE_URL} and --no-spawn set; aborting`);
  }
  console.log(`[harness] starting runtime on port ${ARGS.port}…`);
  const child = spawn(process.execPath, ["scripts/start-runtime.mjs"], {
    env: { ...process.env, UCA_PORT: String(ARGS.port) },
    stdio: ["ignore", "inherit", "inherit"],
    cwd: path.resolve(__dirname, "..", "..")
  });
  if (!await probeHealth(60_000)) {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    throw new Error("Runtime did not become healthy within 60 s");
  }
  console.log(`[harness] runtime healthy at ${BASE_URL}`);
  return child;
}

function buildPostBody(item, seedTaskMap) {
  const extra = item.extra ?? {};
  const auditMarker = item.__auditMarker ?? "";
  const auditEmailTo = process.env.LINGXY_AUDIT_EMAIL_TO ?? "";
  const auditCalendarPrefix = process.env.LINGXY_AUDIT_CALENDAR_PREFIX ?? "";
  const body = {
    userCommand: String(item.userCommand ?? "")
      .replaceAll("{{AUDIT_MARKER}}", auditMarker)
      .replaceAll("{{AUDIT_EMAIL_TO}}", auditEmailTo)
      .replaceAll("{{AUDIT_CALENDAR_PREFIX}}", auditCalendarPrefix),
    sourceType: "console",
    sourceApp: "real-llm-test",
    background: ARGS.foreground !== true
  };

  if (Array.isArray(item.filePaths) && item.filePaths.length > 0) {
    body.filePaths = item.filePaths;
  }
  if (Array.isArray(extra.filePaths) && extra.filePaths.length > 0) {
    body.filePaths = extra.filePaths;
  }
  if (Array.isArray(item.imagePaths) && item.imagePaths.length > 0) {
    body.imagePaths = item.imagePaths;
  }
  if (Array.isArray(extra.imagePaths) && extra.imagePaths.length > 0) {
    body.imagePaths = extra.imagePaths;
  }

  if (extra.sourceType === "clipboard" && extra.contextText) {
    body.sourceType = "clipboard";
    body.sourceApp = "real-llm-test.clipboard";
    body.contextPacket = {
      schema_version: "1.0",
      source_type: "clipboard",
      source_app: "real-llm-test.clipboard",
      capture_mode: "event",
      security_level: "internal",
      text: extra.contextText,
      clipboard_text: extra.contextText
    };
  } else if (extra.sourceType === "browser" && extra.pageText) {
    body.sourceType = "browser";
    body.sourceApp = "real-llm-test.browser";
    body.contextPacket = {
      schema_version: "1.0",
      source_type: "browser",
      source_app: "real-llm-test.browser",
      capture_mode: "event",
      security_level: "internal",
      text: extra.pageText,
      url: "https://example.com/test-page",
      browser_page: { text: extra.pageText, url: "https://example.com/test-page" }
    };
  } else if (extra.scheduledFire) {
    // Grey-box scheduled fire: inject preauthorized side-effect contract +
    // authorization so the agent loop's preauthorization checks fire and
    // (when the LLM stalls) the deterministic action_only fallback runs.
    body.sourceType = "scheduler";
    body.sourceApp = "uca.scheduler";
    body.executionMode = "unattended_safe";
    body.selectionMetadata = {
      scheduler_context: true,
      scheduled_task_fire: true,
      schedule_name: `Scheduled: ${item.userCommand.slice(0, 60)}`,
      side_effect_contract: {
        version: 1,
        kind: "side_effect_contract",
        groups: {
          [extra.scheduledFire.group]: {
            slots: {
              to: {
                entity: "email_address",
                values: extra.scheduledFire.recipients,
                mode: "preserve"
              }
            }
          }
        }
      },
      side_effect_authorization: {
        kind: "scheduled_fire",
        decision: "preauthorized",
        source: "schedule_definition",
        execution_mode: "unattended_safe",
        groups: [extra.scheduledFire.group]
      }
    };
  }

  if (extra.followUpOf) {
    const seed = seedTaskMap.get(extra.followUpOf);
    if (seed) {
      body.parent_task_id = seed.taskId;
      body.conversation_id = seed.conversationId;
    }
  }

  return body;
}

async function postTask(item, seedTaskMap) {
  const body = buildPostBody(item, seedTaskMap);
  const r = await fetch(`${BASE_URL}/task`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lingxy-desktop-actor": "desktop_console"
    },
    body: JSON.stringify(body),
    // /task often resolves synchronously when the planner finishes in
    // < 30 s. Give the POST itself a generous ceiling so we do not log
    // false "harness_error: timeout" on perfectly successful runs.
    signal: AbortSignal.timeout(120_000)
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`POST /task ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  // /task returns either {task_id, ...} (legacy) or {task: {task_id, ...}, events, artifacts}.
  // The latter shape comes back when the submission completed synchronously
  // — the task is already terminal in `data.task.status`.
  const taskId = data?.task_id ?? data?.task?.task_id ?? null;
  if (!taskId) {
    throw new Error(`POST /task missing task_id: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { taskId, immediate: data?.task ? data : null };
}

// Codex review (2026-05-07): POST /task returns a "snapshot" — the task's
// status may already be terminal but the events array can lag because
// inline_result / success events are written through a separate path.
// Poll GET /task/{id} with short exponential backoff until we see an
// `inline_result` (or `success`/`partial_success`) event with text, or
// until the task's `final_text` is non-empty. This pattern catches up to
// the eventual-consistency window without paying a fixed sleep cost.
function eventsHaveFinalSignal(record) {
  const events = Array.isArray(record?.events) ? record.events : [];
  for (const e of events) {
    if (!e?.payload) continue;
    if (typeof e.payload?.text === "string" && e.payload.text.trim()) {
      if (["inline_result", "success", "partial_success", "failed"].includes(e.event_type)) return true;
    }
  }
  if (typeof record?.task?.final_text === "string" && record.task.final_text.trim()) return true;
  return false;
}

async function pollTask(taskId, deadlineMs) {
  let last = null;
  const backoffs = [50, 100, 200, 400, 800, 1500, 3000];
  let i = 0;
  while (Date.now() < deadlineMs) {
    try {
      const r = await fetch(`${BASE_URL}/task/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { "x-lingxy-desktop-actor": "desktop_console" }
      });
      if (r.ok) {
        last = await r.json();
        const status = last?.task?.status;
        if (status && ["success", "failed", "partial_success", "cancelled"].includes(status)
            && eventsHaveFinalSignal(last)) {
          return last;
        }
      }
    } catch { /* tolerate flaps */ }
    await sleep(backoffs[Math.min(i, backoffs.length - 1)]);
    i += 1;
  }
  // Timed out without observing the final signal; return whatever we last
  // saw so the report can still grade what's there.
  return last;
}

function approvalContainsTaskId(approval, taskId) {
  if (!taskId) return false;
  const metadata = approval?.metadata ?? {};
  if (metadata.task_id === taskId || metadata.taskId === taskId || metadata.source_task_id === taskId) return true;
  if (approval?.source_id === taskId || approval?.task_id === taskId) return true;
  return JSON.stringify({ metadata, source_id: approval?.source_id ?? null, task_id: approval?.task_id ?? null }).includes(taskId);
}

function approvalTextBlob(approval) {
  return JSON.stringify({
    preview_text: approval?.preview_text ?? approval?.previewText ?? "",
    proposed_params: approval?.proposed_params ?? approval?.proposedParams ?? {},
    proposed_target: approval?.proposed_target ?? approval?.proposedTarget ?? "",
    metadata: approval?.metadata ?? {}
  });
}

function validateLiveApprovalSafety({ item, approval, taskId }) {
  const liveWrite = item.extra?.liveWrite ?? {};
  const kind = String(liveWrite.kind ?? "").toLowerCase();
  const markers = approvalMarkerCandidates(item);
  const blob = approvalTextBlob(approval);
  if (!approvalContainsTaskId(approval, taskId)) {
    return "approval_safety_blocked: approval is not bound to this task_id";
  }
  if (!approvalBlobHasAuditMarker(blob, item)) {
    return "approval_safety_blocked: approval preview/params do not include audit marker";
  }
  if (kind === "email") {
    const recipient = String(process.env.LINGXY_AUDIT_EMAIL_TO ?? "").trim();
    if (!recipient || !blob.includes(recipient)) {
      return "approval_safety_blocked: email approval does not contain whitelisted audit recipient";
    }
  }
  if (kind === "calendar") {
    const prefix = String(process.env.LINGXY_AUDIT_CALENDAR_PREFIX ?? "").trim();
    if (!prefix || !blob.includes(prefix) || !markers.some((marker) => blob.includes(marker))) {
      return "approval_safety_blocked: calendar approval title does not contain audit prefix + marker";
    }
  }
  return null;
}

async function fetchPendingApprovals() {
  const r = await fetch(`${BASE_URL}/approvals`, {
    signal: AbortSignal.timeout(8000),
    headers: { "x-lingxy-desktop-actor": "desktop_console" }
  });
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return (data.approvals ?? []).filter((approval) => approval?.status === "pending");
}

async function resolveApproval(approvalId, decision) {
  const action = decision === "reject" ? "reject" : "approve";
  const r = await fetch(`${BASE_URL}/approvals/${encodeURIComponent(approvalId)}/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lingxy-desktop-actor": "desktop_console"
    },
    body: JSON.stringify({ actor: "real-llm-test" }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`POST /approvals/${approvalId}/${action} ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json().catch(() => ({}));
}

async function maybeDriveLiveApproval({ item, taskId, alreadyResolved }) {
  if (!item.extra?.liveWrite || !ARGS.autoApproveLiveWrites || alreadyResolved.done) return null;
  const pending = await fetchPendingApprovals();
  const match = pending.find((approval) =>
    approvalContainsTaskId(approval, taskId)
    && approvalBlobHasAuditMarker(approvalTextBlob(approval), item)
  );
  if (!match) return null;
  const safetyBlock = validateLiveApprovalSafety({ item, approval: match, taskId });
  if (safetyBlock) throw new Error(safetyBlock);
  const decision = item.extra?.liveWrite?.approvalDecision === "reject" ? "reject" : "approve";
  const result = await resolveApproval(match.approval_id, decision);
  alreadyResolved.done = true;
  alreadyResolved.decision = decision;
  alreadyResolved.approvalId = match.approval_id;
  return result;
}

function pendingApprovalsFromTaskRecord(record) {
  const approvals = [];
  for (const event of record?.events ?? []) {
    const pendingApproval = event?.payload?.pendingApproval;
    if (pendingApproval?.approval_id && pendingApproval.status === "pending") {
      approvals.push(pendingApproval);
    }
    const approval = event?.payload?.approval;
    if (approval?.approval_id && approval.status === "pending") {
      approvals.push(approval);
    }
  }
  const latest = new Map();
  for (const approval of approvals) {
    latest.set(approval.approval_id, approval);
  }
  return [...latest.values()];
}

async function maybeDriveLiveApprovalFromTaskRecord({ item, taskId, taskRecord, alreadyResolved }) {
  if (!item.extra?.liveWrite || !ARGS.autoApproveLiveWrites || alreadyResolved.done) return null;
  const match = pendingApprovalsFromTaskRecord(taskRecord).find((approval) =>
    approvalContainsTaskId(approval, taskId)
    && approvalBlobHasAuditMarker(approvalTextBlob(approval), item)
  );
  if (!match) return null;
  const safetyBlock = validateLiveApprovalSafety({ item, approval: match, taskId });
  if (safetyBlock) throw new Error(safetyBlock);
  const decision = item.extra?.liveWrite?.approvalDecision === "reject" ? "reject" : "approve";
  const result = await resolveApproval(match.approval_id, decision);
  alreadyResolved.done = true;
  alreadyResolved.decision = decision;
  alreadyResolved.approvalId = match.approval_id;
  return result;
}

function taskIsWaitingExternalDecision(record) {
  const terminalStatus = String(record?.task?.status ?? "");
  if (["success", "failed", "cancelled"].includes(terminalStatus)) return false;
  if (record?.task?.sub_status === "waiting_external_decision") return true;
  const events = Array.isArray(record?.events) ? record.events : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const type = event?.event_type;
    const payload = event?.payload ?? {};
    if (type === "success" || type === "failed" || type === "cancelled") return false;
    if (type === "status_changed") {
      const status = String(payload.status ?? "");
      if (["success", "failed", "cancelled"].includes(status)) return false;
      if (status === "partial_success") {
        return payload.sub_status === "waiting_external_decision";
      }
    }
    if (type === "partial_success") {
      return payload.sub_status === "waiting_external_decision";
    }
  }
  return false;
}

async function pollLiveWriteTask(taskId, item, deadlineMs) {
  let last = null;
  const approvalState = { done: false };
  const backoffs = [50, 100, 200, 400, 800, 1500, 3000];
  let i = 0;
  while (Date.now() < deadlineMs) {
    await maybeDriveLiveApproval({ item, taskId, alreadyResolved: approvalState });
    try {
      const r = await fetch(`${BASE_URL}/task/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { "x-lingxy-desktop-actor": "desktop_console" }
      });
      if (r.ok) {
        last = await r.json();
        const droveTaskApproval = await maybeDriveLiveApprovalFromTaskRecord({ item, taskId, taskRecord: last, alreadyResolved: approvalState });
        if (droveTaskApproval) {
          await sleep(backoffs[Math.min(i, backoffs.length - 1)]);
          i += 1;
          continue;
        }
        const status = last?.task?.status;
        const terminal = status && ["success", "failed", "partial_success", "cancelled"].includes(status);
        if (terminal && eventsHaveFinalSignal(last) && (approvalState.done || !taskIsWaitingExternalDecision(last))) {
          return last;
        }
      }
    } catch { /* tolerate flaps */ }
    await sleep(backoffs[Math.min(i, backoffs.length - 1)]);
    i += 1;
  }
  return last;
}

function summariseToolCalls(events = []) {
  const calls = [];
  for (const e of events) {
    if (e?.event_type === "tool_call_completed") {
      calls.push({ tool: e.payload?.tool_id, ok: e.payload?.success !== false });
    }
  }
  return calls;
}

function collectPhaseTiming(events = []) {
  const timing = {};
  for (const event of events) {
    if (event?.event_type !== "phase_timing") continue;
    const phase = event.payload?.phase;
    if (!phase) continue;
    const duration = Number(event.payload?.duration_ms);
    timing[phase] = Number.isFinite(duration) ? duration : null;
  }
  return timing;
}

function collectAuditMetrics(taskRecord, elapsedMs) {
  const events = Array.isArray(taskRecord?.events) ? taskRecord.events : [];
  const tools = summariseToolCalls(events);
  const phaseTiming = collectPhaseTiming(events);
  const phaseGateCount = events.filter((e) => e?.event_type === "phase_gate_signal").length;
  const toolInputDeltaCount = events.filter((e) => e?.event_type === "tool_input_delta").length;
  const textDeltaCount = events.filter((e) => e?.event_type === "text_delta").length;
  const artifacts = Array.isArray(taskRecord?.artifacts) ? taskRecord.artifacts : [];
  return {
    elapsed_ms: elapsedMs,
    first_tool: tools[0]?.tool ?? null,
    tool_count: tools.length,
    tool_ids: [...new Set(tools.map((tool) => tool.tool).filter(Boolean))],
    failed_tool_count: tools.filter((tool) => tool.ok === false).length,
    artifact_count: artifacts.length,
    artifact_paths: artifacts.map((artifact) => artifact?.path).filter(Boolean),
    phase_gate_count: phaseGateCount,
    text_delta_count: textDeltaCount,
    tool_input_delta_count: toolInputDeltaCount,
    phase_timing: phaseTiming,
    ...collectTokenMetrics(events)
  };
}

const XLSX_FAKE_TEXT_RE = /sandbox:\/|\/mnt\/data\/|点击.{0,12}下载|下载链接|download (?:the )?(?:file|artifact|link)|无法(?:直接)?(?:创建|生成|保存)(?:文件|文档|表格)|不能(?:直接)?(?:创建|生成|保存)(?:文件|文档|表格)|cannot (?:directly )?(?:create|generate|save)/iu;

async function inspectXlsxArtifact(filePath) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    let sheetCount = workbook.worksheets.length;
    let nonEmptyRows = 0;
    let maxColumns = 0;
    let nonEmptyCells = 0;
    let longestCellChars = 0;
    let fakeText = false;
    let firstHeader = "";
    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const text = String(cell.value?.text ?? cell.value?.result ?? cell.value ?? "").trim();
          if (!text) return;
          values.push(text);
          nonEmptyCells += 1;
          longestCellChars = Math.max(longestCellChars, text.length);
          if (XLSX_FAKE_TEXT_RE.test(text)) fakeText = true;
        });
        if (values.length > 0) {
          nonEmptyRows += 1;
          maxColumns = Math.max(maxColumns, values.length);
          if (rowNumber === 1 && !firstHeader) firstHeader = values[0] ?? "";
        }
      });
    }
    const issues = [];
    if (sheetCount === 0 || nonEmptyCells === 0) issues.push("xlsx_empty_workbook");
    if (maxColumns < 2 || nonEmptyRows < 2) issues.push(`xlsx_not_tabular: rows=${nonEmptyRows}, cols=${maxColumns}`);
    if (/^(content|section|summary|正文|内容|文本)$/iu.test(firstHeader) && longestCellChars > 120) {
      issues.push("xlsx_generic_prose_column");
    }
    if (fakeText) issues.push("xlsx_fake_download_text");
    return {
      ok: issues.length === 0,
      issues,
      metrics: { sheetCount, nonEmptyRows, maxColumns, nonEmptyCells, longestCellChars, firstHeader }
    };
  } catch (error) {
    return {
      ok: false,
      issues: [`xlsx_open_failed: ${error?.message ?? String(error)}`],
      metrics: null
    };
  }
}

async function gradeResult(item, taskRecord) {
  const grade = { passed: false, reasons: [] };
  if (!taskRecord) {
    grade.reasons.push("no_response_within_timeout");
    return grade;
  }
  const status = taskRecord.task?.status ?? "unknown";
  const events = Array.isArray(taskRecord.events) ? taskRecord.events : [];
  const toolCalls = summariseToolCalls(events);
  const calledIds = new Set(toolCalls.map((c) => c.tool));
  const hasFileIngestEvidence = events.some((event) =>
    event?.event_type === "file_ingest_finished"
    && Number(event.payload?.completed ?? 0) > 0
  );
  const finalText = String(taskRecord.task?.final_text ?? extractFinalText(events) ?? "");
  // expected (v2) supersedes legacy expect; fall back if legacy item.
  const expected = item.expected ?? item.expect ?? {};

  if (Array.isArray(expected.terminal) && !expected.terminal.includes(status)) {
    grade.reasons.push(`terminal_unexpected: got ${status}, expected one of ${expected.terminal.join("|")}`);
  }

  const liveWrite = item.extra?.liveWrite ?? null;
  if (liveWrite) {
    const approvalDecision = String(liveWrite.approvalDecision ?? "approve").toLowerCase();
    if (approvalDecision === "reject") {
      if (!/拒绝|rejected|已拒绝/i.test(finalText)) {
        grade.reasons.push("live_write_reject_not_confirmed");
      }
    } else {
      if (taskIsWaitingExternalDecision(taskRecord)) {
        grade.reasons.push("live_write_waiting_approval");
      }
      if (status !== "success") {
        grade.reasons.push(`live_write_not_success: got ${status}`);
      }
    }
  }

  // toolMustNotInclude (v2) and legacy mustNotCallTools.
  const mustNotInclude = expected.toolMustNotInclude ?? expected.mustNotCallTools ?? expected.mustNotCall;
  if (Array.isArray(mustNotInclude)) {
    for (const tool of mustNotInclude) {
      if (calledIds.has(tool)) {
        grade.reasons.push(`forbidden_tool_called: ${tool}`);
      }
    }
  }

  // toolMustInclude (v2): every listed tool must appear at least once.
  if (Array.isArray(expected.toolMustInclude)) {
    for (const tool of expected.toolMustInclude) {
      if (!calledIds.has(tool)) {
        grade.reasons.push(`required_tool_missing: ${tool}`);
      }
    }
  }

  const oneOfTools = expected.toolMustIncludeOneOf ?? expected.mustCallOneOf;
  if (Array.isArray(oneOfTools) && oneOfTools.length > 0) {
    const matched = oneOfTools.some((tool) => calledIds.has(tool));
    const satisfiedByIngest = expected.allowFileIngestEvidence === true && hasFileIngestEvidence;
    if (!matched && !satisfiedByIngest) {
      grade.reasons.push(`required_tool_group_missing: ${oneOfTools.join("|")}`);
    }
  }

  if (expected.noFailedTools === true) {
    const failedTools = toolCalls.filter((call) => call.ok === false).map((call) => call.tool).filter(Boolean);
    if (failedTools.length > 0) {
      grade.reasons.push(`failed_tool_call: ${[...new Set(failedTools)].join("|")}`);
    }
  }

  // toolGroup (v2) / mustCallToolGroup (legacy).
  const toolGroup = expected.toolGroup ?? expected.mustCallToolGroup;
  if (toolGroup === "external_web_read") {
    const webTools = ["web_search_fetch", "fetch_url_content", "web_search"];
    if (![...calledIds].some((id) => webTools.includes(id))) {
      grade.reasons.push("missing_external_web_read_call");
    }
  }

  // preferredTools: not strict. Only flag a fail when status==="success"
  // (the LLM had a chance to pick) AND none of the preferred tools fired.
  const preferredTools = expected.preferredTools ?? expected.preferred;
  if (Array.isArray(preferredTools) && preferredTools.length > 0) {
    const matched = preferredTools.some((id) => calledIds.has(id));
    if (!matched && status === "success") {
      grade.reasons.push(
        `preferred_tools_not_used: expected ${preferredTools.join("|")}, called ${[...calledIds].join("|") || "(none)"}`
      );
    }
  }

  if (expected.mustHaveArtifact === true) {
    const artifacts = Array.isArray(taskRecord.artifacts) ? taskRecord.artifacts : [];
    if (artifacts.length === 0) grade.reasons.push("missing_artifact");
    else if (expected.artifactKind) {
      const matchedKind = artifacts.some((a) => {
        const ext = String(a?.path ?? "").split(".").pop()?.toLowerCase() ?? "";
        return ext === expected.artifactKind || ext === expected.artifactKind.toLowerCase();
      });
      if (!matchedKind) {
        grade.reasons.push(
          `artifact_kind_mismatch: expected .${expected.artifactKind}, got ${artifacts.map((a) => a.path).join(", ")}`
        );
      }
      if (String(expected.artifactKind).toLowerCase() === "xlsx") {
        const xlsxPaths = artifacts
          .map((artifact) => artifact?.path)
          .filter((artifactPath) => String(artifactPath ?? "").toLowerCase().endsWith(".xlsx"));
        for (const artifactPath of xlsxPaths) {
          const inspection = await inspectXlsxArtifact(artifactPath);
          if (!inspection.ok) {
            grade.reasons.push(`xlsx_structure_invalid: ${inspection.issues.join("; ")} (${artifactPath})`);
          }
          grade.artifactInspections ??= [];
          grade.artifactInspections.push({ path: artifactPath, kind: "xlsx", ...inspection });
        }
      }
    }
  } else if (expected.artifactKind && !expected.mustHaveArtifact) {
    // Soft hint mode: expected.artifactKind without mustHaveArtifact is
    // not graded as a hard fail. Skip.
  }

  // textMustInclude / textMustNotInclude (v2).
  // textMustInclude is graded as a SOFT signal (a "warning") rather than a
  // hard fail because LLMs are non-deterministic. It still appears in the
  // report so the user can spot drift. We only hard-fail when the final
  // text is empty in a non-failed terminal status — that's a real symptom
  // of the framework returning nothing usable. textMustNotInclude stays a
  // hard fail (it guards against bad-content regressions).
  if (Array.isArray(expected.textMustInclude) && expected.textMustInclude.length > 0) {
    const lowered = finalText.toLowerCase();
    const missing = expected.textMustInclude.filter(
      (needle) => !lowered.includes(String(needle).toLowerCase())
    );
    if (missing.length > 0 && ["success", "partial_success"].includes(status)) {
      grade.warnings ??= [];
      grade.warnings.push(`text_missing_substring: expected ~"${missing.join('", "')}"`);
    }
  }
  if (status === "success" && !finalText.trim()) {
    grade.reasons.push("empty_final_text_for_success");
  }
  if (Array.isArray(expected.textMustNotInclude)) {
    const lowered = finalText.toLowerCase();
    for (const needle of expected.textMustNotInclude) {
      if (lowered.includes(String(needle).toLowerCase())) {
        grade.reasons.push(`text_contains_forbidden: "${needle}"`);
      }
    }
  }

  grade.passed = grade.reasons.length === 0;
  grade.status = status;
  grade.toolCalls = toolCalls;
  grade.calledTools = [...calledIds];
  grade.artifactCount = (taskRecord.artifacts ?? []).length;
  grade.finalTextHead = finalText.slice(0, 220);
  grade.behavior = expected.behavior ?? null;
  grade.warnings = grade.warnings ?? [];
  return grade;
}

function extractFinalText(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e?.event_type === "inline_result" && e.payload?.text) return e.payload.text;
    if ((e?.event_type === "success" || e?.event_type === "partial_success") && e.payload?.text) return e.payload.text;
  }
  return null;
}

function buildAuditMarker(item) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `LX-AUDIT-${stamp}-${auditSafeCaseId(item)}`;
}

function auditSafeCaseId(item) {
  return String(item?.id ?? "case").replace(/[^a-z0-9-]/gi, "_").slice(0, 48);
}

function approvalMarkerCandidates(item) {
  const marker = String(item?.__auditMarker ?? "").trim();
  if (!marker) return [];
  return [...new Set([
    marker,
    marker.replace(/\./g, "_")
  ].filter(Boolean))];
}

function approvalBlobHasAuditMarker(blob, item) {
  return approvalMarkerCandidates(item).some((marker) => blob.includes(marker));
}

function liveWriteBlockReason(item) {
  const liveWrite = item.extra?.liveWrite;
  if (!liveWrite) return null;
  if (!ARGS.allowLiveWrites) {
    return "live_write_blocked: pass --allow-live-writes to execute real email/calendar mutations";
  }
  if (process.env.LINGXY_AUDIT_ALLOW_LIVE_WRITES !== "1") {
    return "live_write_blocked: set LINGXY_AUDIT_ALLOW_LIVE_WRITES=1";
  }
  if (liveWrite.requiresApproval !== false && !ARGS.autoApproveLiveWrites) {
    return "live_write_blocked: pass --auto-approve-live-writes to handle approval-required live writes";
  }
  if (liveWrite.requiresApproval !== false && process.env.LINGXY_AUDIT_APPROVAL_AUTODRIVER !== "1") {
    return "live_write_blocked: set LINGXY_AUDIT_APPROVAL_AUTODRIVER=1";
  }
  const kind = String(liveWrite.kind ?? "").toLowerCase();
  if (kind === "email" && !String(process.env.LINGXY_AUDIT_EMAIL_TO ?? "").trim()) {
    return "live_write_blocked: set LINGXY_AUDIT_EMAIL_TO to the audit recipient";
  }
  if (kind === "calendar" && !String(process.env.LINGXY_AUDIT_CALENDAR_PREFIX ?? "").trim()) {
    return "live_write_blocked: set LINGXY_AUDIT_CALENDAR_PREFIX for audit event titles";
  }
  return null;
}

function blockedResult(item, idx, reason, elapsedMs = 0) {
  const idLabel = item.id ?? `${item.category}.${idx + 1}`;
  return {
    idx,
    id: idLabel,
    category: item.category,
    userCommand: item.userCommand,
    expected: item.expected ?? item.expect ?? null,
    grade: {
      passed: false,
      blocked: true,
      status: "blocked",
      reasons: [reason],
      toolCalls: [],
      calledTools: [],
      artifactCount: 0,
      finalTextHead: "",
      behavior: (item.expected ?? item.expect ?? {})?.behavior ?? null,
      warnings: []
    },
    metrics: {
      elapsed_ms: elapsedMs,
      first_tool: null,
      tool_count: 0,
      tool_ids: [],
      failed_tool_count: 0,
      artifact_count: 0,
      artifact_paths: [],
      phase_gate_count: 0,
      text_delta_count: 0,
      tool_input_delta_count: 0,
      phase_timing: {},
      token_usage: null,
      token_usage_source: null,
      llm_usage_call_count: 0,
      llm_usage_calls: []
    },
    elapsedMs,
    taskId: null,
    error: null
  };
}

async function runOne(item, idx, total, seedTaskMap) {
  const t0 = Date.now();
  let taskId = null;
  let taskRecord = null;
  let error = null;
  const blocked = liveWriteBlockReason(item);
  if (blocked) {
    const result = blockedResult(item, idx, blocked, Date.now() - t0);
    console.log(`[${idx + 1}/${total}] BLOCKED ${result.id}: ${blocked}`);
    return result;
  }
  if (item.extra?.liveWrite) {
    item.__auditMarker = buildAuditMarker(item);
  }
  try {
    const submitted = await postTask(item, seedTaskMap);
    taskId = submitted.taskId;
    // Codex review (2026-05-07): even when POST /task returns terminal,
    // the events array often misses the inline_result that landed
    // moments later. Always poll once via GET /task/{id} so we grade
    // against the full event stream.
    if (item.extra?.liveWrite) {
      taskRecord = await pollLiveWriteTask(taskId, item, Date.now() + ARGS.taskTimeoutMs);
    } else if (submitted.immediate?.task && eventsHaveFinalSignal(submitted.immediate)) {
      taskRecord = submitted.immediate;
    } else {
      taskRecord = await pollTask(taskId, Date.now() + ARGS.taskTimeoutMs);
    }
    // Stash seed info so follow-ups can inherit conversation + parent.
    if (item.extra?.seedKey && taskRecord?.task) {
      seedTaskMap.set(item.extra.seedKey, {
        taskId: taskRecord.task.task_id,
        conversationId: taskRecord.task.conversation_id ?? null
      });
    }
  } catch (err) {
    error = err?.message ?? String(err);
  }
  const elapsedMs = Date.now() - t0;
  const grade = await gradeResult(item, taskRecord);
  if (error) {
    grade.reasons.unshift(`harness_error: ${error}`);
    grade.passed = false;
  }
  const idLabel = item.id ?? `${item.category}.${idx + 1}`;
  const oneLine = `[${idx + 1}/${total}] ${grade.passed ? "✓" : "✗"} ${idLabel} (${elapsedMs}ms): ${item.userCommand.slice(0, 50)}`;
  console.log(oneLine);
  if (!grade.passed) {
    for (const reason of grade.reasons) console.log(`     ↳ ${reason}`);
  }
  if (grade.warnings && grade.warnings.length > 0) {
    for (const w of grade.warnings) console.log(`     ⚠ ${w}`);
  }
  return {
    idx,
    id: idLabel,
    category: item.category,
    userCommand: item.userCommand,
    expected: item.expected ?? item.expect ?? null,
    grade,
    metrics: collectAuditMetrics(taskRecord, elapsedMs),
    elapsedMs,
    taskId,
    error
  };
}

async function runBatch(items) {
  const results = [];
  // Seeds keep follow-ups linked to their parent task / conversation. They
  // are written by `runOne` once a seed task lands. Follow-ups that do not
  // find a matching seed simply submit without parent linkage.
  const seedTaskMap = new Map();
  // Reorder so seeds run before their follow-ups regardless of corpus order.
  const ordered = [...items];
  ordered.sort((a, b) => {
    const aSeed = a.extra?.seedKey ? -1 : 0;
    const bSeed = b.extra?.seedKey ? -1 : 0;
    const aFollow = a.extra?.followUpOf ? 1 : 0;
    const bFollow = b.extra?.followUpOf ? 1 : 0;
    return (aSeed + aFollow) - (bSeed + bFollow);
  });
  let cursor = 0;
  const total = ordered.length;
  // Force serial execution when follow-ups exist so seed→follow-up order is
  // honoured. Otherwise honour requested concurrency.
  const hasFollowUps = ordered.some((i) => i.extra?.followUpOf);
  const concurrency = hasFollowUps ? 1 : Math.max(1, ARGS.concurrency);
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= total) return;
      const result = await runOne(ordered[idx], idx, total, seedTaskMap);
      results[idx] = result;
    }
  });
  await Promise.all(workers);
  return results;
}

function summariseResults(results) {
  const total = results.length;
  const passed = results.filter((r) => r.grade.passed).length;
  const byCategory = {};
  // Bucket every failure by its primary reason kind so the user can see the
  // shape of the breakage at a glance ("12 missing_external_web_read_call,
  // 3 forbidden_tool_called: open_url, ...").
  const failureKinds = {};
  const tokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cache_hit_tokens: 0,
    cache_miss_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    llm_usage_call_count: 0,
    cases_with_usage: 0,
    prompt_estimate_call_count: 0,
    prompt_estimate_actual_input_tokens: 0,
    prompt_estimate_estimated_input_tokens: 0,
    prompt_estimate_delta_tokens: 0,
    prompt_estimate_to_actual_ratio: null,
    prompt_estimate_absolute_error_pct: null
  };
  for (const r of results) {
    const usage = r.metrics?.token_usage;
    if (usage) {
      tokenUsage.cases_with_usage += 1;
      tokenUsage.input_tokens += Number(usage.input_tokens ?? 0) || 0;
      tokenUsage.output_tokens += Number(usage.output_tokens ?? 0) || 0;
      tokenUsage.total_tokens += Number(usage.total_tokens ?? 0) || 0;
      tokenUsage.cache_hit_tokens += Number(usage.cache_hit_tokens ?? 0) || 0;
      tokenUsage.cache_miss_tokens += Number(usage.cache_miss_tokens ?? 0) || 0;
      tokenUsage.cache_creation_input_tokens += Number(usage.cache_creation_input_tokens ?? 0) || 0;
      tokenUsage.cache_read_input_tokens += Number(usage.cache_read_input_tokens ?? 0) || 0;
    }
    tokenUsage.llm_usage_call_count += Number(r.metrics?.llm_usage_call_count ?? 0) || 0;
    const calibration = r.metrics?.prompt_estimate_calibration;
    if (calibration) {
      tokenUsage.prompt_estimate_call_count += Number(calibration.call_count ?? 0) || 0;
      tokenUsage.prompt_estimate_actual_input_tokens += Number(calibration.actual_input_tokens ?? 0) || 0;
      tokenUsage.prompt_estimate_estimated_input_tokens += Number(calibration.estimated_input_tokens ?? 0) || 0;
      tokenUsage.prompt_estimate_delta_tokens += Number(calibration.delta_tokens ?? 0) || 0;
    }
    const c = r.category;
    byCategory[c] ??= { total: 0, passed: 0, fails: [] };
    byCategory[c].total += 1;
    if (r.grade.passed) {
      byCategory[c].passed += 1;
      continue;
    }
    byCategory[c].fails.push({
      id: r.id,
      command: r.userCommand,
      reasons: r.grade.reasons,
      status: r.grade.status,
      calledTools: r.grade.calledTools ?? [],
      taskId: r.taskId,
      elapsedMs: r.elapsedMs,
      metrics: r.metrics ?? null,
      behavior: r.grade.behavior,
      finalTextHead: r.grade.finalTextHead
    });
    for (const reason of r.grade.reasons) {
      const kind = String(reason).split(":")[0].trim();
      failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
    }
  }
  if (tokenUsage.prompt_estimate_actual_input_tokens > 0 && tokenUsage.prompt_estimate_estimated_input_tokens > 0) {
    const actual = tokenUsage.prompt_estimate_actual_input_tokens;
    const estimated = tokenUsage.prompt_estimate_estimated_input_tokens;
    tokenUsage.prompt_estimate_delta_tokens = estimated - actual;
    tokenUsage.prompt_estimate_to_actual_ratio = Math.round((estimated / actual) * 1000) / 1000;
    tokenUsage.prompt_estimate_absolute_error_pct = Math.round((Math.abs(estimated - actual) / actual) * 1000) / 1000;
  }
  return {
    total,
    passed,
    passRate: total > 0 ? passed / total : 0,
    byCategory,
    failureKinds,
    tokenUsage,
    qualityMetrics: summariseEvalMetrics(results)
  };
}

function writeReport(summary, results, runStartedAt) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date(runStartedAt).toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const jsonPath = path.join(REPORT_DIR, `report-${stamp}.json`);
  const mdPath = path.join(REPORT_DIR, `report-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2), "utf8");

  const lines = [];
  lines.push(`# Real-LLM corpus run · ${stamp}`);
  lines.push("");
  lines.push(`**${summary.passed}/${summary.total} passed (${(summary.passRate * 100).toFixed(1)}%)**`);
  lines.push("");
  lines.push("## Quality metrics");
  lines.push("");
  const quality = summary.qualityMetrics;
  if (!quality || quality.total === 0) {
    lines.push("_no cases observed_");
  } else {
    const timing = quality.timing ?? {};
    const tokens = quality.tokens ?? {};
    const outcomeRows = Object.entries(quality.outcome_counts ?? {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}=${count}`)
      .join(", ");
    const flagRows = (quality.top_attention_flags ?? [])
      .map(([flag, count]) => `${flag}=${count}`)
      .join(", ");
    lines.push(`- Outcome mix: **${outcomeRows || "n/a"}**`);
    lines.push(`- Quality score: **${quality.quality_score_percent ?? "n/a"}%**; efficiency score: **${quality.efficiency_score_percent ?? "n/a"}%**`);
    lines.push(`- Timing: elapsed avg/p95=${timing.elapsed_ms_avg ?? "n/a"}/${timing.elapsed_ms_p95 ?? "n/a"}ms; first-visible avg/p95=${timing.first_visible_ms_avg ?? "n/a"}/${timing.first_visible_ms_p95 ?? "n/a"}ms`);
    lines.push(`- Tokens: cases=${tokens.cases_with_usage ?? 0}/${summary.total}; total avg/p95=${tokens.total_tokens_avg ?? "n/a"}/${tokens.total_tokens_p95 ?? "n/a"}`);
    lines.push(`- Attention flags: ${flagRows || "none"}`);
  }
  lines.push("");
  lines.push("## Token usage");
  lines.push("");
  if ((summary.tokenUsage?.cases_with_usage ?? 0) === 0) {
    lines.push("_no token usage events observed_");
  } else {
    const usage = summary.tokenUsage;
    lines.push(`- Cases with usage: **${usage.cases_with_usage}/${summary.total}**`);
    lines.push(`- LLM usage calls: **${usage.llm_usage_call_count}**`);
    lines.push(`- Total tokens: **${usage.total_tokens}** (${usage.input_tokens} in / ${usage.output_tokens} out)`);
    lines.push(`- Cache: hit=${usage.cache_hit_tokens}, miss=${usage.cache_miss_tokens}, create=${usage.cache_creation_input_tokens}, read=${usage.cache_read_input_tokens}`);
    if ((usage.prompt_estimate_call_count ?? 0) > 0) {
      lines.push(`- Prompt estimate calibration: calls=${usage.prompt_estimate_call_count}, actual_input=${usage.prompt_estimate_actual_input_tokens}, estimated_input=${usage.prompt_estimate_estimated_input_tokens}, ratio=${usage.prompt_estimate_to_actual_ratio ?? "n/a"}, abs_error=${usage.prompt_estimate_absolute_error_pct ?? "n/a"}`);
    }
  }
  lines.push("");
  lines.push("## Failure shape (primary reason kind, top → bottom)");
  lines.push("");
  const kindRows = Object.entries(summary.failureKinds).sort((a, b) => b[1] - a[1]);
  if (kindRows.length === 0) lines.push("_no failures_");
  for (const [kind, count] of kindRows) {
    lines.push(`- **${count}** × ${kind}`);
  }
  lines.push("");
  lines.push("## By category");
  lines.push("");
  lines.push("| Category | Pass | Total | % |");
  lines.push("|---|---|---|---|");
  const catRows = Object.entries(summary.byCategory)
    .sort((a, b) => a[1].passed / Math.max(1, a[1].total) - b[1].passed / Math.max(1, b[1].total));
  for (const [cat, agg] of catRows) {
    const pct = agg.total > 0 ? ((agg.passed / agg.total) * 100).toFixed(0) : "0";
    lines.push(`| ${cat} | ${agg.passed} | ${agg.total} | ${pct}% |`);
  }
  lines.push("");
  lines.push("## Failures (per item, with behavior + actual)");
  lines.push("");
  for (const [cat, agg] of Object.entries(summary.byCategory)) {
    if (agg.fails.length === 0) continue;
    lines.push(`### ${cat}`);
    for (const fail of agg.fails) {
      lines.push(`#### \`${fail.id}\``);
      lines.push("");
      lines.push(`- **Prompt**: \`${fail.command}\``);
      if (fail.behavior) lines.push(`- **Expected behavior**: ${fail.behavior}`);
      lines.push(`- **Status**: ${fail.status ?? "n/a"} (${fail.elapsedMs}ms)`);
      lines.push(`- **Tools called**: ${fail.calledTools.length === 0 ? "(none)" : fail.calledTools.join(", ")}`);
      if (fail.metrics) {
        const firstVisible = fail.metrics.phase_timing?.executor_first_visible_output;
        const tokenUsage = fail.metrics.token_usage
          ? `${fail.metrics.token_usage.input_tokens ?? 0}/${fail.metrics.token_usage.output_tokens ?? 0}`
          : "n/a";
        const llmCalls = (fail.metrics.llm_usage_calls ?? [])
          .slice(0, 4)
          .map((call) => `${call.call_site}:${call.usage?.input_tokens ?? 0}/${call.usage?.output_tokens ?? 0}`)
          .join(", ");
        const calibration = fail.metrics.prompt_estimate_calibration
          ? `, estimateRatio=${fail.metrics.prompt_estimate_calibration.estimate_to_actual_ratio ?? "n/a"}, estimateAbsError=${fail.metrics.prompt_estimate_calibration.absolute_error_pct ?? "n/a"}`
          : "";
        const firstSegments = fail.metrics.llm_usage_calls?.[0]?.prompt_segments_estimate?.segments ?? [];
        const segmentHead = firstSegments
          .slice(0, 6)
          .map((segment) => `${segment.name}:${segment.estimated_tokens}`)
          .join(", ");
        lines.push(`- **Metrics**: firstTool=${fail.metrics.first_tool ?? "n/a"}, firstVisibleMs=${firstVisible ?? "n/a"}, phaseGates=${fail.metrics.phase_gate_count ?? 0}, tokens(in/out)=${tokenUsage}, llmCalls=${llmCalls || "n/a"}${calibration}, segments≈${segmentHead || "n/a"}`);
      }
      lines.push(`- **Failures**:`);
      for (const reason of fail.reasons) lines.push(`  - ${reason}`);
      if (fail.finalTextHead) {
        lines.push(`- **Final text head (220 chars)**:`);
        lines.push("  ```");
        lines.push(`  ${fail.finalTextHead.replace(/\n/g, " ")}`);
        lines.push("  ```");
      }
      if (fail.taskId) lines.push(`- task_id: \`${fail.taskId}\``);
      lines.push("");
    }
  }
  writeFileSync(mdPath, lines.join("\n"), "utf8");
  return { jsonPath, mdPath };
}

async function main() {
  const { corpusPath, corpus } = await loadCorpus(ARGS.corpus);
  const limit = Number.isFinite(ARGS.limit) ? ARGS.limit : corpus.length;
  const filtered = corpus
    .filter((item) => !ARGS.categoryFilter || item.category === ARGS.categoryFilter)
    .filter((item) => !ARGS.idFilter || ARGS.idFilter.has(item.id))
    .slice(0, limit);
  console.log(`[harness] corpus=${path.relative(process.cwd(), corpusPath)} items=${corpus.length}`);
  console.log(`[harness] running ${filtered.length} items, concurrency=${ARGS.concurrency}, taskTimeout=${ARGS.taskTimeoutMs}ms`);
  const child = await startRuntimeIfNeeded();
  const runStartedAt = Date.now();
  let results;
  try {
    results = await runBatch(filtered);
  } finally {
    if (child) {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
    }
  }
  const summary = summariseResults(results);
  summary.corpus = path.relative(process.cwd(), corpusPath);
  summary.allowLiveWrites = ARGS.allowLiveWrites === true;
  const { jsonPath, mdPath } = writeReport(summary, results, runStartedAt);
  console.log("");
  console.log(`[harness] ${summary.passed}/${summary.total} passed (${(summary.passRate * 100).toFixed(1)}%)`);
  console.log(`[harness] report → ${path.relative(process.cwd(), mdPath)}`);
  console.log(`[harness] data    → ${path.relative(process.cwd(), jsonPath)}`);
  if (summary.passed < summary.total) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[harness] fatal:", err);
  process.exit(2);
});
