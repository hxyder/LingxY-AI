import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";
import {
  conversationContextChips,
  conversationContextPreviewText,
  getConversationContextSummary
} from "../../shared/conversation-message-context.mjs";
import {
  buildConversationTreeRows,
  conversationBranchMeta
} from "./conversation-list-ia.mjs";

export function formatConversationTimestamp(ts) {
  return formatDateTime(ts, { locale: null, options: null });
}

export function roleBadge(role) {
  const colors = {
    user: "#3b82f6",
    assistant: "#10b981",
    system: "#a855f7",
    tool_summary: "#f59e0b"
  };
  const color = colors[role] ?? "#6b7280";
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:0.3px;">${escapeHtml(role)}</span>`;
}

export function renderConversationsListHtml({ items = [], selectedId = null } = {}) {
  const conversations = Array.isArray(items) ? items : [];
  if (conversations.length === 0) {
    return `<p class="muted" style="font-size:12px;">No conversations yet.</p>`;
  }
  return buildConversationTreeRows(conversations).map(({ conversation, depth, isBranch }) => {
    const safeDepth = Math.max(0, Math.min(Number(depth) || 0, 4));
    const conversationId = String(conversation?.conversation_id ?? "");
    const title = conversation.title || conversationId.slice(0, 24);
    const branch = conversationBranchMeta(conversation);
    const branchKind = branch?.kind ?? "";
    const branchSource = branch?.source ?? "";
    return `
    <div class="history-item-row ${isBranch ? "history-item-row--branch" : ""} ${conversationId === selectedId ? "active" : ""}"
         data-row-conversation-id="${escapeHtml(conversationId)}"
         style="--conversation-indent:${safeDepth * 16}px;">
      <button class="history-item history-item--main"
              data-conversation-id="${escapeHtml(conversationId)}"
              style="text-align:left;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <strong style="font-size:13px;display:flex;align-items:center;gap:6px;min-width:0;">
            <span style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(title)}</span>
            ${branchKind ? `<span class="conversation-branch-chip">${escapeHtml(branchKind)}</span>` : ""}
          </strong>
          <span class="muted" style="font-size:11px;">${conversation.message_count}m · ${conversation.task_count}t${conversation.archived ? " · archived" : ""}</span>
        </div>
        ${branchSource ? `<p class="muted conversation-branch-source">from ${escapeHtml(branchSource.slice(0, 24))}</p>` : ""}
        <p class="muted" style="margin-top:4px;font-size:11px;">${escapeHtml(formatConversationTimestamp(conversation.updated_at))}</p>
      </button>
      <button class="history-item-resume" type="button"
              data-resume-conversation-id="${escapeHtml(conversationId)}"
              title="在 Chat 标签继续此对话" aria-label="继续对话">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>
        </svg>
      </button>
    </div>
  `;
  }).join("");
}

function renderContinueButton(conversationId) {
  return `
    <div style="margin-bottom:12px;">
      <button id="conversationsContinueBtn" class="btn btn-sm btn-primary" type="button"
              data-conversation-id="${escapeHtml(conversationId)}">
        Continue this conversation
      </button>
    </div>
  `;
}

function buildMessageTaskLinksByMessage(links = []) {
  const linksByMessage = new Map();
  for (const link of links) {
    if (!linksByMessage.has(link.message_id)) linksByMessage.set(link.message_id, []);
    linksByMessage.get(link.message_id).push(link);
  }
  return linksByMessage;
}

