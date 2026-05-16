import crypto from "node:crypto";
import path from "node:path";
import { createTaskEventStream, encodeSseFrame } from "../../events/sse.mjs";
import { retryTask } from "../../retry/retry-manager.mjs";
import {
  cancelTask,
  emitTaskEvent,
  readTaskEventLog
} from "../task-runtime.mjs";
import { looksLikeFollowUpSignal } from "../session/follow-up-resolver.mjs";
import { setUserLocation } from "../../utils/location.mjs";
import { submitActionToolTask } from "../action-tool-submission.mjs";
import { submitBrowserTask } from "../browser-submission.mjs";
import { submitContextTask } from "../context-submission.mjs";
import { submitFileTask } from "../file-submission.mjs";
import { submitImageTask } from "../image-submission.mjs";
import { submitOfficeTask } from "../office-submission.mjs";
import { readJsonBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { normalizeDeletedFilter } from "../deletion-lifecycle.mjs";
import {
  artifactSourceFromEventPayload,
  normalizeArtifactSource
} from "../artifact-action-contract.mjs";
import { normalizeArtifactVersionMetadata } from "../store/artifact-metadata.mjs";
import {
  applyFileReversibilityCheckpoint,
  collectFileReversibilityCheckpoints
} from "../../capabilities/tools/file-reversibility.mjs";

function taskDeletedFilterFromUrl(url) {
  return normalizeDeletedFilter(url.searchParams.get("deleted") ?? false);
}

function taskUsageSummary(task) {
  return task?.usage_summary && typeof task.usage_summary === "object"
    ? task.usage_summary
    : null;
}

function listTaskSummaries(runtime, { deleted = false } = {}) {
  return runtime.store.listTasks({ deleted }).map((task) => ({
    task_id: task.task_id,
    conversation_id: task.conversation_id
      ?? task.context_packet?.selection_metadata?.conversation_id
      ?? task.context_packet?.selectionMetadata?.conversation_id
      ?? null,
    project_id: task.project_id
      ?? task.context_packet?.selection_metadata?.project_id
      ?? task.context_packet?.selectionMetadata?.project_id
      ?? null,
    created_at: task.created_at,
    updated_at: task.updated_at,
    deleted_at: task.deleted_at ?? null,
    deleted_by: task.deleted_by ?? null,
    restore_until: task.restore_until ?? null,
    status: task.status,
    sub_status: task.sub_status,
    progress: task.progress ?? 0,
    intent: task.intent,
    executor: task.executor,
    execution_mode: task.execution_mode ?? null,
    permission_mode: task.context_packet?.selection_metadata?.permission_mode_contract ?? null,
    source_type: task.context_packet?.source_type ?? null,
    source_app: task.context_packet?.source_app ?? null,
    capture_mode: task.context_packet?.capture_mode ?? null,
    selection_metadata: task.context_packet?.selection_metadata ?? task.context_packet?.selectionMetadata ?? {},
    schedule_source: task.context_packet?.selection_metadata?.source_id
      ?? task.context_packet?.selectionMetadata?.source_id
      ?? task.schedule_source
      ?? null,
    hidden: task.hidden === true,
    ui_hidden: task.ui_hidden === true,
    user_command: task.user_command,
    parent_task_id: task.parent_task_id ?? null,
    child_index: task.child_index ?? null,
    is_continuation: task.is_continuation === true,
    child_count: Array.isArray(task.child_task_ids) ? task.child_task_ids.length : 0,
    usage_summary: taskUsageSummary(task)
  }));
}

function normalizeRequestProjectId(body = {}) {
  const candidates = [
    body.project_id,
    body.projectId,
    body.selectionMetadata?.project_id,
    body.selectionMetadata?.projectId,
    body.contextPacket?.selection_metadata?.project_id,
    body.contextPacket?.selection_metadata?.projectId,
    body.contextPacket?.selectionMetadata?.project_id,
    body.contextPacket?.selectionMetadata?.projectId
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (value) return value.slice(0, 128);
  }
  return null;
}

function requestSelectionMetadata(body = {}) {
  return body.selectionMetadata && typeof body.selectionMetadata === "object"
    ? body.selectionMetadata
    : {};
}

function normalizeRequestPathArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : [];
}

