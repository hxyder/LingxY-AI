import {
  ACCOUNT_LIST_EMAILS_TOOL,
  ACCOUNT_LIST_EVENTS_TOOL,
  ACCOUNT_LIST_FILES_TOOL
} from "../../connectors/tools/read-tools.mjs";
import { getGoogleMessage } from "../../connectors/google/google-connector.mjs";
import { getMicrosoftMessage } from "../../connectors/microsoft/microsoft-connector.mjs";
import {
  startMicrosoftAuth,
  startGoogleAuth,
  completeOAuthCallback,
  disconnectAccount,
  getConnectorStatus,
  loadConnectorConfig,
  saveConnectorConfig
} from "../../connectors/account-connectors.mjs";
import {
  deleteConnectedAccount,
  getAccountById,
  listUserAccounts,
  setDefaultAccount,
  upsertConnectedAccount
} from "../../connectors/core/account-registry.mjs";
import { submitConnectorWorkflowTask } from "../../connectors/core/workflow-submission.mjs";
import { sendJson, sendHtml, readJsonBody } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";

async function sendConnectorReadToolResult(response, tool, args, dataKey, runtime) {
  const result = await tool.execute(args, { runtime });
  const values = result.metadata?.[dataKey] ?? [];
  return sendJson(response, result.success ? 200 : 400, {
    ok: result.success,
    [dataKey]: values,
    connector_status: result.metadata?.connector_status ?? (result.success ? "success" : "error"),
    provider: result.metadata?.provider ?? args.provider ?? null,
    accountId: result.metadata?.accountId ?? args.accountId ?? null,
    message: result.observation
  });
}

/**
 * Handle any /connectors/* or /auth/callback request. Returns true when the
 * request was handled (caller should not continue routing), false otherwise.
 */
