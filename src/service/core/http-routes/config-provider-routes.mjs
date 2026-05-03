import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { listEmailAccounts, upsertEmailAccount, deleteEmailAccount } from "../../email/accounts.mjs";
import { createImapClient } from "../../email/imap-client.mjs";
import { getCredential } from "../../email/credential-store.mjs";
import { maybeRunMorningDigest } from "../../email/digest.mjs";
import { validateMcpServerDescriptor } from "../../ai/mcp/descriptor-validation.mjs";
import { validateSkillRegistryDescriptor } from "../../ai/skills/registry-validation.mjs";
import { resolveActiveProviderForTask, sanitizeTaskRouteForProvider } from "../../executors/shared/provider-resolver.mjs";
import { sanitizeProviderConfig } from "../../../shared/provider-catalog.mjs";
import { isFeatureEnabled } from "../feature-flags.mjs";
import { readJsonBody, readRawBody, sendJson } from "../http-helpers.mjs";
import { requireDesktopActor } from "../http-route-guards.mjs";
import { saveAutoSkill } from "../skill-pattern-tracker.mjs";

const execFileAsync = promisify(execFile);

function expandLocalPath(value) {
  if (!value) return null;
  return `${value}`
    .replaceAll("%CODEX_HOME%", process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"))
    .replaceAll("%USERPROFILE%", os.homedir())
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

function isPathInside(candidatePath, rootPath) {
  const candidate = path.resolve(candidatePath).toLowerCase();
  const root = path.resolve(rootPath).toLowerCase();
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function resolveSkillEntryPath(runtime, entryPath) {
  if (!entryPath || path.basename(entryPath) !== "SKILL.md") {
    return null;
  }
  const config = runtime.configStore?.load?.() ?? {};
  const roots = [
    runtime.paths?.skillsDir,
    path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "skills"),
    ...(config.ai?.skills?.registries ?? []).map((registry) => expandLocalPath(registry.rootPath ?? registry.path))
  ].filter(Boolean);
  const resolved = path.resolve(entryPath);
  return roots.some((root) => isPathInside(resolved, root)) ? resolved : null;
}

function upsertById(list = [], entry) {
  const index = list.findIndex((item) => item.id === entry.id);
  return index >= 0
    ? list.map((item, itemIndex) => itemIndex === index ? entry : item)
    : [...list, entry];
}

function saveRuntimeConfig(runtime, updater) {
  const currentConfig = runtime.configStore?.load?.() ?? {};
  const nextConfig = updater(currentConfig);
  runtime.configStore?.save?.(nextConfig);
  return nextConfig;
}

function sanitizeTaskRouting(taskRouting = {}, providers = []) {
  const providerById = new Map((providers ?? []).map((provider) => [provider.id, provider]));
  const next = {};
  for (const [taskType, route] of Object.entries(taskRouting ?? {})) {
    const provider = route?.providerId ? providerById.get(route.providerId) : null;
    next[taskType] = sanitizeTaskRouteForProvider(provider, route, taskType) ?? route;
  }
  return next;
}

function sanitizeProviderState(ai = {}) {
  const customProviders = (ai.customProviders ?? []).map((provider) => sanitizeProviderConfig(provider));
  const taskRouting = sanitizeTaskRouting(ai.taskRouting ?? {}, customProviders);
  return { customProviders, taskRouting };
}

const KNOWN_CODE_CLIS = [
  { name: "Kimi Code CLI", binNames: ["kimi.exe", "kimi"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Claude Code", binNames: ["claude.exe", "claude"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Codex CLI", binNames: ["codex.exe", "codex"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Gemini CLI", binNames: ["gemini.exe", "gemini"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Aider", binNames: ["aider.exe", "aider"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "OpenCode", binNames: ["opencode.exe", "opencode"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Cursor Agent", binNames: ["cursor-agent.exe", "cursor-agent"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Qwen Code", binNames: ["qwen.exe", "qwen"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "iFlow CLI", binNames: ["iflow.exe", "iflow"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "CodeBuddy", binNames: ["codebuddy.exe", "codebuddy"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Goose", binNames: ["goose.exe", "goose"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Augment Code", binNames: ["auggie.exe", "auggie"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Factory Droid", binNames: ["droid.exe", "droid"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "GitHub Copilot", binNames: ["copilot.exe", "copilot"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Qoder CLI", binNames: ["qodercli.exe", "qodercli"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Mistral Vibe", binNames: ["vibe-acp.exe", "vibe-acp", "vibe.exe", "vibe"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Kiro", binNames: ["kiro-cli.exe", "kiro-cli"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Hermes Agent", binNames: ["hermes.exe", "hermes"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" },
  { name: "Snow CLI", binNames: ["snow.exe", "snow"], args: [], transport: "stream_json_print", defaultModel: "", versionFlag: "--version" }
];

async function findExecutableOnPath(binName) {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  try {
    const { stdout } = await execFileAsync(lookup, [binName], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
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

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
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
      } catch { /* version probe failed; still report the CLI */ }

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

export async function tryHandleConfigProviderRoute({ request, response, method, url, runtime, providerModelDiscovery }) {
  if (method === "GET" && url.pathname === "/config") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, { config });
    return true;
  }

  if (method === "GET" && url.pathname === "/config/detect-clis") {
    const detected = await detectInstalledCodeClis();
    sendJson(response, 200, { clis: detected });
    return true;
  }

  if (method === "GET" && url.pathname === "/config/providers") {
    const config = runtime.configStore?.load?.() ?? {};
    const sanitized = sanitizeProviderState(config.ai ?? {});
    const providers = sanitized.customProviders;
    if (JSON.stringify(sanitized) !== JSON.stringify({
      customProviders: config.ai?.customProviders ?? [],
      taskRouting: config.ai?.taskRouting ?? {}
    })) {
      runtime.configStore?.patch?.({ ai: sanitized });
    }
    sendJson(response, 200, {
      providers,
      taskRouting: sanitized.taskRouting
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/config/provider-model-options") {
    const config = runtime.configStore?.load?.() ?? {};
    const providers = sanitizeProviderState(config.ai ?? {}).customProviders;
    const providerId = url.searchParams.get("providerId");
    const forceRefresh = ["1", "true", "yes"].includes(`${url.searchParams.get("refresh") ?? ""}`.toLowerCase());
    const selected = providerId
      ? providers.filter((provider) => provider.id === providerId)
      : providers;
    const resolved = await Promise.all(selected.map(async (provider) => ([
      provider.id,
      await providerModelDiscovery.getProviderModelOptions(provider, {
        forceRefresh
      })
    ])));
    const options = Object.fromEntries(resolved);
    sendJson(response, 200, {
      providerId: providerId ?? null,
      refreshed: forceRefresh,
      options,
      option: providerId ? options[providerId] ?? null : null
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/providers") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    if (!body.id || !body.kind) {
      sendJson(response, 400, { error: "id and kind required" });
      return true;
    }
    const config = runtime.configStore?.load?.() ?? {};
    const currentState = sanitizeProviderState(config.ai ?? {});
    const list = currentState.customProviders;
    const idx = list.findIndex((provider) => provider.id === body.id);
    let entry = {
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
    entry = sanitizeProviderConfig(entry);
    const currentConfig = runtime.configStore?.load?.() ?? {};
    const nextList = idx >= 0 ? list.map((provider, index) => index === idx ? entry : provider) : [...list, entry];
    const sanitizedAi = sanitizeProviderState({
      ...(currentConfig.ai ?? {}),
      customProviders: nextList,
      taskRouting: currentState.taskRouting
    });
    runtime.configStore?.save?.({
      ...currentConfig,
      ai: {
        ...(currentConfig.ai ?? {}),
        customProviders: sanitizedAi.customProviders,
        taskRouting: sanitizedAi.taskRouting
      }
    });
    providerModelDiscovery.invalidate(entry);
    sendJson(response, 200, { ok: true, provider: entry });
    return true;
  }

  if (method === "DELETE" && url.pathname.startsWith("/config/providers/")) {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const id = decodeURIComponent(url.pathname.replace(/^\/config\/providers\//, ""));
    const config = runtime.configStore?.load?.() ?? {};
    const currentState = sanitizeProviderState(config.ai ?? {});
    const nextList = currentState.customProviders.filter((provider) => provider.id !== id);
    runtime.configStore?.patch?.({ ai: sanitizeProviderState({ ...currentState, customProviders: nextList }) });
    providerModelDiscovery.invalidate({ id });
    sendJson(response, 200, { ok: true, deleted: id });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/routing") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    const config = runtime.configStore?.load?.() ?? {};
    const currentState = sanitizeProviderState(config.ai ?? {});
    const sanitized = sanitizeTaskRouting(body, currentState.customProviders);
    runtime.configStore?.patch?.({ ai: { customProviders: currentState.customProviders, taskRouting: sanitized } });
    sendJson(response, 200, { ok: true, taskRouting: sanitized });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/output") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    runtime.configStore?.patch?.({ output: { defaultDir: body.defaultDir ?? "", autoCreateDirs: body.autoCreateDirs !== false } });
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/features") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    const patch = { features: body };
    if (Object.prototype.hasOwnProperty.call(body ?? {}, "morning_digest")
        && typeof body.morning_digest?.enabled === "boolean") {
      patch.email = { digest: { enabled: body.morning_digest.enabled } };
    }
    runtime.configStore?.patch?.(patch);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (method === "GET" && url.pathname === "/config/integrations") {
    const config = runtime.configStore?.load?.() ?? {};
    sendJson(response, 200, {
      paths: runtime.platform.integrationPaths ?? {},
      mcp: config.ai?.mcp ?? { servers: [] },
      skills: config.ai?.skills ?? { registries: [] },
      codeCli: {
        ...(config.ai?.codeCli ?? {}),
        adapters: config.ai?.codeCli?.adapters ?? []
      },
      email: config.email ?? { accounts: [] }
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/config/email/accounts") {
    sendJson(response, 200, {
      accounts: listEmailAccounts(runtime)
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/config/email/settings") {
    const config = runtime.configStore?.load?.() ?? {};
    const featureEnabled = isFeatureEnabled("morning_digest", runtime.configStore);
    sendJson(response, 200, {
      settings: {
        ...(config.email?.digest ?? {}),
        enabled: featureEnabled && config.email?.digest?.enabled !== false
      }
    });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/email/accounts") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    if (!body.id || !body.email) {
      sendJson(response, 400, { error: "id and email required" });
      return true;
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
    sendJson(response, 200, { ok: true, account });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/email/settings") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
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
    if (typeof body.enabled === "boolean") {
      nextConfig.features = {
        ...(config.features ?? {}),
        morning_digest: {
          ...(config.features?.morning_digest ?? {}),
          enabled: body.enabled
        }
      };
    }
    runtime.configStore?.save?.(nextConfig);
    sendJson(response, 200, { ok: true, settings: nextConfig.email.digest });
    return true;
  }

  if (method === "DELETE" && url.pathname.startsWith("/config/email/accounts/")) {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const id = decodeURIComponent(url.pathname.replace(/^\/config\/email\/accounts\//, ""));
    const removed = await deleteEmailAccount(runtime, id);
    sendJson(response, 200, { ok: true, deleted: id, account: removed });
    return true;
  }

  if (method === "GET" && /^\/config\/email\/accounts\/[^/]+\/messages$/.test(url.pathname)) {
    const accountId = decodeURIComponent(url.pathname.split("/")[4]);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 30)));
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const account = listEmailAccounts(runtime).find((item) => item.id === accountId);
    if (!account) {
      sendJson(response, 404, { error: "account_not_found" });
      return true;
    }
    if (!runtime._imapPreviewCache) runtime._imapPreviewCache = new Map();
    const cacheKey = `${accountId}:${limit}`;
    const now = Date.now();
    const cached = runtime._imapPreviewCache.get(cacheKey);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      sendJson(response, 200, { messages: cached.messages, cached: true });
      return true;
    }
    try {
      const credentials = await getCredential(runtime, account.credentialRef ?? account.id);
      if (!credentials) {
        sendJson(response, 200, { messages: [], reason: "credentials_missing" });
        return true;
      }
      const client = createImapClient({ account, credentials, state: { seenByAccount: new Map() } });
      const messages = await client.listRecent(limit);
      runtime._imapPreviewCache.set(cacheKey, { messages, expiresAt: now + 10_000 });
      sendJson(response, 200, { messages });
    } catch (error) {
      sendJson(response, 200, { messages: [], reason: error.message });
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/email/digest/check") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console", "desktop_shell"] })) return true;
    const rawBody = await readRawBody(request);
    let body = {};
    const rawText = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : `${rawBody ?? ""}`;
    if (rawText.trim()) {
      try {
        body = JSON.parse(rawText);
      } catch {
        sendJson(response, 400, { error: "invalid_json" });
        return true;
      }
    }
    const result = await maybeRunMorningDigest({
      runtime,
      force: body.force === true
    });
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/skills/save") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console", "desktop_overlay"] })) return true;
    const body = await readJsonBody(request);
    const skillsDir = runtime.paths?.skillsDir ?? null;
    const skillPatternsPath = runtime.paths?.skillPatternsPath ?? null;
    if (!skillsDir) {
      sendJson(response, 400, { error: "skillsDir not configured" });
      return true;
    }
    const { patternKey, tools, examples, suggestedId, suggestedName } = body;
    if (!patternKey || !Array.isArray(tools)) {
      sendJson(response, 400, { error: "patternKey and tools required" });
      return true;
    }
    const saved = saveAutoSkill(skillPatternsPath, skillsDir, {
      patternKey,
      tools,
      examples: examples ?? [],
      suggestedId,
      suggestedName
    });
    sendJson(response, 200, { ok: true, ...saved });
    return true;
  }

  if (method === "GET" && url.pathname === "/skills/read") {
    const entryPath = resolveSkillEntryPath(runtime, url.searchParams.get("entryPath"));
    if (!entryPath) {
      sendJson(response, 403, { error: "skill_path_not_allowed" });
      return true;
    }
    const markdown = await readFile(entryPath, "utf8");
    sendJson(response, 200, { entryPath, markdown });
    return true;
  }

  if (method === "POST" && url.pathname === "/skills/write") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    const entryPath = resolveSkillEntryPath(runtime, body.entryPath);
    if (!entryPath) {
      sendJson(response, 403, { error: "skill_path_not_allowed" });
      return true;
    }
    await writeFile(entryPath, `${body.markdown ?? ""}`, "utf8");
    sendJson(response, 200, { ok: true, entryPath });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/mcp/test") {
    const body = await readJsonBody(request);
    const result = validateMcpServerDescriptor(body);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/config/mcp/servers") {
    if (!requireDesktopActor({ request, response })) {
      return true;
    }
    const body = await readJsonBody(request);
    const result = validateMcpServerDescriptor(body);
    if (!result.ok) {
      sendJson(response, 400, { error: "mcp_server_invalid", errors: result.errors });
      return true;
    }
    const entry = result.server;
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
    sendJson(response, 200, { ok: true, server: entry });
    return true;
  }

  if (method === "DELETE" && url.pathname.startsWith("/config/mcp/servers/")) {
    if (!requireDesktopActor({ request, response })) {
      return true;
    }
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
    sendJson(response, 200, { ok: true, deleted: id });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/skills/test") {
    const body = await readJsonBody(request);
    const result = validateSkillRegistryDescriptor(body);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/config/skills/registries") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    if (!body.id || !body.rootPath) {
      sendJson(response, 400, { error: "id and rootPath required" });
      return true;
    }
    const result = validateSkillRegistryDescriptor(body);
    if (!result.ok) {
      sendJson(response, 400, { error: "skill_registry_invalid", errors: result.errors });
      return true;
    }
    const entry = result.registry;
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
    sendJson(response, 200, { ok: true, registry: entry });
    return true;
  }

  if (method === "DELETE" && url.pathname.startsWith("/config/skills/registries/")) {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
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
    sendJson(response, 200, { ok: true, deleted: id });
    return true;
  }

  if (method === "POST" && url.pathname === "/config/code-cli/adapters") {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
    const body = await readJsonBody(request);
    if (!body.id || !(body.command ?? body.executable)) {
      sendJson(response, 400, { error: "id and command required" });
      return true;
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
    sendJson(response, 200, { ok: true, adapter: entry });
    return true;
  }

  if (method === "DELETE" && url.pathname.startsWith("/config/code-cli/adapters/")) {
    if (!requireDesktopActor({ request, response, allowedActors: ["desktop_console"] })) return true;
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
    sendJson(response, 200, { ok: true, deleted: id });
    return true;
  }

  if (method === "GET" && url.pathname === "/ai/active-provider-for-task") {
    const taskType = url.searchParams.get("type") || "chat";
    const active = resolveActiveProviderForTask(taskType, runtime.kimiRuntime);
    sendJson(response, 200, {
      task_type: taskType,
      descriptor: active.descriptor,
      runtime_source: active.runtime ? "code_cli_subprocess" : (active.descriptor ? "api_provider" : "none")
    });
    return true;
  }

  return false;
}