const LAUNCHABLE_FILE_EXTENSIONS = new Set([
  ".appref-ms",
  ".bat",
  ".cmd",
  ".com",
  ".exe",
  ".lnk",
  ".msi",
  ".ps1",
  ".url"
]);

function isLaunchableLocalResource(filePath = "") {
  const value = String(filePath ?? "").trim();
  if (!value) return false;
  if (/^shell:/i.test(value)) return true;
  return LAUNCHABLE_FILE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function buildMixedAttachmentContextPacket(body, {
  filePaths,
  imagePaths,
  selectionMetadata
}) {
  const traceId = `trace_${crypto.randomUUID()}`;
  const contextId = `ctx_${crypto.randomUUID()}`;
  return {
    schema_version: "1.0",
    context_id: contextId,
    trace_id: traceId,
    source_type: "mixed_attachments",
    source_app: body.sourceApp ?? "uca.client",
    capture_mode: body.captureMode ?? "attachment",
    security_level: "internal",
    redaction_applied: false,
    text: [
      filePaths.length ? `Attached files: ${filePaths.join(", ")}` : "",
      imagePaths.length ? `Attached images: ${imagePaths.join(", ")}` : ""
    ].filter(Boolean).join("\n"),
    file_paths: filePaths,
    image_paths: imagePaths,
    selection_metadata: {
      ...selectionMetadata,
      attachment_mode: "mixed",
      file_count: filePaths.length,
      image_count: imagePaths.length
    },
    captured_at: new Date().toISOString()
  };
}

function normalizeTaskSummaryLimit(value) {
  if (String(value ?? "").trim().toLowerCase() === "all") return Infinity;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 80;
  return Math.max(1, Math.min(500, numeric));
}

export function buildTaskSummaryPayload(runtime, { recentLimit = 80 } = {}) {
  const tasks = listTaskSummaries(runtime)
    .sort((left, right) =>
      `${right.updated_at ?? right.created_at ?? ""}`.localeCompare(`${left.updated_at ?? left.created_at ?? ""}`)
    );
  const isActive = (task) => ["queued", "running", "cancelling", "starting"].includes(task.status);
  const visible = tasks.filter((task) => task.hidden !== true && task.ui_hidden !== true);
  const active = visible.filter(isActive);
  const normalizedLimit = normalizeTaskSummaryLimit(recentLimit);
  const recent = Number.isFinite(normalizedLimit)
    ? visible.slice(0, normalizedLimit)
    : visible;
  return {
    active,
    recent,
    counts: {
      total: tasks.length,
      visible: visible.length,
      active: active.length,
      recent: recent.length
    },
    tasks: recent
  };
}

function summarizeTask(runtime, taskId) {
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }
  const events = runtime.store.getTaskEvents(taskId);
  const children = Array.isArray(task.child_task_ids)
    ? task.child_task_ids
      .map((childId) => runtime.store.getTask(childId))
      .filter(Boolean)
      .map((child) => ({
        task_id: child.task_id,
        parent_task_id: child.parent_task_id ?? null,
        child_index: child.child_index ?? null,
        status: child.status,
        sub_status: child.sub_status,
        progress: child.progress ?? 0,
        user_command: child.user_command,
        intent: child.intent,
        executor: child.executor,
        result_summary: child.result_summary ?? null,
        failure_user_message: child.failure_user_message ?? null,
        usage_summary: child.usage_summary ?? null,
        elapsed_ms: child.elapsed_ms ?? null,
        updated_at: child.updated_at ?? null
      }))
    : [];
  return {
    task,
    events,
    children,
    artifacts: mergeArtifactsForTask(taskId, runtime.store.getArtifactsForTask(taskId), events)
  };
}

function artifactPathFromValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (value && typeof value === "object" && typeof value.path === "string") {
    const trimmed = value.path.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function artifactMimeFromValue(value) {
  return value && typeof value === "object"
    ? value.mime_type ?? value.mime ?? null
    : null;
}

function artifactSourceFromValue(value, payload) {
  if (value && typeof value === "object" && typeof value.source === "string") {
    const source = normalizeArtifactSource(value.source);
    if (source) return source;
  }
  return artifactSourceFromEventPayload(payload);
}

function artifactVersionFromValue(value, payload) {
  return normalizeArtifactVersionMetadata({
    ...(payload && typeof payload === "object" ? payload : {}),
    ...(value && typeof value === "object" ? value : {})
  });
}

function artifactsFromEvent(taskId, event) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const candidates = [];
  if (event?.event_type === "artifact_created") {
    candidates.push(payload);
  }
  if (Array.isArray(payload.artifact_paths)) {
    candidates.push(...payload.artifact_paths);
  }
  if (Array.isArray(payload.artifacts)) {
    candidates.push(...payload.artifacts);
  }

  return candidates
    .map((candidate) => {
      const artifactPath = artifactPathFromValue(candidate);
      if (!artifactPath) {
        return null;
      }
      const hash = crypto.createHash("sha1").update(artifactPath).digest("hex").slice(0, 10);
      return {
        artifact_id: `${taskId}:event:${hash}`,
        task_id: taskId,
        path: artifactPath,
        mime_type: artifactMimeFromValue(candidate),
        source: artifactSourceFromValue(candidate, payload),
        ...artifactVersionFromValue(candidate, payload),
        created_at: event?.ts ?? new Date(0).toISOString(),
        derived_from_event: true
      };
    })
    .filter(Boolean);
}

function mergeArtifactsForTask(taskId, persistedArtifacts = [], events = []) {
  const seen = new Set();
  const merged = [];
  const add = (artifact) => {
    const artifactPath = artifactPathFromValue(artifact);
    if (!artifactPath || seen.has(artifactPath)) {
      return;
    }
    seen.add(artifactPath);
    merged.push({
      ...artifact,
      task_id: artifact.task_id ?? taskId,
      path: artifactPath
    });
  };

  for (const artifact of persistedArtifacts ?? []) {
    add(artifact);
  }
  for (const event of events ?? []) {
    for (const artifact of artifactsFromEvent(taskId, event)) {
      add(artifact);
    }
  }
  return merged;
}

