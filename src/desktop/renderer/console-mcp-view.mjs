import { getMcpSourceView } from "./mcp-source-view.mjs";
import {
  buildMcpConfigFields,
  describeMcpMissingConfig,
  isMcpMissingConfig
} from "./mcp-missing-config.mjs";

export const MCP_SERVER_META = Object.freeze({
  "mcp-filesystem": { title: "Filesystem", desc: "Read and write files in allowed local directories.", logoClass: "fs" },
  "mcp-memory": { title: "Memory", desc: "Persistent graph memory for agentic tasks.", logoClass: "mem" },
  "mcp-brave-search": { title: "Brave Search", desc: "Web search through Brave Search API.", configKey: "BRAVE_API_KEY", configLabel: "Brave API Key", configPlaceholder: "BSA...", logoClass: "brave" },
  "mcp-puppeteer": { title: "Browser Automation", desc: "Puppeteer-powered browser actions for agentic workflows.", logoClass: "browser" },
  "local-fs": { title: "Legacy Local FS", desc: "Deprecated. Use Filesystem instead.", logoClass: "imap" },
  figma: { title: "Figma", desc: "Design context through an external Figma MCP plugin.", guideUrl: "https://www.figma.com/", logoClass: "figma" }
});

export const MCP_LOGO_SVG = Object.freeze({
  fs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"/></svg>`,
  mem: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/><path d="M12 7v5l3 2"/></svg>`,
  brave: "B",
  browser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>`,
  figma: "F",
  github: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12a12 12 0 0 0 8.2 11.38c.6.11.82-.26.82-.58v-2.15C5.66 21.3 5 19 5 19c-.55-1.38-1.33-1.75-1.33-1.75-1.08-.74.08-.72.08-.72 1.2.08 1.84 1.23 1.84 1.23 1.07 1.82 2.8 1.3 3.49.99.1-.77.42-1.3.76-1.6-2.67-.3-5.48-1.33-5.48-5.93 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.81 5.62-5.49 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.82.58A12 12 0 0 0 24 12c0-6.63-5.37-12-12-12Z"/></svg>`,
  slack: "#",
  imap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-10 5L2 7"/></svg>`
});

export const EXTRA_PLUGIN_OPTIONS = Object.freeze([
  { id: "github", title: "GitHub", desc: "Repository issues, pull requests, and code search.", status: "Coming soon", logoClass: "github" },
  { id: "notion", title: "Notion", desc: "Pages, databases, and workspace notes.", status: "Coming soon", logoClass: "mem" },
  { id: "slack", title: "Slack", desc: "Channel messages and team workflow actions.", status: "Coming soon", logoClass: "slack" },
  { id: "gdrive", title: "Google Drive", desc: "Docs and Drive file context.", status: "Coming soon", logoClass: "fs" }
]);

function inferCustomMcpLogo(server = {}) {
  const text = `${server.id ?? ""} ${server.displayName ?? ""} ${server.command ?? ""} ${server.url ?? ""}`.toLowerCase();
  if (text.includes("github")) return "github";
  if (text.includes("slack")) return "slack";
  if (text.includes("figma")) return "figma";
  if (text.includes("browser") || text.includes("puppeteer") || text.includes("playwright")) return "browser";
  if (text.includes("file") || text.includes("filesystem") || text.includes("drive")) return "fs";
  if (text.includes("memory") || text.includes("notion")) return "mem";
  return "imap";
}

function getMcpCardMeta(server = {}) {
  const builtIn = MCP_SERVER_META[server.id];
  if (builtIn) return builtIn;
  const title = server.displayName ?? server.name ?? server.id;
  return {
    title,
    desc: server.description ?? (server.source === "runtime_config" ? "Custom MCP server" : server.id),
    logoClass: inferCustomMcpLogo(server)
  };
}

function getMcpSourceBadge(server = {}) {
  if (server.source === "runtime_config") {
    return {
      label: "Custom",
      tooltip: "User-added MCP server"
    };
  }
  return null;
}

function normalizeMcpKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function hasMatchingServerForExtraOption(option, servers = []) {
  const optionId = normalizeMcpKey(option.id);
  const optionTitle = normalizeMcpKey(option.title);
  return servers.some((server) => {
    const meta = getMcpCardMeta(server);
    const values = [
      server.id,
      server.displayName,
      server.name,
      meta.title
    ].map(normalizeMcpKey).filter(Boolean);
    return values.includes(optionId)
      || values.includes(optionTitle)
      || (optionId.length >= 5 && values.some((value) => value.includes(optionId)));
  });
}

