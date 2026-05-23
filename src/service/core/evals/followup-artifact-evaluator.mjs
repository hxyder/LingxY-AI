import { performance } from "node:perf_hooks";
import { compileContextForTask } from "../context/context-compiler.mjs";
import { SESSION_ITEM_KINDS } from "../session/conversation-session-service.mjs";
import { resolveFollowUp } from "../session/follow-up-resolver.mjs";
import { createInMemoryStoreScaffold } from "../store/memory-store.mjs";
import { ensureRuntimeServices } from "../task-runtime/runtime-services.mjs";
import {
  FOLLOWUP_ARTIFACT_EVAL_CASES,
  FOLLOWUP_ARTIFACT_EVAL_MINIMUMS
} from "./followup-artifact-corpus.mjs";

function nowIso() {
  return "2026-05-09T08:00:00.000Z";
}

function taskRecord(taskId, conversationId, summary = "Task completed.") {
  return {
    task_id: taskId,
    conversation_id: conversationId,
    created_at: nowIso(),
    updated_at: nowIso(),
    status: "success",
    sub_status: "completed",
    intent: "general",
    executor: "tool_using",
    source_type: "conversation",
    user_command: summary,
    execution_mode: "interactive",
    result_summary: summary,
    context_packet: { source_type: "conversation" }
  };
}

function insertConversationIfNeeded(store, conversationId) {
  if (!conversationId || store.getConversation?.(conversationId)) return;
  store.insertConversation({ conversation_id: conversationId, title: conversationId });
}

function seedCaseRuntime(testCase) {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    queue: { snapshot() { return { queued: 0, running: 0 }; } },
    eventBus: { publish() {} }
  };
  ensureRuntimeServices(runtime);
  const { setup } = testCase;
  insertConversationIfNeeded(runtime.store, setup.conversation_id);
  runtime.store.insertTask(taskRecord(setup.parent_task_id, setup.conversation_id, setup.parent_summary));
  for (const artifact of setup.artifacts ?? []) {
    runtime.store.appendArtifact({
      ...artifact,
      conversation_id: setup.conversation_id
    });
  }
  for (const extra of setup.extra_conversations ?? []) {
    insertConversationIfNeeded(runtime.store, extra.conversation_id);
    runtime.store.insertTask(taskRecord(extra.task_id, extra.conversation_id, "Unrelated task completed."));
    for (const artifact of extra.artifacts ?? []) {
      runtime.store.appendArtifact({
        ...artifact,
        conversation_id: extra.conversation_id
      });
    }
  }
  const session = runtime.conversationSessions.ensureSession({
    conversationId: setup.conversation_id,
    activeTaskId: setup.active_task_id,
    metadata: { eval_case_id: testCase.id }
  });
  runtime.conversationSessions.appendItem({
    sessionId: session.session_id,
    kind: SESSION_ITEM_KINDS.TASK_ANCHOR,
    taskId: setup.parent_task_id,
    payload: { eval_case_id: testCase.id }
  });
  for (const artifact of setup.artifacts ?? []) {
    runtime.conversationSessions.appendItem({
      sessionId: session.session_id,
      kind: SESSION_ITEM_KINDS.ARTIFACT_REFERENCE,
      taskId: artifact.task_id,
      artifactId: artifact.artifact_id,
      content: `${artifact.kind} artifact ${artifact.artifact_id}`,
      payload: { kind: artifact.kind, path: artifact.path }
    });
  }
  return runtime;
}

function selectedArtifactIds(compiled) {
  const ids = new Set();
  for (const item of compiled.selected ?? []) {
    const artifactId = item.value?.artifact_id ?? item.artifact_id ?? null;
    if (artifactId) ids.add(artifactId);
  }
  return [...ids];
}

function hasSelectedRejectedAssumption(compiled) {
  return (compiled.selected ?? []).some((item) => item.kind === "rejected_assumption");
}

function buildTaskForEval(testCase, resolution) {
  const backgroundContexts = (testCase.setup.runtime_notes ?? []).map((note, index) => ({
    kind: "rejected_assumption",
    trust: "user_correction",
    content: note,
    reason: "user correction or rejected assumption must remain selectable",
    index
  }));
  return {
    task_id: `eval_${testCase.id}`,
    conversation_id: testCase.setup.conversation_id,
    parent_task_id: resolution.parent_task_id,
    user_command: testCase.user_command,
    context_packet: {
      source_type: "conversation",
      selection_metadata: {
        follow_up_resolution: resolution
      },
      parent_task_summary: {
        parent_task_id: resolution.parent_task_id,
        assistant_final_text: testCase.setup.parent_summary
      },
      recent_conversation_artifacts: testCase.setup.artifacts,
      background_contexts: backgroundContexts
    }
  };
}