export async function submitTaskFromBody(runtime, body) {
  // Pick up any location fix the caller shipped along with the task
  // (browser extension does this whenever the user has granted precise
  // location). Every task submission doubles as a low-latency freshness
  // signal — no separate polling needed. We accept the field at either
  // level because the capture helper mirrors it into both.
  const incomingLocation = body.userLocation ?? body.capture?.userLocation ?? null;
  if (incomingLocation) {
    const storedLocation = setUserLocation(incomingLocation);
    if (storedLocation) {
      try {
        runtime.configStore?.patch?.({
          location: {
            userLocation: { ...storedLocation }
          }
        });
      } catch { /* location is advisory; never block task submission */ }
    }
  }

  // UCA-060: Reject requests with no user command — prevents the hotkey
  // "capture active window then send immediately" from using window content
  // as the query when the user hasn't typed anything yet.
  const userCommand = String(body.userCommand ?? "").trim();
  if (!userCommand) {
    return {
      ok: false,
      error: "missing_user_command",
      message: "请先输入你的问题或指令"
    };
  }
  // Write normalised command back so all branches below see the trimmed value
  body.userCommand = userCommand;
  const background = body.background === true || body.returnImmediately === true;
  const requestConversationId = typeof body.conversation_id === "string" && body.conversation_id
    ? body.conversation_id
    : (typeof body.conversationId === "string" && body.conversationId ? body.conversationId : null);
  const requestParentTaskId = typeof body.parent_task_id === "string" && body.parent_task_id
    ? body.parent_task_id
    : (typeof body.parentTaskId === "string" && body.parentTaskId ? body.parentTaskId : null);
  const effectiveRequestParentTaskId = requestParentTaskId && looksLikeFollowUpSignal(userCommand)
    ? requestParentTaskId
    : null;
  const requestClientMessageId = typeof body.client_message_id === "string" && body.client_message_id
    ? body.client_message_id
    : (typeof body.clientMessageId === "string" && body.clientMessageId ? body.clientMessageId : null);
  const requestProjectId = normalizeRequestProjectId(body);
  const requestFilePaths = normalizeRequestPathArray(body.filePaths);
  const requestImagePaths = normalizeRequestPathArray(body.imagePaths);
  const selectionMetadata = requestSelectionMetadata(body);

  if (requestFilePaths.length && requestImagePaths.length) {
    return submitContextTask({
      contextPacket: buildMixedAttachmentContextPacket(body, {
        filePaths: requestFilePaths,
        imagePaths: requestImagePaths,
        selectionMetadata
      }),
      userCommand: body.userCommand,
      runtime,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      parentTaskId: effectiveRequestParentTaskId,
      conversationId: requestConversationId,
      clientMessageId: requestClientMessageId,
      projectId: requestProjectId,
      background
    });
  }

  if (requestFilePaths.length) {
    const launchableFilePaths = requestFilePaths.filter(isLaunchableLocalResource);
    if (launchableFilePaths.length > 0) {
      return submitActionToolTask({
        userCommand: body.userCommand,
        executionMode: body.executionMode,
        sourceApp: body.sourceApp,
        captureMode: body.captureMode,
        selectionMetadata: {
          ...selectionMetadata,
          launchable_file_context: true,
          launchable_file_paths: launchableFilePaths,
          file_count: requestFilePaths.length
        },
        filePaths: requestFilePaths,
        executorOverride: body.executorOverride,
        parentTaskId: effectiveRequestParentTaskId,
        conversationId: requestConversationId,
        clientMessageId: requestClientMessageId,
        projectId: requestProjectId,
        background,
        runtime
      });
    }
    return submitFileTask({
      filePaths: requestFilePaths,
      userCommand: body.userCommand,
      captureMode: body.captureMode,
      sourceApp: body.sourceApp,
      selectionMetadata,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      parentTaskId: effectiveRequestParentTaskId,
      conversationId: requestConversationId,
      clientMessageId: requestClientMessageId,
      projectId: requestProjectId,
      background,
      runtime
    });
  }

  if (body.capture?.sourceType) {
    return submitBrowserTask({
      capture: {
        ...body.capture,
        selectionMetadata: {
          ...(body.capture.selectionMetadata ?? {}),
          ...selectionMetadata
        }
      },
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      parentTaskId: effectiveRequestParentTaskId,
      conversationId: requestConversationId,
      clientMessageId: requestClientMessageId,
      projectId: requestProjectId,
      background,
      runtime
    });
  }

  if (requestImagePaths.length) {
    return submitImageTask({
      imagePaths: requestImagePaths,
      userCommand: body.userCommand,
      source: body.source,
      sourceApp: body.sourceApp,
      captureMode: body.captureMode,
      selectionMetadata,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride ?? null,
      parentTaskId: effectiveRequestParentTaskId,
      conversationId: requestConversationId,
      clientMessageId: requestClientMessageId,
      projectId: requestProjectId,
      background,
      runtime
    });
  }

  if (body.officeCapture?.officeApp) {
    return submitOfficeTask({
      capture: body.officeCapture,
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      parentTaskId: effectiveRequestParentTaskId,
      conversationId: requestConversationId,
      clientMessageId: requestClientMessageId,
      projectId: requestProjectId,
      background,
      runtime
    });
  }

  if (body.submissionType === "action_tool") {
    return submitActionToolTask({
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      sourceApp: body.sourceApp,
      captureMode: body.captureMode,
      parentTaskId: effectiveRequestParentTaskId,
      conversationId: requestConversationId,
      clientMessageId: requestClientMessageId,
      projectId: requestProjectId,
      background,
      runtime
    });
  }

  return submitContextTask({
    contextPacket: body.contextPacket ?? {
      source_type: body.sourceType ?? "clipboard",
      source_app: body.sourceApp ?? "uca.http",
      capture_mode: body.captureMode ?? "manual",
      text: body.text ?? "",
      selection_metadata: body.selectionMetadata ?? {}
    },
    userCommand: body.userCommand,
    executionMode: body.executionMode,
    executorOverride: body.executorOverride,
    skipDecomposition: Boolean(body.skipDecomposition),
    // UCA-182 Phase 9: carry the client's parent_task_id so follow-up
    // turns inside the same conversation hang off the previous task
    // instead of each turn being an orphan root. Decomposition / plan
    // layers already skip when parentTaskId is set so we don't
    // re-decompose an inherited subtask.
    parentTaskId: effectiveRequestParentTaskId,
    // P4-RQ K6: thread the client-stamped conversation_id through.
    // Frontend (overlay.js:3256) has been POSTing `conversation_id`
    // on every /task request since Phase 9 — pre-K6 the HTTP layer
    // dropped it on the floor, so K4's auto-resolution sat idle in
    // production. Accept both snake_case and camelCase per the
    // existing parent_task_id pattern.
    conversationId: requestConversationId,
    clientMessageId: requestClientMessageId,
    projectId: requestProjectId,
    background,
    runtime
  });
}

