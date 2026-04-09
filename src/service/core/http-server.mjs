import http from "node:http";
import { URL } from "node:url";
import { createTaskEventStream, encodeSseFrame } from "../events/sse.mjs";
import { retryTask } from "../retry/retry-manager.mjs";
import { cancelTask } from "./task-runtime.mjs";
import { submitActionToolTask } from "./action-tool-submission.mjs";
import { submitBrowserTask } from "./browser-submission.mjs";
import { submitContextTask } from "./context-submission.mjs";
import { submitFileTask } from "./file-submission.mjs";
import { submitImageTask } from "./image-submission.mjs";
import { submitOfficeTask } from "./office-submission.mjs";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function listTaskSummaries(runtime) {
  return runtime.store.listTasks().map((task) => ({
    task_id: task.task_id,
    created_at: task.created_at,
    status: task.status,
    sub_status: task.sub_status,
    intent: task.intent,
    executor: task.executor,
    source_type: task.context_packet?.source_type ?? null,
    user_command: task.user_command
  }));
}

function summarizeTask(runtime, taskId) {
  const task = runtime.store.getTask(taskId);
  if (!task) {
    return null;
  }
  return {
    task,
    events: runtime.store.getTaskEvents(taskId),
    artifacts: runtime.store.getArtifactsForTask(taskId)
  };
}

async function submitTaskFromBody(runtime, body) {
  if (body.filePaths?.length) {
    return submitFileTask({
      filePaths: body.filePaths,
      userCommand: body.userCommand,
      captureMode: body.captureMode,
      sourceApp: body.sourceApp,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      runtime
    });
  }

  if (body.capture?.sourceType) {
    return submitBrowserTask({
      capture: body.capture,
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      runtime
    });
  }

  if (body.imagePaths?.length) {
    return submitImageTask({
      imagePaths: body.imagePaths,
      userCommand: body.userCommand,
      source: body.source,
      sourceApp: body.sourceApp,
      captureMode: body.captureMode,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride ?? "multi_modal",
      runtime
    });
  }

  if (body.officeCapture?.officeApp) {
    return submitOfficeTask({
      capture: body.officeCapture,
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      executorOverride: body.executorOverride,
      runtime
    });
  }

  if (body.submissionType === "action_tool") {
    return submitActionToolTask({
      userCommand: body.userCommand,
      executionMode: body.executionMode,
      sourceApp: body.sourceApp,
      captureMode: body.captureMode,
      runtime
    });
  }

  return submitContextTask({
    contextPacket: body.contextPacket ?? {
      source_type: body.sourceType ?? "clipboard",
      source_app: body.sourceApp ?? "uca.http",
      capture_mode: body.captureMode ?? "manual",
      text: body.text ?? ""
    },
    userCommand: body.userCommand,
    executionMode: body.executionMode,
    executorOverride: body.executorOverride,
    runtime
  });
}

