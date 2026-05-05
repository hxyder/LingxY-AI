import { escapeHtml } from "./shared-ui.mjs";

export const ACCOUNT_CONNECTOR_META = Object.freeze({
  microsoft: Object.freeze({
    label: "Microsoft 365",
    logo: "Ⓜ",
    logoClass: "microsoft",
    desc: "OneDrive 文件 · Outlook 邮件 · 日历",
    scopes: "Files.Read、Mail.Read、Calendars.Read",
    setupTitle: "注册 Azure AD 应用（免费）",
    setupSteps: Object.freeze([
      "打开 Azure 门户 → 应用注册 → 新建注册",
      "受支持账户类型选\"任何组织目录中的账户和个人 Microsoft 账户\"",
      "重定向 URI 选 Public client/native，填 http://localhost:4310/auth/callback",
      "注册完成后，将\"应用程序(客户端) ID\"粘贴到下方",
      "Microsoft PKCE 流无需客户端密码"
    ]),
    setupUrl: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    needsSecret: false
  }),
  google: Object.freeze({
    label: "Google",
    logo: "G",
    logoClass: "google",
    desc: "Google Drive 文件 · Gmail · 日历",
    scopes: "drive.readonly、gmail.readonly、calendar.readonly",
    setupTitle: "创建 Google OAuth 应用（免费）",
    setupSteps: Object.freeze([
      "打开 Google Cloud Console → API 和服务 → 凭据",
      "创建凭据 → OAuth 客户端 ID → 类型选\"桌面应用\"",
      "将 http://localhost:4310/auth/callback 加入已授权的重定向 URI",
      "复制客户端 ID 和客户端密码粘贴到下方",
      "在 OAuth 同意屏幕里添加你自己的邮箱为测试用户"
    ]),
    setupUrl: "https://console.cloud.google.com/apis/credentials",
    needsSecret: true
  })
});

export const ACCOUNT_CONNECTOR_CAPABILITY_LABELS = Object.freeze([
  Object.freeze(["emailRead", "邮件读"]),
  Object.freeze(["emailWrite", "邮件写"]),
  Object.freeze(["fileRead", "文件读"]),
  Object.freeze(["fileWrite", "文件写"]),
  Object.freeze(["calendarRead", "日历读"]),
  Object.freeze(["calendarWrite", "日历写"])
]);

const FALLBACK_ACCOUNT_CONNECTOR_META = Object.freeze({
  logo: "●",
  logoClass: ""
});

export function getAccountConnectorMeta(type) {
  const label = type ?? "";
  return ACCOUNT_CONNECTOR_META[type] ?? { ...FALLBACK_ACCOUNT_CONNECTOR_META, label };
}

export function countAvailableAccountConnectors(connectors = []) {
  return connectors.filter((connector) => ACCOUNT_CONNECTOR_META[connector.type]).length;
}

export function renderAccountConnectorSectionLabelHtml(label, zh, count) {
  return `<div class="conn-section-label">${escapeHtml(label)}<span class="zh">${escapeHtml(zh)}</span><span class="count">${escapeHtml(count)}</span></div>`;
}

export function getConnectedAccountCapabilityLabels(account = {}) {
  const caps = account.capabilities ?? {};
  return ACCOUNT_CONNECTOR_CAPABILITY_LABELS
    .filter(([key]) => caps[key])
    .map(([, label]) => label);
}

export function getConnectedAccountDefaults(account = {}) {
  return [
    account.isDefaultForEmail ? "邮箱默认" : null,
    account.isDefaultForFiles ? "文件默认" : null,
    account.isDefaultForCalendar ? "日历默认" : null
  ].filter(Boolean);
}

