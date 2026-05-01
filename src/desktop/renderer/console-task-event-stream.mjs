import {
  applyTaskEventPatch,
  applyTaskEventToDetail,
  subscribeTaskEvents,
  toTaskEventFrame
} from "./task-event-stream.js";

const DETAIL_REFRESH_EVENTS = new Set([
  "artifact_created",
  "success",
  "partial_success",
  "failed",
  "cancelled"
]);

export function createConsoleTaskEventController({
  state,
  documentRef,
  renderSummary,
  renderTasks,
  renderTaskDetail,
  refreshTaskDetail,
  refreshWorkspace,
  surfaceApprovalPopup
}) {
  let selectedTaskEventStream = null;
  let selectedTaskEventTaskId = null;
  let selectedTaskEventBaseUrl = null;
  let handledSelectedTaskEventIds = new Set();

  function close() {
    selectedTaskEventStream?.close?.();
    selectedTaskEventStream = null;
    selectedTaskEventTaskId = null;
    selectedTaskEventBaseUrl = null;
    handledSelectedTaskEventIds = new Set();
  }

  function updateTaskInWorkspace(taskId, patchEvent) {
    const i = state.workspace.tasks.findIndex((task) => task.task_id === taskId);
    if (i === -1) return null;
    const next = applyTaskEventPatch(state.workspace.tasks[i], patchEvent);
    state.workspace.tasks[i] = next;
    return next;
  }

  async function handleSelectedTaskEventFrame(rawEvent) {
    const frame = toTaskEventFrame(rawEvent);
    if (frame.id && handledSelectedTaskEventIds.has(frame.id)) return;
    if (frame.id) handledSelectedTaskEventIds.add(frame.id);

    const selectedTaskId = state.selectedTaskId;
    if (frame.event === "pending_approval_created") {
      void surfaceApprovalPopup(frame.data ?? {}, { taskId: selectedTaskId });
      void refreshWorkspace();
    }

    const updated = updateTaskInWorkspace(selectedTaskId, frame);
    if (updated) {
      renderSummary();
      renderTasks();
    }

    if (state.selectedTaskDetail?.task?.task_id === selectedTaskId) {
      state.selectedTaskDetail = applyTaskEventToDetail(state.selectedTaskDetail, frame);
      renderTaskDetail(state.selectedTaskDetail);
    }

    if (DETAIL_REFRESH_EVENTS.has(frame.event)) {
      await refreshTaskDetail();
    }
  }

  function showStreamError(error) {
    const railSysText = documentRef?.querySelector?.("#railSysText");
    const railSys = documentRef?.querySelector?.("#railSys");
    if (railSysText) railSysText.textContent = `Stream disconnected · ${error.message}`;
    if (railSys) railSys.classList.add("rail-sys--warn");
  }

  function ensure(taskId) {
    if (!taskId) {
      close();
      return;
    }
    if (
      selectedTaskEventTaskId === taskId
      && selectedTaskEventBaseUrl === state.serviceBaseUrl
      && selectedTaskEventStream
    ) {
      return;
    }

    close();
    selectedTaskEventTaskId = taskId;
    selectedTaskEventBaseUrl = state.serviceBaseUrl;
    selectedTaskEventStream = subscribeTaskEvents(state.serviceBaseUrl, taskId, {
      onEvent(event) {
        void handleSelectedTaskEventFrame(event);
      },
      onError(error) {
        showStreamError(error);
      }
    });
  }

  return {
    close,
    ensure,
    handleSelectedTaskEventFrame,
    updateTaskInWorkspace
  };
}
