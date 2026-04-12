import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";
import { promisify } from "node:util";
import { createTaskEventStream, encodeSseFrame } from "../events/sse.mjs";
import { retryTask } from "../retry/retry-manager.mjs";
import { cancelTask } from "./task-runtime.mjs";
import { tryFastPath } from "./router/fast-path-router.mjs";
import { submitActionToolTask } from "./action-tool-submission.mjs";
import { submitBrowserTask } from "./browser-submission.mjs";
import { submitContextTask } from "./context-submission.mjs";
import { submitFileTask } from "./file-submission.mjs";
import { submitImageTask } from "./image-submission.mjs";
import { submitOfficeTask } from "./office-submission.mjs";
import { listEmailAccounts, upsertEmailAccount, deleteEmailAccount } from "../email/accounts.mjs";
import { maybeRunMorningDigest } from "../email/digest.mjs";
import { normalizeTemplateDocument } from "../templates/parser.mjs";
import { validateTemplateDocument } from "../templates/schema.mjs";
import { resumeDagGraph, validateDagDefinition } from "../dag/scheduler.mjs";

const execFileAsync = promisify(execFile);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function writeOverlayHandoff(body) {
  const handoffDir = path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");
  await mkdir(handoffDir, { recursive: true });
  const handoffPath = path.join(handoffDir, `prompt-handoff-${crypto.randomUUID().replaceAll("-", "")}.json`);
  const payload = {
    schema_version: "1.0",
    targetWindow: "overlay",
    source_app: body.capture?.browser ?? body.source_app ?? "chrome.exe",
    capture_mode: body.captureMode ?? body.capture_mode ?? "browser_extension",
    userCommand: body.userCommand ?? "请处理当前网页上下文",
    capture: body.capture ?? null,
    // Optional: prior turn from an inline-result frame, so the overlay can
    // render the previous Q + A as conversation history and the user can
    // immediately type a follow-up.
    priorResult: body.priorResult ?? null,
    priorUserCommand: body.priorUserCommand ?? null,
    captured_at: new Date().toISOString()
  };
  await writeFile(handoffPath, `${JSON.stringify(payload)}\n`, "utf8");
  return {
    accepted: true,
    delivery: "overlay",
    handoffPath
  };
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
    user_command: task.user_command,
    parent_task_id: task.parent_task_id ?? null,
    child_index: task.child_index ?? null,
    child_count: Array.isArray(task.child_task_ids) ? task.child_task_ids.length : 0
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

  // UCA-066: Fast-path for deterministic Tier 0/1 actions.
  // Pure "open app / open URL / copy to clipboard / translate" bypass the
  // full LLM pipeline entirely and run in < 200ms.
  // Compound actions ("open X, then do Y") intentionally fall through to the
  // normal pipeline so llmPlanner can handle both steps in one tool loop.
  const contextPacket = body.contextPacket ?? { text: body.text ?? "" };
  const fastPath = tryFastPath(userCommand, contextPacket);
  if (fastPath?.tier === 0) {
    return submitActionToolTask({
      userCommand,
      executionMode: body.executionMode ?? "interactive",
      sourceApp: body.sourceApp ?? "uca.http",
      captureMode: body.captureMode ?? "fast_path",
      runtime,
      fastPathTool: fastPath.tool,
      fastPathArgs: fastPath.args
    });
  }
  // Tier 1 (translation) — handled by specialised executor (future: translation_fast)
  // For now fall through to normal pipeline which will route to translate executor.

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

async function resumeDagExecution(runtime, executionId) {
  return resumeDagGraph({
    checkpointStore: runtime.platform.dagCheckpointStore,
    executionId,
    async executeNode(node, context) {
      return {
        nodeId: node.id,
        target: node.target ?? node.executor ?? null,
        resumed: true,
        previousCount: Object.keys(context.results ?? {}).length
      };
    }
  });
}

function normalizeScheduleTriggerRequest(trigger = {}) {
  if (trigger.type === "cron") {
    return {
      type: "cron",
      expression: trigger.expression ?? trigger.cron ?? "0 9 * * *",
      timezone: trigger.timezone ?? "Asia/Shanghai"
    };
  }

  if (trigger.type === "interval") {
    return {
      type: "interval",
      seconds: Number(trigger.seconds ?? 60)
    };
  }

  if (trigger.type === "at") {
    const runAt = new Date(trigger.run_at ?? trigger.at ?? "");
    if (Number.isNaN(runAt.getTime())) {
      throw new Error("At schedule trigger requires a valid run_at timestamp.");
    }
    return {
      type: "at",
      run_at: runAt.toISOString(),
      timezone: trigger.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC"
    };
  }

  return trigger;
}

function buildScheduleActionRequest(body = {}) {
  if (body.action?.type && body.action?.target) {
    return body.action;
  }

  const message = body.message ?? body.userCommand ?? body.command ?? "时间到了";
  return {
    type: "action_tool",
    target: "notify",
    params: {
      title: body.title ?? body.name ?? "UCA 提醒",
      body: message
    }
  };
}

function upsertById(list = [], entry) {
  const index = list.findIndex((item) => item.id === entry.id);
  return index >= 0
    ? list.map((item, itemIndex) => itemIndex === index ? entry : item)
    : [...list, entry];
}

const DEFAULT_PROJECT_ID = "proj_default";
const DEFAULT_PROJECT_COLOR = "#6366f1";

function buildDefaultProjectStore() {
  return {
    currentProjectId: DEFAULT_PROJECT_ID,
    currentConversationId: null,
    projects: [{
      id: DEFAULT_PROJECT_ID,
      name: "默认",
      color: DEFAULT_PROJECT_COLOR,
      createdAt: Date.now(),
      metadata: {}
    }],
    conversations: []
  };
}

function normalizeProjectStore(store) {
  const next = store && typeof store === "object" ? structuredClone(store) : buildDefaultProjectStore();
  next.projects = Array.isArray(next.projects) ? next.projects.filter((project) => project?.id) : [];
  next.conversations = Array.isArray(next.conversations) ? next.conversations.filter((conversation) => conversation?.id) : [];
  if (!next.projects.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    next.projects.unshift({
      id: DEFAULT_PROJECT_ID,
      name: "默认",
      color: DEFAULT_PROJECT_COLOR,
      createdAt: Date.now(),
      metadata: {}
    });
  }
  next.currentProjectId = next.currentProjectId || DEFAULT_PROJECT_ID;
  next.currentConversationId = next.currentConversationId ?? null;
  return next;
}

function saveRuntimeConfig(runtime, updater) {
  const currentConfig = runtime.configStore?.load?.() ?? {};
  const nextConfig = updater(currentConfig);
  runtime.configStore?.save?.(nextConfig);
  return nextConfig;
}

// Known code CLI signatures: name, common executable names, default args, transport
const KNOWN_CODE_CLIS = [
  {
    name: "Kimi Code CLI",
    binNames: ["kimi.exe", "kimi"],
    args: [],
    transport: "stream_json_print",
    defaultModel: "kimi-k2",
    versionFlag: "--version"
  },
  {
    name: "Claude Code",
    binNames: ["claude.exe", "claude"],
    args: [],
    transport: "stream_json_print",
    defaultModel: "claude-sonnet-4-5",
    versionFlag: "--version"
  },
  {
    name: "Codex CLI",
    binNames: ["codex.exe", "codex"],
    args: [],
    transport: "stream_json_print",
    defaultModel: "gpt-4o",
    versionFlag: "--version"
  },
  {
    name: "Gemini CLI",
    binNames: ["gemini.exe", "gemini"],
    args: [],
    transport: "stream_json_print",
    defaultModel: "gemini-2.0-flash",
    versionFlag: "--version"
  },
  {
    name: "Aider",
    binNames: ["aider.exe", "aider"],
    args: [],
    transport: "stream_json_print",
    defaultModel: "",
    versionFlag: "--version"
  }
];

async function findExecutableOnPath(binName) {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(lookup, [binName], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

async function findExecutableInCommonDirs(binName) {
  const home = os.homedir();
  const candidates = process.platform === "win32"
    ? [
        path.join(home, ".local", "bin", binName),
        path.join(home, "AppData", "Local", "Programs", binName.replace(/\.exe$/i, ""), binName),
        path.join(home, "AppData", "Roaming", "npm", binName),
        path.join(home, "scoop", "shims", binName),
        path.join("C:\\Program Files", binName.replace(/\.exe$/i, ""), binName)
      ]
    : [
        path.join(home, ".local", "bin", binName),
        path.join("/usr/local/bin", binName),
        path.join("/opt/homebrew/bin", binName)
      ];

  for (const candidate of candidates) {
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(candidate)) return candidate;
    } catch { /* skip */ }
  }
  return null;
}

async function detectInstalledCodeClis() {
  const found = [];
  for (const cli of KNOWN_CODE_CLIS) {
    let pathFound = null;
    for (const binName of cli.binNames) {
      pathFound = await findExecutableOnPath(binName);
      if (pathFound) break;
      pathFound = await findExecutableInCommonDirs(binName);
      if (pathFound) break;
    }

    if (pathFound) {
      let version = null;
      try {
        const { stdout } = await execFileAsync(pathFound, [cli.versionFlag], {
          encoding: "utf8",
          timeout: 3000,
          windowsHide: true
        });
        version = stdout.trim().split(/\r?\n/)[0] ?? null;
      } catch { /* version probe failed — still report as found */ }

      found.push({
        name: cli.name,
        command: pathFound,
        args: cli.args,
        transport: cli.transport,
        defaultModel: cli.defaultModel,
        version
      });
    }
  }
  return found;
}

async function runOfficeAddinSetup({ statusOnly = false, elevate = false } = {}) {
  const scriptPath = path.join(process.cwd(), "scripts", "setup-office-addins.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ];

  if (statusOnly) {
    args.push("-StatusOnly");
  }
  if (elevate) {
    args.push("-Elevate");
  }

  const { stdout, stderr } = await execFileAsync("powershell.exe", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    timeout: elevate ? 120000 : 30000
  });
  const text = stdout.trim();
  return {
    status: text ? JSON.parse(text) : {},
    stderr: stderr.trim()
  };
}

export function createServiceHttpServer({ runtime, paths, port = 0, host = "127.0.0.1" }) {
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
    const taskEventMatch = url.pathname.match(/^\/task\/([^/]+)\/events$/);
    const taskMatch = url.pathname.match(/^\/task\/([^/]+)$/);
    const cancelMatch = url.pathname.match(/^\/task\/([^/]+)\/cancel$/);
    const retryMatch = url.pathname.match(/^\/task\/([^/]+)\/retry$/);
    const approvalApproveMatch = url.pathname.match(/^\/approvals\/([^/]+)\/approve$/);
    const approvalRejectMatch = url.pathname.match(/^\/approvals\/([^/]+)\/reject$/);
    const scheduleRunsMatch = url.pathname.match(/^\/schedules\/([^/]+)\/runs$/);
    const scheduleMatch = url.pathname.match(/^\/schedules\/([^/]+)$/);
    const templateExportMatch = url.pathname.match(/^\/templates\/([^/]+)\/export$/);
    const templateMatch = url.pathname.match(/^\/templates\/([^/]+)$/);
    const dagExecutionMatch = url.pathname.match(/^\/dag\/executions\/([^/]+)$/);
    const dagResumeMatch = url.pathname.match(/^\/dag\/executions\/([^/]+)\/resume$/);

    // serve office add-in static files
    if (method === "GET" && url.pathname.startsWith("/office/")) {
      const officeAddinDir = path.join(process.cwd(), "office_addin", "shared");
      const fileName = url.pathname.replace(/^\/office\//, "");
      if (fileName && !fileName.includes("..")) {
        try {
          const filePath = path.join(officeAddinDir, fileName);
          const content = await readFile(filePath);
          const ext = path.extname(fileName).toLowerCase();
          const mimeTypes = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
          response.writeHead(200, {
            "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
            "Cache-Control": "no-store, max-age=0"
          });
          response.end(content);
          return;
        } catch { /* file not found — fall through */ }
      }
    }

    try {
      if (method === "GET" && url.pathname === "/config") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, { config });
      }

      if (method === "GET" && url.pathname === "/projects/store") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          store: normalizeProjectStore(config.ui?.projectStore)
        });
      }

      if (method === "POST" && url.pathname === "/projects/store") {
        const body = await readJsonBody(request);
        const store = normalizeProjectStore(body.store ?? body);
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ui: {
            ...(currentConfig.ui ?? {}),
            projectStore: store
          }
        }));
        return sendJson(response, 200, { ok: true, store });
      }

      // Auto-detect installed code CLIs (kimi, claude, codex, gemini, etc.)
      if (method === "GET" && url.pathname === "/config/detect-clis") {
        const detected = await detectInstalledCodeClis();
        return sendJson(response, 200, { clis: detected });
      }

      // List all custom providers
      if (method === "GET" && url.pathname === "/config/providers") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          providers: config.ai?.customProviders ?? [],
          taskRouting: config.ai?.taskRouting ?? {}
        });
      }

      // Create or update a custom provider
      // body: { id, name, kind, baseUrl, apiKey, command, args, transport, defaultModel }
      if (method === "POST" && url.pathname === "/config/providers") {
        const body = await readJsonBody(request);
        if (!body.id || !body.kind) {
          return sendJson(response, 400, { error: "id and kind required" });
        }
        const config = runtime.configStore?.load?.() ?? {};
        const list = config.ai?.customProviders ?? [];
        const idx = list.findIndex((p) => p.id === body.id);
        const entry = {
          id: body.id,
          name: body.name ?? body.id,
          kind: body.kind,
          defaultModel: body.defaultModel ?? ""
        };
        if (body.kind === "code_cli") {
          entry.command = body.command ?? "";
          entry.args = Array.isArray(body.args) ? body.args : [];
          entry.transport = body.transport ?? "stream_json_print";
        } else {
          entry.baseUrl = body.baseUrl ?? "";
          entry.apiKey = body.apiKey ?? "";
        }
        // configStore.patch deep-merges arrays, so we need to replace the whole list
        // by saving customProviders directly
        const currentConfig = runtime.configStore?.load?.() ?? {};
        const nextList = idx >= 0 ? list.map((p, i) => i === idx ? entry : p) : [...list, entry];
        const nextConfig = {
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            customProviders: nextList
          }
        };
        runtime.configStore?.save?.(nextConfig);
        return sendJson(response, 200, { ok: true, provider: entry });
      }

      // Delete a custom provider by id
      if (method === "DELETE" && url.pathname.startsWith("/config/providers/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/providers\//, ""));
        const config = runtime.configStore?.load?.() ?? {};
        const list = config.ai?.customProviders ?? [];
        const nextList = list.filter((p) => p.id !== id);
        runtime.configStore?.patch?.({ ai: { customProviders: nextList } });
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      // Save task routing — which provider+model+mode handles each task type.
      // body: { chat: {providerId, model, mode}, vision: {providerId, model, mode}, file_analysis: {providerId, model, mode} }
      if (method === "POST" && url.pathname === "/config/routing") {
        const body = await readJsonBody(request);
        runtime.configStore?.patch?.({ ai: { taskRouting: body } });
        return sendJson(response, 200, { ok: true, taskRouting: body });
      }

      // UCA-048: save default output path
      if (method === "POST" && url.pathname === "/config/output") {
        const body = await readJsonBody(request);
        runtime.configStore?.patch?.({ output: { defaultDir: body.defaultDir ?? "", autoCreateDirs: body.autoCreateDirs !== false } });
        return sendJson(response, 200, { ok: true });
      }

      // UCA-048: save feature toggles
      // body: { featureId: { enabled: bool }, ... }
      if (method === "POST" && url.pathname === "/config/features") {
        const body = await readJsonBody(request);
        runtime.configStore?.patch?.({ features: body });
        return sendJson(response, 200, { ok: true });
      }

      if (method === "GET" && url.pathname === "/config/integrations") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          paths: runtime.platform.integrationPaths ?? {},
          mcp: config.ai?.mcp ?? { servers: [] },
          skills: config.ai?.skills ?? { registries: [] },
          codeCli: {
            ...(config.ai?.codeCli ?? {}),
            adapters: config.ai?.codeCli?.adapters ?? []
          },
          email: config.email ?? { accounts: [] }
        });
      }

      if (method === "GET" && url.pathname === "/config/email/accounts") {
        return sendJson(response, 200, {
          accounts: listEmailAccounts(runtime)
        });
      }

      if (method === "GET" && url.pathname === "/config/email/settings") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          settings: config.email?.digest ?? {}
        });
      }

      if (method === "POST" && url.pathname === "/config/email/accounts") {
        const body = await readJsonBody(request);
        if (!body.id || !body.email) {
          return sendJson(response, 400, { error: "id and email required" });
        }
        const account = await upsertEmailAccount(runtime, {
          id: body.id,
          provider: body.provider ?? "imap",
          displayName: body.displayName ?? body.email,
          email: body.email,
          authType: body.authType ?? "password",
          imapHost: body.imapHost ?? "",
          imapPort: body.imapPort ?? 993,
          enabled: body.enabled !== false
        }, body.credentials ?? null);
        return sendJson(response, 200, { ok: true, account });
      }

      if (method === "POST" && url.pathname === "/config/email/settings") {
        const body = await readJsonBody(request);
        const config = runtime.configStore?.load?.() ?? {};
        const nextConfig = {
          ...config,
          email: {
            ...(config.email ?? {}),
            digest: {
              ...(config.email?.digest ?? {}),
              ...body
            }
          }
        };
        runtime.configStore?.save?.(nextConfig);
        return sendJson(response, 200, { ok: true, settings: nextConfig.email.digest });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/email/accounts/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/email\/accounts\//, ""));
        const removed = await deleteEmailAccount(runtime, id);
        return sendJson(response, 200, { ok: true, deleted: id, account: removed });
      }

      if (method === "POST" && url.pathname === "/email/digest/check") {
        const result = await maybeRunMorningDigest({ runtime });
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/config/mcp/servers") {
        const body = await readJsonBody(request);
        if (!body.id) {
          return sendJson(response, 400, { error: "id required" });
        }
        const entry = {
          id: body.id,
          displayName: body.displayName ?? body.name ?? body.id,
          transport: body.transport ?? "stdio",
          command: body.command ?? null,
          args: Array.isArray(body.args) ? body.args : [],
          url: body.url ?? null,
          env: body.env ?? null,
          enabled: body.enabled !== false
        };
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            mcp: {
              ...(currentConfig.ai?.mcp ?? {}),
              servers: upsertById(currentConfig.ai?.mcp?.servers ?? [], entry)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, server: entry });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/mcp/servers/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/mcp\/servers\//, ""));
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            mcp: {
              ...(currentConfig.ai?.mcp ?? {}),
              servers: (currentConfig.ai?.mcp?.servers ?? []).filter((server) => server.id !== id)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      if (method === "POST" && url.pathname === "/config/skills/registries") {
        const body = await readJsonBody(request);
        if (!body.id || !(body.rootPath ?? body.path)) {
          return sendJson(response, 400, { error: "id and rootPath required" });
        }
        const entry = {
          id: body.id,
          displayName: body.displayName ?? body.name ?? body.id,
          rootPath: body.rootPath ?? body.path,
          enabled: body.enabled !== false
        };
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            skills: {
              ...(currentConfig.ai?.skills ?? {}),
              registries: upsertById(currentConfig.ai?.skills?.registries ?? [], entry)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, registry: entry });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/skills/registries/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/skills\/registries\//, ""));
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            skills: {
              ...(currentConfig.ai?.skills ?? {}),
              registries: (currentConfig.ai?.skills?.registries ?? []).filter((registry) => registry.id !== id)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      if (method === "POST" && url.pathname === "/config/code-cli/adapters") {
        const body = await readJsonBody(request);
        if (!body.id || !(body.command ?? body.executable)) {
          return sendJson(response, 400, { error: "id and command required" });
        }
        const entry = {
          id: body.id,
          displayName: body.displayName ?? body.name ?? body.id,
          command: body.command ?? body.executable,
          args: Array.isArray(body.args) ? body.args : [],
          transport: body.transport ?? "stream_json_print",
          defaultModel: body.defaultModel ?? body.model ?? "",
          configFile: body.configFile ?? null,
          mcpConfigFiles: Array.isArray(body.mcpConfigFiles) ? body.mcpConfigFiles : [],
          supportsCheckpointResume: Boolean(body.supportsCheckpointResume)
        };
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            codeCli: {
              ...(currentConfig.ai?.codeCli ?? {}),
              adapters: upsertById(currentConfig.ai?.codeCli?.adapters ?? [], entry)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, adapter: entry });
      }

      if (method === "DELETE" && url.pathname.startsWith("/config/code-cli/adapters/")) {
        const id = decodeURIComponent(url.pathname.replace(/^\/config\/code-cli\/adapters\//, ""));
        saveRuntimeConfig(runtime, (currentConfig) => ({
          ...currentConfig,
          ai: {
            ...(currentConfig.ai ?? {}),
            codeCli: {
              ...(currentConfig.ai?.codeCli ?? {}),
              adapters: (currentConfig.ai?.codeCli?.adapters ?? []).filter((adapter) => adapter.id !== id)
            }
          }
        }));
        return sendJson(response, 200, { ok: true, deleted: id });
      }

      // Diagnostic: which provider will the next task of the given type hit?
      // Used by Console / Overlay UI so users can verify their routing config
      // is actually in effect, and by scripts/verify-provider-routing.mjs.
      if (method === "GET" && url.pathname === "/ai/active-provider-for-task") {
        const taskType = url.searchParams.get("type") || "chat";
        const { resolveActiveProviderForTask } = await import("../executors/shared/provider-resolver.mjs");
        const active = resolveActiveProviderForTask(taskType, runtime.kimiRuntime);
        return sendJson(response, 200, {
          task_type: taskType,
          descriptor: active.descriptor,
          runtime_source: active.runtime ? "code_cli_subprocess" : (active.descriptor ? "api_provider" : "none")
        });
      }

      if (method === "GET" && url.pathname === "/health") {
        const config = runtime.configStore?.load?.() ?? {};
        return sendJson(response, 200, {
          ok: true,
          runtime_dir: paths.baseDir,
          db_path: paths.dbPath,
          task_total: runtime.store.listTasks().length,
          kimi: runtime.kimiRuntimeStatus ?? null,
          email: runtime.emailMonitor?.status?.() ?? null,
          config: {
            output: config.output ?? {},
            features: config.features ?? {}
          },
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

      if (method === "POST" && url.pathname === "/overlay/handoff") {
        const body = await readJsonBody(request);
        const result = await writeOverlayHandoff(body);
        return sendJson(response, 200, result);
      }

      if (method === "GET" && url.pathname === "/setup/office-addins/status") {
        const result = await runOfficeAddinSetup({ statusOnly: true });
        return sendJson(response, 200, result.status);
      }

      if (method === "POST" && url.pathname === "/setup/office-addins") {
        const body = await readJsonBody(request);
        const result = await runOfficeAddinSetup({
          elevate: body.elevate !== false
        });
        return sendJson(response, 200, result.status);
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

      if (taskMatch && method === "DELETE") {
        const taskId = taskMatch[1];
        const task = runtime.store.getTask(taskId);
        if (!task) {
          return sendJson(response, 404, { error: "task_not_found" });
        }
        runtime.store.deleteTask(taskId);
        return sendJson(response, 200, { deleted: true, task_id: taskId });
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

      if (method === "POST" && url.pathname === "/schedules") {
        const body = await readJsonBody(request);
        try {
          const trigger = body.trigger?.natural_language
            ? body.trigger
            : normalizeScheduleTriggerRequest(body.trigger ?? {
              type: "cron",
              expression: body.cron ?? "0 9 * * *"
            });
          const action = buildScheduleActionRequest(body);
          const schedule = runtime.scheduler.createSchedule({
            name: body.name ?? "Unnamed schedule",
            description: body.description ?? "",
            trigger,
            action,
            executionMode: body.executionMode ?? "unattended_safe",
            catchupPolicy: body.catchupPolicy ?? body.catchup_policy ?? "skip",
            enabled: body.enabled !== false,
            metadata: {
              ...(body.metadata ?? {}),
              one_shot: Boolean(body.oneShot ?? body.one_shot ?? trigger.oneShot)
            }
          }, { createdBy: body.createdBy ?? "overlay" });
          return sendJson(response, 200, { schedule });
        } catch (error) {
          return sendJson(response, 400, { error: error.message });
        }
      }

      if (scheduleMatch && method === "DELETE") {
        const deleted = runtime.scheduler.deleteSchedule(scheduleMatch[1]);
        if (!deleted) {
          return sendJson(response, 404, { error: "schedule_not_found" });
        }
        return sendJson(response, 200, { deleted });
      }

      if (scheduleMatch && method === "PATCH") {
        const body = await readJsonBody(request);
        const schedule = runtime.scheduler.pauseSchedule(scheduleMatch[1], body.enabled !== false);
        if (!schedule) {
          return sendJson(response, 404, { error: "schedule_not_found" });
        }
        return sendJson(response, 200, { schedule });
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

      if (method === "POST" && url.pathname === "/templates") {
        const body = await readJsonBody(request);
        const result = runtime.platform.templateRegistry.save(body.template ?? body, {
          actor: body.actor ?? "console"
        });
        if (!result.ok) {
          return sendJson(response, 400, result);
        }
        return sendJson(response, 200, result);
      }

      if (method === "POST" && url.pathname === "/templates/import") {
        const body = await readJsonBody(request);
        const result = runtime.platform.templateRegistry.import(body.template ?? body.raw ?? body, {
          actor: body.actor ?? "console_import"
        });
        if (!result.ok) {
          return sendJson(response, 400, result);
        }
        return sendJson(response, 200, result);
      }

      if (templateExportMatch && method === "GET") {
        const templateId = decodeURIComponent(templateExportMatch[1]);
        const raw = runtime.platform.templateRegistry.export(templateId);
        if (!raw) {
          return sendJson(response, 404, { error: "template_not_found" });
        }
        return sendJson(response, 200, {
          template_id: templateId,
          raw
        });
      }

      if (templateMatch && method === "GET") {
        const templateId = decodeURIComponent(templateMatch[1]);
        const template = runtime.platform.templateRegistry.get(templateId);
        if (!template) {
          return sendJson(response, 404, { error: "template_not_found" });
        }
        return sendJson(response, 200, { template });
      }

      if (templateMatch && method === "DELETE") {
        const templateId = decodeURIComponent(templateMatch[1]);
        const removed = runtime.platform.templateRegistry.remove(templateId);
        if (!removed) {
          return sendJson(response, 404, { error: "template_not_found_or_builtin" });
        }
        return sendJson(response, 200, {
          removed
        });
      }

      if (method === "POST" && url.pathname === "/templates/validate") {
        const body = await readJsonBody(request);
        const template = normalizeTemplateDocument(body.template ?? body);
        return sendJson(response, 200, {
          template,
          validation: validateTemplateDocument(template)
        });
      }

      if (method === "POST" && url.pathname === "/dag/preview") {
        const body = await readJsonBody(request);
        const graph = body.graph ?? body;
        return sendJson(response, 200, {
          graph,
          validation: validateDagDefinition(graph)
        });
      }

      if (method === "GET" && url.pathname === "/dag/executions") {
        return sendJson(response, 200, {
          executions: runtime.platform.dagCheckpointStore.list()
        });
      }

      if (dagExecutionMatch && method === "GET") {
        const executionId = decodeURIComponent(dagExecutionMatch[1]);
        const execution = runtime.platform.dagCheckpointStore.get(executionId);
        if (!execution) {
          return sendJson(response, 404, { error: "dag_execution_not_found" });
        }
        return sendJson(response, 200, { execution });
      }

      if (dagResumeMatch && method === "POST") {
        const executionId = decodeURIComponent(dagResumeMatch[1]);
        const execution = runtime.platform.dagCheckpointStore.get(executionId);
        if (!execution) {
          return sendJson(response, 404, { error: "dag_execution_not_found" });
        }
        const resumed = await resumeDagExecution(runtime, executionId);
        return sendJson(response, 200, {
          execution: resumed
        });
      }

      if (method === "GET" && url.pathname === "/budget") {
        return sendJson(response, 200, {
          budget: runtime.platform.budgetManager.getState()
        });
      }

      if (method === "POST" && url.pathname === "/budget") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, {
          budget: runtime.platform.budgetManager.setLimits(body.limits ?? body)
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
          servers: await runtime.platform.mcpServers.listStatus({
            runtime,
            config: runtime.configStore?.load?.() ?? {}
          })
        });
      }

      if (method === "GET" && url.pathname === "/ai/skills") {
        return sendJson(response, 200, {
          registries: await runtime.platform.skillRegistries.listStatus({
            runtime,
            config: runtime.configStore?.load?.() ?? {}
          }),
          skills: await runtime.platform.skillRegistries.listSkills({
            runtime,
            config: runtime.configStore?.load?.() ?? {}
          })
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