export async function tryHandleConnectorRoute({ request, response, url, method, runtime }) {
  // GET /connectors/catalog — provider-neutral catalog discovery.
  if (method === "GET" && url.pathname === "/connectors/catalog") {
    const catalog = runtime.connectorCatalog;
    if (!catalog) {
      sendJson(response, 503, { error: "connector_catalog_unavailable" });
      return true;
    }
    const query = url.searchParams.get("q") ?? "";
    const provider = url.searchParams.get("provider") ?? undefined;
    const service = url.searchParams.get("service") ?? undefined;
    const capability = url.searchParams.get("capability") ?? undefined;
    sendJson(response, 200, {
      providers: catalog.listProviders(),
      tools: catalog.listTools({ query, provider, service, capability }),
      workflows: catalog.listWorkflows({ query, provider, service }),
      mcp: {
        resources: catalog.toMcpResources(),
        tools: catalog.toMcpToolSummaries().map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          annotations: tool.annotations
        }))
      }
    });
    return true;
  }

  if (method === "GET" && /^\/connectors\/catalog\/tools\/[^/]+$/.test(url.pathname)) {
    const toolId = decodeURIComponent(url.pathname.replace(/^\/connectors\/catalog\/tools\//, ""));
    const tool = runtime.connectorCatalog?.getTool?.(toolId);
    if (!tool) {
      sendJson(response, 404, { error: "connector_tool_not_found" });
      return true;
    }
    sendJson(response, 200, { tool });
    return true;
  }

  if (method === "GET" && /^\/connectors\/catalog\/workflows\/[^/]+$/.test(url.pathname)) {
    const workflowId = decodeURIComponent(url.pathname.replace(/^\/connectors\/catalog\/workflows\//, ""));
    const workflow = runtime.connectorCatalog?.getWorkflow?.(workflowId);
    if (!workflow) {
      sendJson(response, 404, { error: "connector_workflow_not_found" });
      return true;
    }
    sendJson(response, 200, { workflow });
    return true;
  }

  if (method === "POST" && /^\/connectors\/catalog\/workflows\/[^/]+\/run$/.test(url.pathname)) {
    const workflowId = decodeURIComponent(url.pathname
      .replace(/^\/connectors\/catalog\/workflows\//, "")
      .replace(/\/run$/, ""));
    if (!runtime.connectorCatalog?.getWorkflow?.(workflowId)) {
      sendJson(response, 404, { error: "connector_workflow_not_found" });
      return true;
    }
    const body = await readJsonBody(request);
    const result = await submitConnectorWorkflowTask({
      runtime,
      workflowId,
      input: body.input ?? {},
      state: body.state ?? {},
      userCommand: body.userCommand ?? `Run connector workflow ${workflowId}`,
      executionMode: body.executionMode ?? "interactive"
    });
    sendJson(response, 200, result);
    return true;
  }

  // ── Plugin management (built-in + installed external plugins) ─────────────
  if (runtime.pluginRegistry) {
    if (method === "GET" && url.pathname === "/plugins") {
      sendJson(response, 200, { plugins: runtime.pluginRegistry.list() });
      return true;
    }

    if (method === "POST" && url.pathname === "/plugins/install") {
      if (!requireDesktopActor({ request, response })) return true;
      const body = await readJsonBody(request);
      try {
        const plugin = await runtime.pluginRegistry.install(body);
        sendJson(response, 200, { ok: true, plugin });
      } catch (error) {
        sendJson(response, 400, { error: "install_failed", message: error.message });
      }
      return true;
    }

    if (method === "DELETE" && /^\/plugins\/[^/]+$/.test(url.pathname)) {
      if (!requireDesktopActor({ request, response })) return true;
      const pluginId = decodeURIComponent(url.pathname.split("/")[2]);
      try {
        const removed = await runtime.pluginRegistry.uninstall(pluginId);
        sendJson(response, 200, { ok: true, plugin: removed });
      } catch (error) {
        sendJson(response, 400, { error: "uninstall_failed", message: error.message });
      }
      return true;
    }

    if (method === "PATCH" && /^\/plugins\/[^/]+\/enabled$/.test(url.pathname)) {
      if (!requireDesktopActor({ request, response })) return true;
      const pluginId = decodeURIComponent(url.pathname.split("/")[2]);
      const body = await readJsonBody(request);
      try {
        const plugin = runtime.pluginRegistry.setEnabled(pluginId, body.enabled === true);
        sendJson(response, 200, { ok: true, plugin });
      } catch (error) {
        sendJson(response, 400, { error: "toggle_failed", message: error.message });
      }
      return true;
    }

    if (method === "POST" && url.pathname === "/plugins/reload") {
      if (!requireDesktopActor({ request, response })) return true;
      runtime.pluginRegistry.reload();
      sendJson(response, 200, { ok: true, plugins: runtime.pluginRegistry.list() });
      return true;
    }
  }

  // GET /connectors/connected-accounts — canonical account-level registry
  if (method === "GET" && url.pathname === "/connectors/connected-accounts") {
    sendJson(response, 200, {
      accounts: listUserAccounts(runtime)
    });
    return true;
  }

  // PATCH /connectors/connected-accounts/:accountId — rename / edit
  // mutable fields. Currently displayName only; can grow.
  if (method === "PATCH" && /^\/connectors\/connected-accounts\/[^/]+$/.test(url.pathname)) {
    const accountId = decodeURIComponent(url.pathname.split("/")[3]);
    const body = await readJsonBody(request);
    const account = getAccountById(runtime, accountId);
    if (!account) {
      sendJson(response, 404, { error: "account_not_found" });
      return true;
    }
    const updates = {};
    if (typeof body?.displayName === "string") {
      updates.displayName = body.displayName.trim().slice(0, 80) || null;
    }
    if (Object.keys(updates).length === 0) {
      sendJson(response, 400, { error: "no_updatable_fields" });
      return true;
    }
    const updated = upsertConnectedAccount(runtime, { ...account, ...updates });
    sendJson(response, 200, { ok: true, account: updated });
    return true;
  }

  // PATCH /connectors/connected-accounts/:accountId/defaults — set default purpose
  if (method === "PATCH" && /^\/connectors\/connected-accounts\/[^/]+\/defaults$/.test(url.pathname)) {
    const accountId = decodeURIComponent(url.pathname.split("/")[3]);
    const body = await readJsonBody(request);
    const purposes = [];
    if (body.purpose) {
      purposes.push(body.purpose);
    }
    if (body.isDefaultForEmail === true) purposes.push("email");
    if (body.isDefaultForFiles === true) purposes.push("files");
    if (body.isDefaultForCalendar === true) purposes.push("calendar");
    if (purposes.length === 0) {
      sendJson(response, 400, { error: "missing_default_purpose" });
      return true;
    }
    try {
      for (const purpose of purposes) {
        setDefaultAccount(runtime, purpose, accountId);
      }
      sendJson(response, 200, { ok: true, account: getAccountById(runtime, accountId) });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return true;
  }

  // DELETE /connectors/connected-accounts/:accountId — disconnect one account
  if (method === "DELETE" && /^\/connectors\/connected-accounts\/[^/]+$/.test(url.pathname)) {
    const accountId = decodeURIComponent(url.pathname.split("/")[3]);
    const account = deleteConnectedAccount(runtime, accountId);
    if (!account) {
      sendJson(response, 404, { error: "account_not_found" });
      return true;
    }
    sendJson(response, 200, { ok: true, account });
    return true;
  }

  // POST /connectors/connected-accounts/:accountId/reauth/start
  if (method === "POST" && /^\/connectors\/connected-accounts\/[^/]+\/reauth\/start$/.test(url.pathname)) {
    const accountId = decodeURIComponent(url.pathname.split("/")[3]);
    const account = getAccountById(runtime, accountId);
    if (!account) {
      sendJson(response, 404, { error: "account_not_found" });
      return true;
    }
    const cfg = loadConnectorConfig(runtime, account.provider);
    if (!cfg.clientId) {
      sendJson(response, 400, { error: "missing_client_id", message: "先在设置里填写 Client ID。" });
      return true;
    }
    const result = account.provider === "microsoft"
      ? startMicrosoftAuth(cfg.clientId)
      : startGoogleAuth(cfg.clientId);
    sendJson(response, 200, {
      ...result,
      accountId,
      reauth: true,
      message: "补授权恢复将在 UCA-081 接入；当前会启动同 provider 授权流并刷新账户能力。"
    });
    return true;
  }

  // GET /connectors/accounts — list status for all account connectors
  if (method === "GET" && url.pathname === "/connectors/accounts") {
    const [ms, goog] = await Promise.all([
      getConnectorStatus(runtime, "microsoft"),
      getConnectorStatus(runtime, "google")
    ]);
    sendJson(response, 200, { connectors: [ms, goog] });
    return true;
  }

  // GET /connectors/accounts/:type/config — return non-secret connector config
  if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/config$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    const cfg = loadConnectorConfig(runtime, type);
    sendJson(response, 200, {
      clientId: cfg.clientId ?? "",
      hasClientSecret: Boolean(cfg.clientSecret)
    });
    return true;
  }

  // PATCH /connectors/accounts/:type/config — save client_id / client_secret
  if (method === "PATCH" && /^\/connectors\/accounts\/(microsoft|google)\/config$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    const body = await readJsonBody(request);
    const updates = {};
    if (typeof body.clientId === "string") updates.clientId = body.clientId.trim();
    if (typeof body.clientSecret === "string") updates.clientSecret = body.clientSecret.trim();
    saveConnectorConfig(runtime, type, updates);
    sendJson(response, 200, { ok: true });
    return true;
  }

  // POST /connectors/accounts/:type/auth/start — kick off OAuth flow
  if (method === "POST" && /^\/connectors\/accounts\/(microsoft|google)\/auth\/start$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    const cfg = loadConnectorConfig(runtime, type);
    if (!cfg.clientId) {
      sendJson(response, 400, { error: "missing_client_id", message: "先在设置里填写 Client ID。" });
      return true;
    }
    const result = type === "microsoft"
      ? startMicrosoftAuth(cfg.clientId)
      : startGoogleAuth(cfg.clientId);
    sendJson(response, 200, result);
    return true;
  }

  // DELETE /connectors/accounts/:type — disconnect (revoke stored tokens)
  if (method === "DELETE" && /^\/connectors\/accounts\/(microsoft|google)$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    await disconnectAccount(runtime, type);
    sendJson(response, 200, { ok: true });
    return true;
  }

  // GET /connectors/accounts/:type/files — list files from OneDrive/Google Drive
  if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/files$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    const q = url.searchParams.get("q") ?? "";
    const limit = Math.min(50, Number(url.searchParams.get("limit") ?? 20));
    await sendConnectorReadToolResult(response, ACCOUNT_LIST_FILES_TOOL, {
      provider: type,
      limit,
      query: q
    }, "files", runtime);
    return true;
  }

  // GET /connectors/accounts/:type/emails — list recent emails
  if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/emails$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    const limit = Math.min(20, Number(url.searchParams.get("limit") ?? 10));
    await sendConnectorReadToolResult(response, ACCOUNT_LIST_EMAILS_TOOL, {
      provider: type,
      limit
    }, "emails", runtime);
    return true;
  }

  // GET /connectors/accounts/:provider/messages/:id — fetch one
  // message's full body on demand. Same shape for both Google (MIME
  // walk) and Microsoft (Graph body.content + optional HTML strip),
  // so the Inbox inline-expand UI only needs one fetch helper.
  const msgMatch = url.pathname.match(/^\/connectors\/accounts\/(google|microsoft)\/messages\/([^/]+)$/);
  if (method === "GET" && msgMatch) {
    const provider = msgMatch[1];
    const messageId = decodeURIComponent(msgMatch[2]);
    const accounts = listUserAccounts(runtime).filter((a) => a.provider === provider);
    if (accounts.length === 0) {
      sendJson(response, 404, { error: `no_${provider}_account` });
      return true;
    }
    const fetchMessage = provider === "google" ? getGoogleMessage : getMicrosoftMessage;
    try {
      const result = await fetchMessage(runtime, accounts[0], messageId);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 200, { status: "error", errorCode: error.message });
    }
    return true;
  }

  // GET /connectors/accounts/:type/calendar — list upcoming events
  if (method === "GET" && /^\/connectors\/accounts\/(microsoft|google)\/calendar$/.test(url.pathname)) {
    const type = url.pathname.split("/")[3];
    const limit = Math.min(20, Number(url.searchParams.get("limit") ?? 10));
    await sendConnectorReadToolResult(response, ACCOUNT_LIST_EVENTS_TOOL, {
      provider: type,
      limit
    }, "events", runtime);
    return true;
  }

  // GET /auth/callback — OAuth redirect URI (browser lands here after auth)
  if (method === "GET" && url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error) {
      sendHtml(response, 400,
        `<html><body style="font-family:system-ui;padding:40px;text-align:center">
          <h2>❌ 授权失败</h2><p>${error}: ${url.searchParams.get("error_description") ?? ""}</p>
          <p style="color:#888">请关闭此标签页，回到 UCA。</p>
        </body></html>`
      );
      return true;
    }
    if (!code || !state) {
      sendHtml(response, 400,
        `<html><body style="font-family:system-ui;padding:40px;text-align:center">
          <h2>❌ 无效回调</h2><p>缺少 code 或 state 参数。</p>
        </body></html>`
      );
      return true;
    }
    const result = await completeOAuthCallback(runtime, code, state);
    if (result.ok) {
      sendHtml(response, 200,
        `<html><head><meta charset="utf-8"></head>
        <body style="font-family:system-ui;padding:40px;text-align:center;background:#f5f5f5">
          <div style="max-width:400px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1)">
            <div style="font-size:48px;margin-bottom:16px">✅</div>
            <h2 style="margin:0 0 8px">账户已连接</h2>
            <p style="color:#666;margin:0 0 24px">你的 ${result.type === "microsoft" ? "Microsoft 365" : "Google"} 账户已成功连接到 UCA。</p>
            <p style="color:#888;font-size:13px">可以关闭此标签页了。</p>
          </div>
          <script>setTimeout(()=>window.close(),3000)</script>
        </body></html>`
      );
      return true;
    }
    sendHtml(response, 400,
      `<html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h2>❌ Token 交换失败</h2><p>${result.error}</p>
        <p style="color:#888">请关闭此标签页，在 UCA 里重试。</p>
      </body></html>`
    );
    return true;
  }

  return false;
}
