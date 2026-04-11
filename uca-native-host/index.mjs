import { buildNativeHostManifest } from "./registry-manifest.mjs";

export function createNativeHostHandler(runtime) {
  return async function handleMessage(message) {
    switch (message.action) {
      case "ping":
        return {
          protocolVersion: "1.0",
          requestId: message.requestId,
          ok: true,
          payload: {
            host: runtime.hostName ?? "com.uca.host"
          }
        };
      case "get_recent_tasks":
        return {
          protocolVersion: "1.0",
          requestId: message.requestId,
          ok: true,
          payload: {
            tasks: runtime.listRecentTasks()
          }
        };
      case "submit_capture": {
        const result = await runtime.submitCapture(message.payload);
        return {
          protocolVersion: "1.0",
          requestId: message.requestId,
          ok: true,
          payload: {
            taskId: result.task.task_id,
            status: result.task.status,
            sourceType: result.task.context_packet.source_type
          }
        };
      }
      case "handoff_capture": {
        const result = await runtime.handoffCapture(message.payload);
        return {
          protocolVersion: "1.0",
          requestId: message.requestId,
          ok: true,
          payload: {
            accepted: result.accepted ?? true,
            delivery: "overlay",
            sourceType: result.sourceType ?? message.payload?.capture?.sourceType ?? null,
            handoffPath: result.handoffPath ?? null
          }
        };
      }
      default:
        return {
          protocolVersion: "1.0",
          requestId: message.requestId,
          ok: false,
          error: {
            code: "unsupported_action",
            message: `Unsupported action: ${message.action}`
          }
        };
    }
  };
}

export { buildNativeHostManifest };
