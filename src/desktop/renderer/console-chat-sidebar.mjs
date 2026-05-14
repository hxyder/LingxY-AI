import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";
import {
  buildConversationTreeRows,
  conversationBranchMeta
} from "./conversation-list-ia.mjs";

export function normalizeChatSidebarSearchTerm(value = "") {
  return String(value ?? "").trim().toLowerCase();
}

export function filterChatSidebarItems(items = [], searchTerm = "") {
  const source = Array.isArray(items) ? items : [];
  const term = normalizeChatSidebarSearchTerm(searchTerm);
  if (!term) return source;
  return source.filter((conversation) => {
    const title = String(conversation?.title || "").toLowerCase();
    const id = String(conversation?.conversation_id || "").toLowerCase();
    return title.includes(term) || id.includes(term);
  });
}

function conversationTitle(conversation = {}) {
  const id = String(conversation.conversation_id ?? "");
  return conversation.title || id.slice(0, 24);
}

function conversationSearchSnippet(conversation = {}) {
  const snippet = conversation?.search_match?.snippet;
  return typeof snippet === "string" && snippet.trim() ? snippet.trim() : "";
}

export function renderChatSidebarListHtml({
  items = [],
  searchTerm = "",
  activeConversationId = null,
  projectId = null,
  loadingConversationId = null,
  searchAlreadyApplied = false
} = {}) {
  const source = Array.isArray(items) ? items : [];
  const term = normalizeChatSidebarSearchTerm(searchTerm);
  const filtered = searchAlreadyApplied && term ? source : filterChatSidebarItems(source, term);
  if (filtered.length === 0) {
    return source.length === 0
      ? `<p class="chat-sidebar-empty">${projectId ? "这个项目还没有对话，点 + New 开始。" : "还没有对话，点 + New 开始。"}</p>`
      : `<p class="chat-sidebar-empty">没有匹配 "${escapeHtml(term)}" 的对话。</p>`;
  }
  const rows = buildConversationTreeRows(filtered, {
    groupBranches: true,
    searchTerm: term
  });
  return rows.map(({ conversation, depth, isBranch }) => {
    const safeDepth = Math.max(0, Math.min(Number(depth) || 0, 4));
    const conversationId = String(conversation?.conversation_id ?? "");
    const isActive = conversationId === activeConversationId;
    const isLoading = conversationId === loadingConversationId;
    const snippet = conversationSearchSnippet(conversation);
    const branch = conversationBranchMeta(conversation);
    return `
      <div class="chat-sidebar-item-row ${isActive ? "active" : ""} ${isLoading ? "loading" : ""}"
           style="--conversation-indent:${safeDepth * 16}px;--conversation-line-offset:${Math.max(0, safeDepth - 1) * 16}px;">
        <button type="button" class="chat-sidebar-item ${isBranch ? "chat-sidebar-item--branch" : ""} ${isActive ? "active" : ""}"
                data-chat-sidebar-id="${escapeHtml(conversationId)}">
          <div class="chat-sidebar-item-title">
            <span>${escapeHtml(conversationTitle(conversation))}</span>
            ${branch ? `<span class="conversation-branch-chip">${escapeHtml(branch.kind)}</span>` : ""}
          </div>
          ${branch?.source ? `<div class="chat-sidebar-item-branch">from ${escapeHtml(branch.source.slice(0, 18))}</div>` : ""}
          ${snippet ? `<div class="chat-sidebar-item-snippet">${escapeHtml(snippet)}</div>` : ""}
          <div class="chat-sidebar-item-meta">
            <span>${escapeHtml(String(conversation.message_count ?? 0))}m · ${escapeHtml(String(conversation.task_count ?? 0))}t</span>
            <span>·</span>
            <span>${escapeHtml(formatDateTime(conversation.updated_at))}</span>
            ${isLoading ? `<span>· loading</span>` : ""}
          </div>
        </button>
        <button type="button" class="chat-sidebar-delete" data-chat-sidebar-delete-id="${escapeHtml(conversationId)}" aria-label="Delete ${escapeHtml(conversationTitle(conversation))}" title="Delete conversation">×</button>
      </div>
    `;
  }).join("");
}