function renderConversationMessage(message, linksByMessage) {
  const links = linksByMessage.get(message.message_id) ?? [];
  const linksHtml = links.length
    ? `<div style="margin-top:6px;font-size:11px;color:#6b7280;">${links.map((link) => `${escapeHtml(link.relation)}: <code>${escapeHtml(link.task_id)}</code>`).join(" · ")}</div>`
    : "";
  const meta = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
  const metaTags = [];
  if (meta.backfilled) metaTags.push(`<span class="tag" style="background:#fef3c7;color:#92400e;">backfilled</span>`);
  if (meta.partial) metaTags.push(`<span class="tag" style="background:#fef3c7;color:#92400e;">partial</span>`);
  if (meta.migration_version) metaTags.push(`<span class="tag" style="background:#dbeafe;color:#1e40af;">${escapeHtml(meta.migration_version)}</span>`);
  if (meta.executor) metaTags.push(`<span class="tag" style="background:#e5e7eb;color:#374151;">exec:${escapeHtml(meta.executor)}</span>`);
  const metaHtml = metaTags.length ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${metaTags.join("")}</div>` : "";
  const statusHtml = message.status ? ` <span class="muted" style="font-size:11px;">[${escapeHtml(message.status)}]</span>` : "";
  let preview = String(message.content ?? "");
  if (message.role === "tool_summary") {
    try { preview = JSON.stringify(JSON.parse(preview), null, 2); } catch { /* leave as-is */ }
  }
  if (preview.length > 1200) preview = preview.slice(0, 1200) + "\n…[truncated]";
  const contextSummary = getConversationContextSummary(message);
  const chips = conversationContextChips(contextSummary);
  const contextPreview = conversationContextPreviewText(contextSummary);
  const conversationId = String(message.conversation_id ?? "");
  const messageId = String(message.message_id ?? "");
  const branchActionsHtml = conversationId && messageId ? `
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-ghost" type="button"
                    data-conversation-fork-message="${escapeHtml(messageId)}"
                    data-conversation-id="${escapeHtml(conversationId)}">Fork</button>
            <button class="btn btn-sm btn-ghost" type="button"
                    data-conversation-rewind-message="${escapeHtml(messageId)}"
                    data-conversation-id="${escapeHtml(conversationId)}">Rewind</button>
            ${message.role !== "tool_summary" ? `<button class="btn btn-sm btn-ghost" type="button"
                    data-conversation-edit-message="${escapeHtml(messageId)}"
                    data-conversation-id="${escapeHtml(conversationId)}">Edit</button>` : ""}
          </div>
        ` : "";
  const contextHtml = contextSummary ? `
        <div style="margin-top:8px;padding:8px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
          <div style="font-size:11px;font-weight:600;color:#374151;margin-bottom:6px;">Context</div>
          ${chips.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${contextPreview ? "6px" : "0"};">${chips.map((chip) => `<span class="tag" title="${escapeHtml(chip.title ?? chip.label)}">${escapeHtml(chip.label)}</span>`).join("")}</div>` : ""}
          ${contextPreview ? `<div style="font-size:12px;color:#4b5563;line-height:1.45;white-space:pre-wrap;">${escapeHtml(contextPreview)}</div>` : ""}
        </div>
      ` : "";
  return `
      <div class="surface" style="padding:10px 12px;margin-bottom:10px;">
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${roleBadge(message.role)}
            <span class="muted" style="font-size:11px;">seq ${message.seq}${statusHtml}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            ${branchActionsHtml}
            <span class="muted" style="font-size:11px;">${escapeHtml(formatConversationTimestamp(message.ts))}</span>
          </div>
        </div>
        <pre style="margin-top:8px;white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:13px;line-height:1.5;">${escapeHtml(preview)}</pre>
        ${contextHtml}
        ${linksHtml}
        ${metaHtml}
      </div>
    `;
}

export function renderConversationDetailView(detail = null) {
  if (!detail?.conversation) {
    return {
      title: "Select a conversation",
      meta: "",
      bodyHtml: `<p class="muted" style="font-size:12px;">No conversation selected.</p>`
    };
  }
  const conversation = detail.conversation;
  const continueButtonHtml = renderContinueButton(conversation.conversation_id);
  const title = conversation.title || conversation.conversation_id;
  const meta = `${conversation.message_count} messages · ${conversation.task_count} tasks · updated ${formatConversationTimestamp(conversation.updated_at)}`;
  const messages = Array.isArray(detail.messages) ? detail.messages : [];
  if (messages.length === 0) {
    return {
      title,
      meta,
      bodyHtml: `${continueButtonHtml}<p class="muted" style="font-size:12px;">No messages.</p>`
    };
  }
  const linksByMessage = buildMessageTaskLinksByMessage(detail.message_task_links ?? []);
  return {
    title,
    meta,
    bodyHtml: continueButtonHtml + messages.map((message) => renderConversationMessage(message, linksByMessage)).join("")
  };
}