export function createServiceHttpServer({ runtime, paths, port = 0, host = "127.0.0.1" }) {
  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const taskEventMatch = url.pathname.match(/^\/task\/([^/]+)\/events$/);
    const taskMatch = url.pathname.match(/^\/task\/([^/]+)$/);
    const cancelMatch = url.pathname.match(/^\/task\/([^/]+)\/cancel$/);
    const retryMatch = url.pathname.match(/^\/task\/([^/]+)\/retry$/);
    const approvalApproveMatch = url.pathname.match(/^\/approvals\/([^/]+)\/approve$/);
    const approvalRejectMatch = url.pathname.match(/^\/approvals\/([^/]+)\/reject$/);
    const scheduleRunsMatch = url.pathname.match(/^\/schedules\/([^/]+)\/runs$/);

    try {
      if (method === "GET" && url.pathname === "/health") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          ok: true,
          runtime_dir: paths.baseDir,
          db_path: paths.dbPath,
          task_total: runtime.store.listTasks().length,
          kimi: runtime.kimiRuntimeStatus ?? null,
          providers: await runtime.platform.aiProviders.listStatus({
            runtime,
            config
          })
        });
      }

      if (method === "POST" && url.pathname === "/context") {
        const body = await readJsonBody(request);
        const inspection = runtime.securityBroker.inspectContext(body.contextPacket, {
          trigger: "http_context_preview"
        });
        return sendJson(response, 200, inspection);
      }

      if (method === "POST" && url.pathname === "/task") {
        const body = await readJsonBody(request);
        const result = await submitTaskFromBody(runtime, body);
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/tasks") {
        return sendJson(response, 200, {
          tasks: listTaskSummaries(runtime)
        });
      }

      if (taskMatch && method === "GET") {
        const payload = summarizeTask(runtime, taskMatch[1]);
        if (!payload) {
          return sendJson(response, 404, { error: "task_not_found" });
        }
        return sendJson(response, 200, payload);
      }

      if (taskEventMatch && method === "GET") {
        const taskId = taskEventMatch[1];
        const task = runtime.store.getTask(taskId);
        if (!task) {
          return sendJson(response, 404, { error: "task_not_found" });
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

        return sendJson(response, 200, {
          task_id: taskId,
          events: runtime.store.getTaskEventsSince(taskId, url.searchParams.get("since"))
        });
      }

      if (cancelMatch && method === "POST") {
        const task = await cancelTask({
          runtime,
          taskId: cancelMatch[1]
        });
        if (!task) {
          return sendJson(response, 404, { error: "task_not_found" });
        }
        return sendJson(response, 200, { task });
      }

      if (retryMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = await retryTask({
          taskId: retryMatch[1],
          runtime,
          mode: body.mode ?? "retry_same",
          overrides: body.overrides ?? {}
        });
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/metrics") {
        response.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8"
        });
        response.end(runtime.metrics.renderPrometheus());
        return;
      }

      if (method === "GET" && url.pathname === "/approvals") {
        return sendJson(response, 200, {
          approvals: runtime.pendingApprovals.list()
        });
      }

      if (approvalApproveMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = await runtime.scheduler.approvePendingApproval(approvalApproveMatch[1], body);
        if (!result) {
          return sendJson(response, 404, { error: "approval_not_found" });
        }
        return sendJson(response, 200, result);
      }

      if (approvalRejectMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = runtime.scheduler.rejectPendingApproval(approvalRejectMatch[1], body);
        if (!result) {
          return sendJson(response, 404, { error: "approval_not_found" });
        }
        return sendJson(response, 200, { approval: result });
      }

      if (method === "GET" && url.pathname === "/audit-log") {
        return sendJson(response, 200, {
          entries: runtime.store.listAuditLogs()
        });
      }

      if (method === "GET" && url.pathname === "/security/state") {
        return sendJson(response, 200, {
          security: runtime.securityBroker.getConfig()
        });
      }

      if (method === "POST" && url.pathname === "/security/state") {
        const body = await readJsonBody(request);
        const security = runtime.persistSecurityConfig(body);
        return sendJson(response, 200, { security });
      }

      if (method === "GET" && url.pathname === "/schedules") {
        return sendJson(response, 200, {
          schedules: runtime.scheduler.listSchedules()
        });
      }

      if (scheduleRunsMatch && method === "GET") {
        return sendJson(response, 200, {
          schedule_id: scheduleRunsMatch[1],
          runs: runtime.store.listScheduleRuns(scheduleRunsMatch[1])
        });
      }

      if (scheduleRunsMatch && method === "POST") {
        const body = await readJsonBody(request);
        const result = await runtime.scheduler.dispatch(scheduleRunsMatch[1], "manual", body.triggerPayload ?? {});
        if (!result) {
          return sendJson(response, 404, { error: "schedule_not_found" });
        }
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/templates") {
        return sendJson(response, 200, {
          templates: runtime.platform.templateRegistry.list()
        });
      }

      if (method === "GET" && url.pathname.startsWith("/templates/")) {
        const templateId = decodeURIComponent(url.pathname.slice("/templates/".length));
        const template = runtime.platform.templateRegistry.get(templateId);
        if (!template) {
          return sendJson(response, 404, { error: "template_not_found" });
        }
        return sendJson(response, 200, { template });
      }

      if (method === "POST" && url.pathname === "/templates/validate") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, body);
      }

      if (method === "POST" && url.pathname === "/dag/preview") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, body);
      }

      if (method === "GET" && url.pathname === "/budget") {
        return sendJson(response, 200, {
          budget: runtime.platform.budgetManager.getState()
        });
      }

      if (method === "POST" && url.pathname === "/history/search") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, {
          results: runtime.platform.embeddingStore.search(body.query ?? "", body.limit ?? 5)
        });
      }

      if (method === "GET" && url.pathname === "/executors") {
        return sendJson(response, 200, {
          executors: runtime.executorRegistry.list()
        });
      }

      if (method === "GET" && url.pathname === "/ai/providers") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          providers: await runtime.platform.aiProviders.listStatus({
            runtime,
            config
          })
        });
      }

      if (method === "GET" && url.pathname === "/ai/code-cli") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          adapters: await runtime.platform.codeCliAdapters.listStatus({
            runtime,
            config
          })
        });
      }

      if (method === "GET" && url.pathname === "/ai/mcp") {
        return sendJson(response, 200, {
          servers: runtime.platform.mcpServers.list()
        });
      }

      if (method === "GET" && url.pathname === "/ai/skills") {
        return sendJson(response, 200, {
          registries: runtime.platform.skillRegistries.list()
        });
      }

      return sendJson(response, 404, {
        error: "not_found",
        path: url.pathname
      });
    } catch (error) {
      return sendJson(response, 500, {
        error: "internal_error",
        message: error.message
      });
    }
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(port, host, resolve));
      const address = server.address();
      return {
        port: typeof address === "object" && address ? address.port : port,
        host
      };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    server
  };
}
