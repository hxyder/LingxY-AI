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

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { TEST_CORPUS } from "./corpus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = __dirname;

function parseArgs(argv) {
  const out = { limit: TEST_CORPUS.length, concurrency: 1, port: 4310, spawnRuntime: true, taskTimeoutMs: 180_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--no-spawn") out.spawnRuntime = false;
    else if (a === "--task-timeout") out.taskTimeoutMs = Number(argv[++i]);
    else if (a === "--category") out.categoryFilter = argv[++i];
  }
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const BASE_URL = `http://127.0.0.1:${ARGS.port}`;

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
  const body = {
    userCommand: item.userCommand,
    sourceType: "console",
    sourceApp: "real-llm-test"
  };
  const extra = item.extra ?? {};

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

function summariseToolCalls(events = []) {
  const calls = [];
  for (const e of events) {
    if (e?.event_type === "tool_call_completed") {
      calls.push({ tool: e.payload?.tool_id, ok: e.payload?.success !== false });
    }
  }
  return calls;
}

function gradeResult(item, taskRecord) {
  const grade = { passed: false, reasons: [] };
  if (!taskRecord) {
    grade.reasons.push("no_response_within_timeout");
    return grade;
  }
  const status = taskRecord.task?.status ?? "unknown";
  const events = Array.isArray(taskRecord.events) ? taskRecord.events : [];
  const toolCalls = summariseToolCalls(events);
  const calledIds = new Set(toolCalls.map((c) => c.tool));
  const finalText = String(taskRecord.task?.final_text ?? extractFinalText(events) ?? "");
  // expected (v2) supersedes legacy expect; fall back if legacy item.
  const expected = item.expected ?? item.expect ?? {};

  if (Array.isArray(expected.terminal) && !expected.terminal.includes(status)) {
    grade.reasons.push(`terminal_unexpected: got ${status}, expected one of ${expected.terminal.join("|")}`);
  }

  // toolMustNotInclude (v2) and legacy mustNotCallTools.
  const mustNotInclude = expected.toolMustNotInclude ?? expected.mustNotCallTools;
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
  if (Array.isArray(expected.preferredTools) && expected.preferredTools.length > 0) {
    const matched = expected.preferredTools.some((id) => calledIds.has(id));
    if (!matched && status === "success") {
      grade.reasons.push(
        `preferred_tools_not_used: expected ${expected.preferredTools.join("|")}, called ${[...calledIds].join("|") || "(none)"}`
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

async function runOne(item, idx, total, seedTaskMap) {
  const t0 = Date.now();
  let taskId = null;
  let taskRecord = null;
  let error = null;
  try {
    const submitted = await postTask(item, seedTaskMap);
    taskId = submitted.taskId;
    // Codex review (2026-05-07): even when POST /task returns terminal,
    // the events array often misses the inline_result that landed
    // moments later. Always poll once via GET /task/{id} so we grade
    // against the full event stream.
    if (submitted.immediate?.task && eventsHaveFinalSignal(submitted.immediate)) {
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
  const grade = gradeResult(item, taskRecord);
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
  for (const r of results) {
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
      behavior: r.grade.behavior,
      finalTextHead: r.grade.finalTextHead
    });
    for (const reason of r.grade.reasons) {
      const kind = String(reason).split(":")[0].trim();
      failureKinds[kind] = (failureKinds[kind] ?? 0) + 1;
    }
  }
  return {
    total,
    passed,
    passRate: total > 0 ? passed / total : 0,
    byCategory,
    failureKinds
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
  const filtered = TEST_CORPUS
    .filter((item) => !ARGS.categoryFilter || item.category === ARGS.categoryFilter)
    .slice(0, ARGS.limit);
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
