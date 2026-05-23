import { readFile } from "node:fs/promises";

function resolveBaseUrl(baseUrl = null) {
  return baseUrl
    ?? process.env.UCA_RUNTIME_BASE_URL
    ?? "http://127.0.0.1:4310";
}

async function ensureOk(response) {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Runtime request failed: ${response.status} ${message}`);
  }
  return response;
}

export function createRuntimeTransport({ baseUrl = null } = {}) {
  const resolvedBaseUrl = resolveBaseUrl(baseUrl);

  return {
    baseUrl: resolvedBaseUrl,
    async submitContextAndTask(payload) {
      const response = await ensureOk(await fetch(`${resolvedBaseUrl}/task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceApp: payload.source.sourceApp,
          captureMode: payload.source.captureMode,
          filePaths: payload.task.filePaths,
          userCommand: payload.task.userCommand
        })
      }));
      return response.json();
    },
    async submitBrowserCapture(requestPayload) {
      const response = await ensureOk(await fetch(`${resolvedBaseUrl}/task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestPayload)
      }));
      return response.json();
    },
    async listRecentTasks() {
      const response = await ensureOk(await fetch(`${resolvedBaseUrl}/tasks`));
      return response.json();
    },
    async getSecurityState() {
      const response = await ensureOk(await fetch(`${resolvedBaseUrl}/security/state`));
      return response.json();
    },
    async resolveFromFile(filePath) {
      return JSON.parse(await readFile(filePath, "utf8"));
    }
  };
}