export function getMcpStatusView(server) {
  if (server.detail === "legacy_stub_use_mcp_filesystem") return { label: "已弃用", className: "muted" };
  if (server.detail === "external_plugin_required") return { label: "需插件", className: "muted" };
  if (server.available && server.enabled) return { label: "运行中", className: "ready" };
  if (isMcpMissingConfig(server)) return { label: "需配置", className: "warning" };
  if (server.configured && !server.enabled) return { label: "已保存", className: "muted" };
  if (server.detail === "disabled") return { label: "已关闭", className: "muted" };
  if (!server.available) return { label: "未安装", className: "error" };
  return { label: "已关闭", className: "" };
}

export function renderMcpConfigPanel(server, fields = [], { escapeHtml }) {
  if (!Array.isArray(fields) || fields.length === 0) return "";
  const serverId = `${server?.id ?? ""}`;
  const rows = fields.map((field, index) => {
    const inputId = `mcp-cfg-val-${serverId}-${index}`;
    const label = field.label || field.name || field.envKey || "配置值";
    const placeholder = field.placeholder || "输入配置值";
    return `
        <label for="${escapeHtml(inputId)}" style="font-size:12px;font-weight:500;">${escapeHtml(label)}</label>
        <div class="mcp-cfg-row">
          <input type="password"
                 id="${escapeHtml(inputId)}"
                 placeholder="${escapeHtml(placeholder)}"
                 class="mcp-cfg-input"
                 data-mcp-cfg-input="${escapeHtml(serverId)}"
                 data-mcp-cfg-key="${escapeHtml(field.envKey)}"
                 data-mcp-cfg-type="${escapeHtml(field.type ?? "env")}"
                 data-mcp-cfg-name="${escapeHtml(field.name ?? "")}">
        </div>`;
  }).join("");
  return `
      <div class="mcp-server-config" id="mcp-cfg-${escapeHtml(serverId)}">
        ${rows}
        <div class="mcp-cfg-row">
          <button class="btn btn-sm" data-mcp-cfg-save="${escapeHtml(serverId)}">保存</button>
        </div>
        <div class="mcp-cfg-state" id="mcp-cfg-state-${escapeHtml(serverId)}"></div>
      </div>`;
}

export function renderConnectorsMcpServersHtml(servers = [], { escapeHtml }) {
  const cards = [];
  for (const server of servers ?? []) {
    cards.push(renderConnectorsMcpServerCard(server, { escapeHtml }));
  }
  for (const option of EXTRA_PLUGIN_OPTIONS) {
    if (hasMatchingServerForExtraOption(option, servers)) continue;
    cards.push(renderExtraPluginCard(option, { escapeHtml }));
  }
  return cards.join("");
}

