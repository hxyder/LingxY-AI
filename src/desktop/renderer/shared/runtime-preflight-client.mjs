import { runtimeJsonOptions } from "./runtime-submission-client.mjs";

export function createRuntimePreflightClient({
  httpClient,
  actor = null
} = {}) {
  if (!httpClient || typeof httpClient.fetchJson !== "function") {
    throw new TypeError("createRuntimePreflightClient requires httpClient.fetchJson.");
  }

  function jsonOptions(body = {}) {
    return runtimeJsonOptions("POST", body, { actor });
  }

  return {
    testMcpServerConfig(payload = {}) {
      return httpClient.fetchJson("/config/mcp/test", jsonOptions(payload));
    },
    planMcpInstall(payload = {}) {
      return httpClient.fetchJson("/config/mcp/install/plan", jsonOptions(payload));
    },
    testSkillRegistryConfig(payload = {}) {
      return httpClient.fetchJson("/config/skills/test", jsonOptions(payload));
    },
    previewDag(graph) {
      return httpClient.fetchJson("/dag/preview", jsonOptions({ graph }));
    }
  };
}
