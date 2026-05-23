export function createRuntimeTaskClient({ httpClient } = {}) {
  if (!httpClient || typeof httpClient.fetchJson !== "function") {
    throw new TypeError("createRuntimeTaskClient requires httpClient.fetchJson.");
  }

  return {
    fetchTasks() {
      return httpClient.fetchJson("/tasks");
    },
    fetchTaskSummaries({ limit = 120 } = {}) {
      return httpClient.fetchJson(`/tasks/summary?limit=${encodeURIComponent(String(limit))}`);
    },
    fetchDeletedTasks() {
      return httpClient.fetchJson("/tasks?deleted=only");
    },
    fetchFailedTasks() {
      return httpClient.fetchJson("/tasks/failed");
    },
    fetchTaskDetail(taskId) {
      return httpClient.fetchJson(`/task/${encodeURIComponent(taskId)}`);
    },
    fetchTaskLog(taskId) {
      return httpClient.fetchJson(`/task/${encodeURIComponent(taskId)}/log`);
    }
  };
}