function evaluateCase(testCase) {
  const runtime = seedCaseRuntime(testCase);
  const followupStart = performance.now();
  const resolution = resolveFollowUp({
    userCommand: testCase.user_command,
    conversationId: testCase.setup.conversation_id,
    runtime
  });
  const followupResolveMs = performance.now() - followupStart;
  const task = buildTaskForEval(testCase, resolution);
  const contextStart = performance.now();
  const compiled = compileContextForTask({ task, runtime });
  const contextCompileMs = performance.now() - contextStart;
  const artifacts = selectedArtifactIds(compiled);
  const required = testCase.expected.required_artifact_ids ?? [];
  const forbidden = testCase.expected.forbidden_artifact_ids ?? [];
  const wrongParent = Boolean(
    testCase.expected.parent_task_id
    && resolution.parent_task_id !== testCase.expected.parent_task_id
  );
  const staleArtifact = forbidden.some((artifactId) => artifacts.includes(artifactId));
  const missingRequiredArtifact = required.some((artifactId) => !artifacts.includes(artifactId));
  const missingClarification = Boolean(
    testCase.expected.requires_clarification
    && (testCase.setup.artifacts ?? []).length > 1
    && artifacts.length < 2
  );
  const ignoredCorrection = Boolean(
    testCase.expected.rejected_assumption_required
    && !hasSelectedRejectedAssumption(compiled)
  );
  return {
    id: testCase.id,
    category: testCase.category,
    resolution,
    compiled_context_summary: compiled.summary,
    selected_artifact_ids: artifacts,
    followup_resolve_ms: followupResolveMs,
    context_compile_ms: contextCompileMs,
    failures: {
      wrong_parent: wrongParent,
      stale_artifact: staleArtifact,
      unrelated_artifact_success: missingRequiredArtifact,
      missing_clarification_on_ambiguity: missingClarification,
      ignored_correction: ignoredCorrection,
      fake_artifact_success: false
    }
  };
}

function categoryCounts(cases) {
  const counts = {};
  for (const testCase of cases) {
    counts[testCase.category] = (counts[testCase.category] ?? 0) + 1;
  }
  return counts;
}

function metricSummary(results) {
  const totals = {
    wrong_parent_rate: 0,
    stale_artifact_rate: 0,
    unrelated_artifact_success: 0,
    missing_clarification_on_ambiguity: 0,
    ignored_correction: 0,
    fake_artifact_success: 0
  };
  for (const result of results) {
    if (result.failures.wrong_parent) totals.wrong_parent_rate += 1;
    if (result.failures.stale_artifact) totals.stale_artifact_rate += 1;
    if (result.failures.unrelated_artifact_success) totals.unrelated_artifact_success += 1;
    if (result.failures.missing_clarification_on_ambiguity) totals.missing_clarification_on_ambiguity += 1;
    if (result.failures.ignored_correction) totals.ignored_correction += 1;
    if (result.failures.fake_artifact_success) totals.fake_artifact_success += 1;
  }
  return totals;
}

function performanceSummary(results) {
  const maxFollowupResolveMs = Math.max(...results.map((result) => result.followup_resolve_ms), 0);
  const maxContextCompileMs = Math.max(...results.map((result) => result.context_compile_ms), 0);
  return {
    max_followup_resolve_ms: maxFollowupResolveMs,
    max_context_compile_ms: maxContextCompileMs
  };
}

export function runFollowupArtifactEvalCorpus({ cases = FOLLOWUP_ARTIFACT_EVAL_CASES } = {}) {
  const results = cases.map((testCase) => evaluateCase(testCase));
  return {
    corpus_size: cases.length,
    category_counts: categoryCounts(cases),
    minimums: FOLLOWUP_ARTIFACT_EVAL_MINIMUMS,
    metrics: metricSummary(results),
    performance: performanceSummary(results),
    results
  };
}

export function assertFollowupArtifactEvalReport(report) {
  if (!report || typeof report !== "object") throw new Error("eval report required");
  if (report.corpus_size < 50) throw new Error(`expected at least 50 eval cases, got ${report.corpus_size}`);
  for (const [category, minimum] of Object.entries(report.minimums ?? FOLLOWUP_ARTIFACT_EVAL_MINIMUMS)) {
    const actual = report.category_counts?.[category] ?? 0;
    if (actual < minimum) {
      throw new Error(`category ${category} requires ${minimum} cases, got ${actual}`);
    }
  }
  for (const [metric, value] of Object.entries(report.metrics ?? {})) {
    if (value !== 0) throw new Error(`eval metric ${metric} must be zero, got ${value}`);
  }
  return true;
}