function renderConnectorsMcpServerCard(server, { escapeHtml }) {
  const meta = getMcpCardMeta(server);
  const sourceView = getMcpSourceView(server);
  const sourceBadge = getMcpSourceBadge(server);
  const status = getMcpStatusView(server);
  const statusLabel = sourceView.readOnly ? sourceView.label : status.label;
  const statusClass = sourceView.readOnly ? sourceView.className : status.className;
  const configFields = buildMcpConfigFields(server, meta);
  const hasConfigFields = configFields.length > 0;
  const missingConfig = describeMcpMissingConfig(server);
  const needsConfig = (hasConfigFields && !server.enabled) || missingConfig.missing;
  const customMissingConfig = missingConfig.missing && !hasConfigFields;
  const packageMissing = Boolean(server.installRequired && server.installSource);
  const canInstall = Boolean(server.configured || server.available || (hasConfigFields && needsConfig) || packageMissing);
  const installed = server.available && server.enabled;
  const canDelete = !sourceView.readOnly && server.source === "runtime_config";
  const logoClass = meta.logoClass ?? "imap";
  const logoGlyph = MCP_LOGO_SVG[logoClass] ?? "?";
  const transportLine = server.transport
    ? `${server.transport}${server.command ? ` · ${server.command}` : ""}${server.url ? ` · ${server.url}` : ""}${Array.isArray(server.args) && server.args.length ? " " + server.args.join(" ") : ""}`
    : "";
  const configBtn = hasConfigFields ? `<button class="btn btn-sm btn-ghost" data-mcp-config="${escapeHtml(server.id)}">Configure</button>` : "";
  const testBtn = sourceView.readOnly ? "" : `<button class="btn btn-sm btn-ghost" data-mcp-test="${escapeHtml(server.id)}">Test</button>`;
  const guideBtn = meta.guideUrl ? `<button class="btn btn-sm btn-ghost" data-plugin-guide="${escapeHtml(meta.guideUrl)}">Guide</button>` : "";
  const disableBtn = !sourceView.readOnly && server.enabled
    ? `<button class="btn btn-sm btn-ghost" data-mcp-disable="${escapeHtml(server.id)}">Disconnect</button>`
    : "";
  const deleteBtn = canDelete
    ? `<button class="btn btn-sm btn-danger" data-mcp-delete-card="${escapeHtml(server.id)}">Delete</button>`
    : "";
  const needsConfigLabel = missingConfig.summary ? `需配置 · ${missingConfig.summary}` : "需配置";
  const needsConfigBadge = needsConfig
    ? `<span class="pill pill-warn mcp-needs-config" title="${escapeHtml(needsConfigLabel)}">${escapeHtml(needsConfigLabel)}</span>`
    : "";
  const headlineAction = sourceView.readOnly
    ? `<span class="pill pill-neutral" title="${escapeHtml(sourceView.tooltip)}">${escapeHtml(statusLabel)}</span>`
    : installed
      ? `<label class="toggle" title="断开连接">
           <input type="checkbox" checked data-mcp-install="${escapeHtml(server.id)}" data-mcp-enabled="false">
           <span class="toggle-track"></span>
         </label>`
      : customMissingConfig
        ? `<span class="pill pill-warn" title="${escapeHtml(needsConfigLabel)}">${escapeHtml("需配置")}</span>`
      : packageMissing
        ? `<button class="btn btn-sm btn-primary mcp-install-btn"
                   data-mcp-install-source-click="${escapeHtml(server.installSource)}"
                   title="使用隔离安装流程安装此 MCP 包">
             安装包
           </button>`
      : canInstall
        ? `<button class="btn btn-sm btn-primary mcp-install-btn"
                   data-mcp-install-click="${escapeHtml(server.id)}"
                   title="${needsConfig ? "需要先配置凭据" : "启用此 MCP 服务"}">
             ${needsConfig ? "配置后启用" : "启用"}
           </button>`
      : `<span class="pill pill-neutral" title="${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span>`;
  return `
    <div class="mcp-card mcp-card--v3 ${canInstall ? "" : "unavailable"}" id="mcp-card-${escapeHtml(server.id)}">
      <div class="mcp-card-head">
        <div class="conn-logo ${escapeHtml(logoClass)} mcp-card-logo">${logoGlyph}</div>
        <div class="mcp-card-info">
          <div class="mcp-title-row">
            <div class="mcp-name">${escapeHtml(meta.title ?? server.displayName ?? server.id)}</div>
            ${sourceBadge ? `<span class="pill pill-neutral mcp-source-badge" data-mcp-source-badge="${escapeHtml(server.id)}" title="${escapeHtml(sourceBadge.tooltip)}">${escapeHtml(sourceBadge.label)}</span>` : ""}
          </div>
          <div class="mcp-card-desc">${escapeHtml(meta.desc ?? "")}</div>
        </div>
        <span class="mcp-status-dot ${escapeHtml(statusClass)}" title="${escapeHtml(statusLabel)}"></span>
        ${headlineAction}
      </div>
      ${transportLine ? `<div class="mcp-transport">${escapeHtml(transportLine)}</div>` : ""}
      ${(hasConfigFields || meta.guideUrl || needsConfigBadge || testBtn || disableBtn || deleteBtn) ? `
      <div class="mcp-card-actions">
        ${needsConfigBadge}
        <div style="flex:1;"></div>
        ${testBtn}${disableBtn}${guideBtn}${configBtn}${deleteBtn}
      </div>` : ""}
      ${renderMcpConfigPanel(server, configFields, { escapeHtml })}
    </div>
  `;
}

function renderExtraPluginCard(option, { escapeHtml }) {
  const logoClass = option.logoClass ?? "imap";
  const logoGlyph = MCP_LOGO_SVG[logoClass] ?? "?";
  return `
    <div class="mcp-card mcp-card--v3 unavailable">
      <div class="mcp-card-head">
        <div class="conn-logo ${escapeHtml(logoClass)} mcp-card-logo">${logoGlyph}</div>
        <div class="mcp-card-info">
          <div class="mcp-name">${escapeHtml(option.title)}</div>
          <div class="mcp-card-desc">${escapeHtml(option.desc)}</div>
        </div>
        <span class="pill pill-neutral">${escapeHtml(option.status)}</span>
      </div>
    </div>
  `;
}
