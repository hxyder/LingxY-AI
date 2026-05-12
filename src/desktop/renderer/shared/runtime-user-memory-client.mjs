import { runtimeJsonOptions } from "./runtime-submission-client.mjs";

export function createRuntimeUserMemoryClient({
  httpClient,
  actor = "desktop_console"
} = {}) {
  if (!httpClient || typeof httpClient.fetchJson !== "function") {
    throw new TypeError("createRuntimeUserMemoryClient requires httpClient.fetchJson.");
  }

  return {
    saveUserMemory(payload = {}) {
      return httpClient.fetchJson(
        "/config/user-memory",
        runtimeJsonOptions("POST", payload, { actor })
      );
    },
    decideProposal(proposalId, action) {
      return httpClient.fetchJson(
        `/config/user-memory/proposals/${encodeURIComponent(proposalId)}`,
        runtimeJsonOptions("POST", { action }, { actor })
      );
    },
    deleteMemory(memoryId) {
      return httpClient.fetchJson(
        `/config/user-memory/memories/${encodeURIComponent(memoryId)}`,
        runtimeJsonOptions("DELETE", {}, { actor })
      );
    }
  };
}
