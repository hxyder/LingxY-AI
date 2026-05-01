import http from "node:http";
import { URL } from "node:url";
import { tryHandleAiStatusRoute } from "./http-routes/ai-status-routes.mjs";
import { tryHandleAudioRoute } from "./http-routes/audio-routes.mjs";
import { tryHandleBrowserContextRoute } from "./http-routes/browser-context-routes.mjs";
import { tryHandleConnectorRoute } from "./http-routes/connector-routes.mjs";
import { tryHandleConfigProviderRoute } from "./http-routes/config-provider-routes.mjs";
import { tryHandleNoteProjectConversationRoute } from "./http-routes/note-project-conversation-routes.mjs";
import { tryHandleOfficeRoute } from "./http-routes/office-routes.mjs";
import { tryHandlePreviewFileRoute } from "./http-routes/preview-file-routes.mjs";
import { tryHandleRuntimeAdminRoute } from "./http-routes/runtime-admin-routes.mjs";
import { tryHandleSchedulerTemplateRoute } from "./http-routes/scheduler-template-routes.mjs";
import { tryHandleTaskRoute } from "./http-routes/task-routes.mjs";
import { sendJson } from "./http-helpers.mjs";
import { createProviderModelDiscovery } from "../ai/providers/model-discovery.mjs";

export { handlePageExplain } from "./http-routes/browser-context-routes.mjs";
export { buildTaskSummaryPayload } from "./http-routes/task-routes.mjs";

function saveRuntimeConfig(runtime, updater) {
  const currentConfig = runtime.configStore?.load?.() ?? {};
  const nextConfig = updater(currentConfig);
  runtime.configStore?.save?.(nextConfig);
  return nextConfig;
}

export function createServiceHttpServer({ runtime, paths, port = 0, host = "127.0.0.1" }) {
  const recentBrowserContexts = [];
  const providerModelDiscovery = runtime.providerModelDiscovery ?? createProviderModelDiscovery();
  runtime.providerModelDiscovery = providerModelDiscovery;
  const routeGroups = [
    {
      name: "office",
      handle: tryHandleOfficeRoute
    },
    {
      name: "note-project-conversation",
      handle: (context) => tryHandleNoteProjectConversationRoute({
        ...context,
        saveRuntimeConfig
      })
    },
    {
      name: "config-provider",
      handle: (context) => tryHandleConfigProviderRoute({
        ...context,
        providerModelDiscovery
      })
    },
    {
      name: "ai-status",
      handle: tryHandleAiStatusRoute
    },
    {
      name: "audio",
      handle: tryHandleAudioRoute
    },
    {
      name: "preview-file",
      handle: tryHandlePreviewFileRoute
    },
    {
      name: "browser-context",
      handle: (context) => tryHandleBrowserContextRoute({
        ...context,
        recentBrowserContexts
      })
    },
    {
      name: "scheduler-template",
      handle: tryHandleSchedulerTemplateRoute
    },
    {
      name: "task",
      handle: tryHandleTaskRoute
    },
    {
      name: "runtime-admin",
      handle: (context) => tryHandleRuntimeAdminRoute({
        ...context,
        paths
      })
    },
    {
      name: "connector",
      handle: tryHandleConnectorRoute
    }
  ];

  async function tryHandleRouteGroups(context) {
    for (const group of routeGroups) {
      if (await group.handle(context)) {
        return true;
      }
    }
    return false;
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://${host}`);

    try {
      if (await tryHandleRouteGroups({
        request,
        response,
        method,
        url,
        runtime
      })) return;

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
      if (!server.listening) {
        return;
      }
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
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