export function emitSubmitToTaskCreatedTiming(runtime, result, startedAtMs, route = "/task") {
  const taskId = result?.task?.task_id;
  if (!taskId || !Number.isFinite(startedAtMs)) return null;
  const event = emitTaskEvent({
    runtime,
    taskId,
    eventType: "phase_timing",
    payload: {
      phase: "submit_to_task_created",
      route,
      duration_ms: Math.max(0, Date.now() - startedAtMs)
    }
  });
  if (Array.isArray(result.taskEvents)) {
    result.taskEvents.push(event);
  }
  return event;
}

async function handleTaskEventStream({ request, response, url, runtime, taskId }) {
  const task = runtime.store.getTask(taskId);
  if (!task) {
    sendJson(response, 404, { error: "task_not_found" });
    return;
  }

  if (request.headers.accept?.includes("text/event-stream")) {
    const stream = createTaskEventStream({
      store: runtime.store,
      eventBus: runtime.eventBus,
      taskId,
      since: url.searchParams.get("since")
    });
    response.writeHead(200, stream.headers);
    for (const event of stream.replay) {
      response.write(encodeSseFrame(event));
    }
    const unsubscribe = stream.subscribe((event) => {
      response.write(encodeSseFrame(event));
    });
    request.on("close", () => {
      unsubscribe();
      response.end();
    });
    return;
  }

  sendJson(response, 200, {
    task_id: taskId,
    events: runtime.store.getTaskEventsSince(taskId, url.searchParams.get("since"))
  });
}

