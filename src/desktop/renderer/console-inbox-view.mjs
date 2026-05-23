import { ACCOUNT_CONNECTOR_META } from "./console-account-connectors-view.mjs";
import { escapeHtml } from "./shared-ui.mjs";

const IMAP_PROVIDER_LOGOS = Object.freeze({
  gmail:   Object.freeze({ cls: "gmail",   logo: "G" }),
  outlook: Object.freeze({ cls: "outlook", logo: "O" }),
  graph:   Object.freeze({ cls: "outlook", logo: "O" }),
  qq:      Object.freeze({ cls: "qq",      logo: "Q" }),
  "163":   Object.freeze({ cls: "imap",    logo: "163" }),
  imap:    Object.freeze({ cls: "imap",    logo: "✉" })
});

function escapeSrcdocAttribute(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mapGet(mapLike, key) {
  return mapLike && typeof mapLike.get === "function" ? mapLike.get(key) : undefined;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString("zh-CN") : "";
}

function formatDateTime(value, options) {
  return value ? new Date(value).toLocaleString("zh-CN", options) : "";
}

export function renderEmailHtmlFrame(emailId, rawHtml) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;";
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{margin:0;padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.55;color:#1a1917;background:#ffffff;word-break:break-word}a{color:#b85c2a}img{max-width:100%;height:auto}table{max-width:100%!important}</style></head><body>${rawHtml ?? ""}</body></html>`;
  return `<iframe class="inbox-item-body-html" data-email-html-frame="${escapeHtml(emailId)}" sandbox="" srcdoc="${escapeSrcdocAttribute(doc)}" referrerpolicy="no-referrer"></iframe>`;
}

export function renderInboxAccountsHtml(accounts = [], activeAccountId = null) {
  if (!accounts.length) {
    return `
      <div class="inbox-empty-accounts" style="padding:18px 16px;display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
        <p class="muted" style="margin:0;font-size:12px;line-height:1.5;">尚未连接账户。连接邮箱、文件、日历后，这里能直接预览。</p>
        <button type="button" class="btn btn-sm btn-primary" id="inboxGoConnectorsBtn">
          去 Connectors 添加<span class="zh">·</span><span>Connect</span>
        </button>
      </div>
    `;
  }
  return accounts.map((account) => {
    const isImap = account._kind === "imap";
    const oauthMeta = ACCOUNT_CONNECTOR_META[account.provider];
    const imapMeta = IMAP_PROVIDER_LOGOS[account.provider] ?? IMAP_PROVIDER_LOGOS.imap;
    const meta = oauthMeta ?? { label: account.provider, logo: imapMeta.logo, logoClass: imapMeta.cls };
    const isActive = account.id === activeAccountId;
    const statusClass = account.tokenStatus === "active" ? "" : "offline";
    const kindLabel = isImap ? "IMAP" : (meta.label ?? account.provider);
    return `
      <button class="inbox-account ${isActive ? "active" : ""}" data-inbox-account="${escapeHtml(account.id)}" type="button">
        <div class="inbox-account-logo acc-logo ${escapeHtml(meta.logoClass)}">${escapeHtml(meta.logo)}</div>
        <div class="inbox-account-info">
          <div class="inbox-account-name">${escapeHtml(account.displayName ?? account.email ?? meta.label)}</div>
          <div class="inbox-account-email">${escapeHtml(account.email ?? "")}${isImap ? ` · ${escapeHtml(kindLabel)}` : ""}</div>
        </div>
        <span class="inbox-account-status ${statusClass}" title="${escapeHtml(account.tokenStatus ?? "")}"></span>
      </button>
    `;
  }).join("");
}

export function renderInboxContentHtml(data = {}, {
  activeTab = "files",
  isImap = false,
  expandedEmailId = null,
  fullBodyCache = null,
  htmlBodyCache = null,
  bodyViewMode = null
} = {}) {
  if (isImap && data.reason) {
    return `
      <div class="inbox-empty" style="padding:32px 24px;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px;">
          无法连接到邮箱服务器
        </div>
        <div style="max-width:440px;margin:0 auto;line-height:1.6;font-size:12px;">
          ${escapeHtml(data.reason)}<br/>
          <span class="muted">检查 Connectors 页的 IMAP host / 授权码，或稍后重试。</span>
        </div>
      </div>
    `;
  }

  if (activeTab === "files") {
    return renderInboxFilesHtml(data.files ?? []);
  }
  if (activeTab === "emails") {
    return renderInboxEmailsHtml(data.emails ?? data.messages ?? [], {
      expandedEmailId,
      fullBodyCache,
      htmlBodyCache,
      bodyViewMode
    });
  }
  return renderInboxCalendarHtml(data.events ?? []);
}

export function renderInboxFilesHtml(files = []) {
  if (!files.length) return `<p class="inbox-empty">该账户没有可预览的文件。</p>`;
  return files.map((file) => `
    <button class="inbox-item" type="button" data-external-url="${escapeHtml(file.url ?? "")}">
      <span class="inbox-item-icon">${file.isFolder ? "📁" : "📄"}</span>
      <div class="inbox-item-main">
        <div class="inbox-item-title">${escapeHtml(file.name ?? "(untitled)")}</div>
        <div class="inbox-item-meta">${escapeHtml(file.path ?? file.url ?? "")}</div>
      </div>
      <span class="inbox-item-time">${escapeHtml(formatDate(file.modified))}</span>
    </button>
  `).join("");
}

export function renderInboxEmailsHtml(emails = [], {
  expandedEmailId = null,
  fullBodyCache = null,
  htmlBodyCache = null,
  bodyViewMode = null
} = {}) {
  if (!emails.length) return `<p class="inbox-empty">该账户暂无邮件。</p>`;
  return emails.map((email) => {
    const isExpanded = expandedEmailId === email.id;
    const body = mapGet(fullBodyCache, email.id) ?? email.bodyText ?? email.preview ?? "";
    const htmlBody = mapGet(htmlBodyCache, email.id) ?? email.bodyHtml ?? "";
    const hasHtml = htmlBody && htmlBody.length > 0;
    const viewMode = mapGet(bodyViewMode, email.id) ?? (hasHtml ? "html" : "text");
    const receivedLine = formatDateTime(email.received, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
    });
    const fromLine = [email.fromName, email.from].filter(Boolean).map(escapeHtml).join(" &lt;")
      + (email.fromName && email.from ? "&gt;" : "");
    let bodyMarkup = "";
    if (isExpanded && viewMode === "html" && hasHtml) {
      bodyMarkup = renderEmailHtmlFrame(email.id, htmlBody);
    } else if (isExpanded && body) {
      bodyMarkup = `<pre class="inbox-item-body-text">${escapeHtml(body)}</pre>`;
    } else if (isExpanded) {
      bodyMarkup = `<pre class="inbox-item-body-text"><span class="muted">（此邮件没有可预览的文本正文）</span></pre>`;
    }
    const toggleMarkup = isExpanded && hasHtml ? `
      <div class="inbox-item-body-toggle">
        <button type="button" class="seg-btn ${viewMode === "html" ? "active" : ""}" data-email-view="html" data-email-id="${escapeHtml(email.id)}">Rich</button>
        <button type="button" class="seg-btn ${viewMode === "text" ? "active" : ""}" data-email-view="text" data-email-id="${escapeHtml(email.id)}">Plain</button>
      </div>
    ` : "";
    return `
      <button class="inbox-item ${isExpanded ? "inbox-item--expanded" : ""}" type="button" data-email-id="${escapeHtml(email.id ?? "")}">
        <span class="inbox-item-icon">${email.isRead ? "○" : "●"}</span>
        <div class="inbox-item-main">
          <div class="inbox-item-title ${email.isRead ? "" : "unread"}">${escapeHtml(email.subject ?? "(无主题)")}</div>
          <div class="inbox-item-meta">${escapeHtml(email.fromName ?? email.from ?? "")}${!isExpanded && email.preview ? " — " + escapeHtml(email.preview) : ""}</div>
        </div>
        <span class="inbox-item-time">${escapeHtml(formatDate(email.received))}</span>
      </button>
      ${isExpanded ? `
        <div class="inbox-item-body">
          <div class="inbox-item-body-head">
            <div><strong>${escapeHtml(email.subject ?? "(无主题)")}</strong></div>
            <div class="muted">From ${fromLine || "(unknown)"}${receivedLine ? ` · ${escapeHtml(receivedLine)}` : ""}</div>
            ${toggleMarkup}
          </div>
          ${bodyMarkup}
        </div>
      ` : ""}
    `;
  }).join("");
}

export function renderInboxCalendarHtml(events = []) {
  if (!events.length) return `<p class="inbox-empty">近期无日程。</p>`;
  return events.map((event) => `
    <button class="inbox-item" type="button">
      <span class="inbox-item-icon">📅</span>
      <div class="inbox-item-main">
        <div class="inbox-item-title">${escapeHtml(event.title ?? "(无标题)")}</div>
        <div class="inbox-item-meta">${event.location ? escapeHtml(event.location) : ""}</div>
      </div>
      <span class="inbox-item-time">${escapeHtml(formatDateTime(event.start, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span>
    </button>
  `).join("");
}