export function renderConnectedAccountConnectorRowHtml(account = {}) {
  const meta = getAccountConnectorMeta(account.provider);
  const capLabels = getConnectedAccountCapabilityLabels(account);
  const defaults = getConnectedAccountDefaults(account);
  const statusOn = account.tokenStatus === "active";
  const accountId = escapeHtml(account.id);
  return `
    <div class="conn-row">
      <div class="conn-row-logo acc-logo ${escapeHtml(meta.logoClass)}">${escapeHtml(meta.logo)}</div>
      <div class="conn-row-main">
        <div class="conn-row-title">
          ${escapeHtml(account.displayName ?? account.email ?? meta.label)}
          ${defaults.map((label) => `<span class="pill pill-ok">${escapeHtml(label)}</span>`).join("")}
        </div>
        <div class="conn-row-sub">${escapeHtml(meta.label)} · ${escapeHtml(account.email ?? "")}${capLabels.length ? " · " + escapeHtml(capLabels.slice(0, 4).join("/")) : ""}</div>
      </div>
      <span class="conn-row-status">
        <span class="conn-row-status-dot ${statusOn ? "on" : "warn"}" title="${escapeHtml(account.tokenStatus ?? "")}"></span>
        ${statusOn ? "active" : escapeHtml(account.tokenStatus ?? "offline")}
      </span>
      <div class="conn-row-actions">
        <button class="btn btn-sm btn-ghost" data-connected-edit="${accountId}" title="重命名显示名">编辑</button>
        <button class="btn btn-sm btn-ghost" data-connected-reauth="${accountId}">重新授权</button>
        <button class="btn btn-sm btn-danger" data-connected-delete="${accountId}">断开</button>
        <div class="acc-more" data-acc-more-root>
          <button class="icon-btn acc-more-btn" type="button" data-acc-more-toggle aria-label="更多选项" title="更多">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
          <div class="acc-more-menu" hidden>
            <button class="acc-more-item" data-connected-default="${accountId}" data-purpose="email">设为邮箱默认</button>
            <button class="acc-more-item" data-connected-default="${accountId}" data-purpose="files">设为文件默认</button>
            <button class="acc-more-item" data-connected-default="${accountId}" data-purpose="calendar">设为日历默认</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function getAvailableAccountConnectorStatusView(connector = {}) {
  return {
    on: Boolean(connector.connected),
    text: connector.connected
      ? (connector.email ?? "已连接")
      : connector.configured
        ? "未连接"
        : "需要配置 Client ID",
    label: connector.connected ? "connected" : "not connected"
  };
}

export function renderAvailableAccountConnectorHtml(connector = {}, {
  configOpen = false,
  configData = { clientId: "", hasClientSecret: false }
} = {}) {
  const meta = ACCOUNT_CONNECTOR_META[connector.type];
  if (!meta) return "";
  const type = escapeHtml(connector.type);
  const status = getAvailableAccountConnectorStatusView(connector);
  const connectButton = connector.connected
    ? `<button class="btn btn-sm btn-ghost" data-ac-disconnect="${type}">断开</button>`
    : `<button class="btn btn-sm btn-primary" data-ac-connect="${type}" ${connector.configured ? "" : "disabled"}>授权登录</button>`;
  const rowHtml = `
    <div class="conn-row" data-ac-type="${type}">
      <div class="conn-row-logo acc-logo ${escapeHtml(meta.logoClass)}">${escapeHtml(meta.logo)}</div>
      <div class="conn-row-main">
        <div class="conn-row-title">${escapeHtml(meta.label)}</div>
        <div class="conn-row-sub">${connector.connected ? escapeHtml(status.text) : escapeHtml(meta.desc)}</div>
      </div>
      <span class="conn-row-status">
        <span class="conn-row-status-dot ${status.on ? "on" : ""}" title="${escapeHtml(status.text)}"></span>
        ${escapeHtml(status.label)}
      </span>
      <div class="conn-row-actions">
        ${connectButton}
        <button class="btn btn-sm btn-ghost" data-ac-config-toggle="${type}">${configOpen ? "收起" : "配置"}</button>
      </div>
    </div>
  `;
  if (!configOpen) return rowHtml;
  return `${rowHtml}${renderAccountConnectorConfigPanelHtml(connector.type, configData)}`;
}

export function renderAccountConnectorConfigPanelHtml(type, cfgData = {}) {
  const meta = ACCOUNT_CONNECTOR_META[type];
  if (!meta) return "";
  const safeType = escapeHtml(type);
  const clientId = cfgData.clientId ?? "";
  const secretPlaceholder = cfgData.hasClientSecret ? "（已保存）" : "粘贴 Client Secret…";
  return `
    <div class="acc-config-panel" style="padding:12px 14px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--radius-sm);margin-top:-2px;display:flex;flex-direction:column;gap:10px;">
      <details style="font-size:12px;color:var(--muted);">
        <summary style="cursor:pointer;font-weight:600;color:var(--text);">${escapeHtml(meta.setupTitle)}</summary>
        <ol style="margin:8px 0 0 16px;padding:0;line-height:1.7;">
          ${meta.setupSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
        </ol>
        <a href="#" data-external-url="${escapeHtml(meta.setupUrl)}" style="font-size:11px;color:var(--accent);">打开 ${escapeHtml(meta.label)} 开发者控制台 →</a>
      </details>
      <div>
        <label>Client ID</label>
        <input type="text" data-ac-field="clientId" placeholder="粘贴 Client ID…" value="${escapeHtml(clientId)}" autocomplete="off">
      </div>
      ${meta.needsSecret ? `
      <div>
        <label>Client Secret</label>
        <input type="password" data-ac-field="clientSecret" placeholder="${escapeHtml(secretPlaceholder)}" autocomplete="new-password">
      </div>` : `<p style="font-size:11px;color:var(--muted);margin:0;">✓ Microsoft PKCE 流无需 Client Secret</p>`}
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-primary" data-ac-save-config="${safeType}" style="font-size:12px;padding:5px 14px;">保存</button>
        <span data-ac-config-status style="font-size:12px;color:var(--muted);"></span>
      </div>
    </div>
  `;
}