export async function tryHandleTaskRoute({ request, response, method, url, runtime }) {
  const taskLogMatch = url.pathname.match(/^\/task\/([^/]+)\/log$/);
  const taskEventMatch = url.pathname.match(/^\/task\/([^/]+)\/events$/);
  const fileRecoveryMatch = url.pathname.match(/^\/task\/([^/]+)\/file-recovery\/([^/]+)$/);
  const taskMatch = url.pathname.match(/^\/task\/([^/]+)$/);
  const cancelMatch = url.pathname.match(/^\/task\/([^/]+)\/cancel$/);
  const retryMatch = url.pathname.match(/^\/task\/([^/]+)\/retry$/);
  const restoreMatch = url.pathname.match(/^\/task\/([^/]+)\/restore$/);

  // UCA-182 Phase 11: per-task event log — reads the jsonl log persist_ed by
  // task-runtime.emitTaskEvent. Used by the console Settings "最近失败任务"
  // view and for post-mortem debugging of task IDs reported by users.
  if (method === "GET" && taskLogMatch) {
    const taskId = decodeURIComponent(taskLogMatch[1]);
    const events = await readTaskEventLog(runtime, taskId);
    sendJson(response, 200, { taskId, events });
    return true;
  }

  // UCA-182 Phase 11: recent failed tasks (Settings panel).
  if (method === "GET" && url.pathname === "/tasks/failed") {
    const limitParam = Number(url.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 20;
    try {
      const all = runtime.store?.listTasks?.() ?? [];
      const failed = all
        .filter((t) => t && (t.status === "failed" || t.sub_status === "internal_error"))
        .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))
        .slice(0, limit)
        .map((t) => ({
          task_id: t.task_id,
          created_at: t.created_at,
          updated_at: t.updated_at,
          status: t.status,
          sub_status: t.sub_status,
          user_command: String(t.user_command ?? "").slice(0, 200),
          failure_user_message: t.failure_user_message ?? null,
          failure_category: t.failure_category ?? null
        }));
      sendJson(response, 200, { failed });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/context") {
    const body = await readJsonBody(request);
    const inspection = runtime.securityBroker.inspectContext(body.contextPacket, {
      trigger: "http_context_preview"
    });
    sendJson(response, 200, inspection);
    return true;
  }

  if (method === "POST" && url.pathname === "/task") {
    const startedAtMs = Date.now();
    const body = await readJsonBody(request);
    const result = await submitTaskFromBody(runtime, body);
    emitSubmitToTaskCreatedTiming(runtime, result, startedAtMs, "/task");
    sendJson(response, 200, result);
    return true;
  }

  // UCA-059: /task/clarify — merge original command + clarification answer
  // and resubmit as a normal task (clarificationOf flag skips the ambiguity
  // check so we don't re-trigger the same question in a loop).
  if (method === "POST" && url.pathname === "/task/clarify") {
    const body = await readJsonBody(request);
    const originalCommand = String(body.originalCommand ?? "").trim();
    const clarificationAnswer = String(body.clarificationAnswer ?? "").trim();
    if (!originalCommand || !clarificationAnswer) {
      sendJson(response, 400, { ok: false, error: "missing_fields", message: "originalCommand and clarificationAnswer are required." });
      return true;
    }
    // Merge: prepend original command + clarification into a single richer command.
    const mergedCommand = `${originalCommand}（补充信息：${clarificationAnswer}）`;
    const mergedBody = {
      ...body,
      userCommand: mergedCommand,
      clarificationOf: originalCommand
    };
    delete mergedBody.originalCommand;
    delete mergedBody.clarificationAnswer;
    const startedAtMs = Date.now();
    const result = await submitTaskFromBody(runtime, mergedBody);
    emitSubmitToTaskCreatedTiming(runtime, result, startedAtMs, "/task/clarify");
    sendJson(response, 200, result);
    return true;
  }

  if (method === "GET" && url.pathname === "/tasks") {
    sendJson(response, 200, {
      tasks: listTaskSummaries(runtime, { deleted: taskDeletedFilterFromUrl(url) })
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/tasks/summary") {
    sendJson(response, 200, buildTaskSummaryPayload(runtime, {
      recentLimit: url.searchParams.get("limit") ?? 80
    }));
    return true;
  }

  if (taskMatch && method === "GET") {
    const payload = summarizeTask(runtime, taskMatch[1]);
    if (!payload) {
      sendJson(response, 404, { error: "task_not_found" });
      return true;
    }
    sendJson(response, 200, payload);
    return true;
  }

  if (taskEventMatch && method === "GET") {
    await handleTaskEventStream({
      request,
      response,
      url,
      runtime,
      taskId: taskEventMatch[1]
    });
    return true;
  }

  if (fileRecoveryMatch && method === "POST") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) return true;
    const taskId = decodeURIComponent(fileRecoveryMatch[1]);
    const checkpointId = decodeURIComponent(fileRecoveryMatch[2]);
    const task = runtime.store.getTask(taskId);
    if (!task) {
      sendJson(response, 404, { error: "task_not_found" });
      return true;
    }
    const events = runtime.store.getTaskEvents(taskId);
    const checkpoint = collectFileReversibilityCheckpoints(events)
      .find((entry) => entry.checkpoint_id === checkpointId);
    if (!checkpoint) {
      sendJson(response, 404, { error: "checkpoint_not_found" });
      return true;
    }
    try {
      const result = await applyFileReversibilityCheckpoint(checkpoint, { actor });
      emitTaskEvent({
        runtime,
        taskId,
        eventType: "file_recovery_applied",
        payload: {
          checkpoint_id: checkpointId,
          reverse_operation: result.reverse_operation,
          target_path: result.target_path,
          backup_path: result.backup_path ?? null,
          restored_by: actor
        }
      });
      sendJson(response, 200, { restored: true, task_id: taskId, recovery: result });
    } catch (error) {
      sendJson(response, 400, {
        error: "file_recovery_failed",
        message: error?.message ?? String(error)
      });
    }
    return true;
  }

  if (cancelMatch && method === "POST") {
    if (!requireDesktopActor({ request, response })) return true;
    // Body may carry { force: true } — used by the renderer when the user
    // double-clicks the stop button to escape an executor that's not honouring
    // the polite cancel signal.
    let body = {};
    try { body = await readJsonBody(request); } catch { /* empty body OK */ }
    const task = await cancelTask({
      runtime,
      taskId: cancelMatch[1],
      force: Boolean(body?.force)
    });
    if (!task) {
      sendJson(response, 404, { error: "task_not_found" });
      return true;
    }
    sendJson(response, 200, { task });
    return true;
  }

  if (taskMatch && method === "DELETE") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) return true;
    const taskId = taskMatch[1];
    const task = runtime.store.getTask(taskId);
    if (!task) {
      sendJson(response, 404, { error: "task_not_found" });
      return true;
    }
    const hard = url.searchParams.get("hard") === "true";
    if (hard) {
      if (!runtime.config?.allowHardDelete) {
        sendJson(response, 403, { error: "hard delete is disabled" });
        return true;
      }
      runtime.store.deleteTask(taskId);
      sendJson(response, 200, { deleted: true, hard: true, task_id: taskId });
      return true;
    }
    if (typeof runtime.store.softDeleteTask !== "function") {
      sendJson(response, 503, { error: "task_soft_delete_unavailable" });
      return true;
    }
    const deleted = runtime.store.softDeleteTask(taskId, { actor });
    sendJson(response, 200, { deleted: true, soft: true, task_id: taskId, task: deleted });
    return true;
  }

  if (restoreMatch && method === "POST") {
    const actor = requireDesktopActor({ request, response });
    if (!actor) return true;
    const taskId = restoreMatch[1];
    if (typeof runtime.store.restoreTask !== "function") {
      sendJson(response, 503, { error: "task_restore_unavailable" });
      return true;
    }
    const restored = runtime.store.restoreTask(taskId, { actor });
    if (!restored) {
      sendJson(response, 404, { error: "task_not_found" });
      return true;
    }
    sendJson(response, 200, { restored: true, task_id: taskId, task: restored });
    return true;
  }

  if (retryMatch && method === "POST") {
    if (!requireDesktopActor({ request, response })) return true;
    const body = await readJsonBody(request);
    const result = await retryTask({
      taskId: retryMatch[1],
      runtime,
      mode: body.mode ?? "retry_same",
      overrides: body.overrides ?? {},
      background: body.background === true || body.returnImmediately === true
    });
    sendJson(response, 200, result);
    return true;
  }

  return false;
}
