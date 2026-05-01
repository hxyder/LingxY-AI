import {
  escapeHtml,
  formatDateTime
} from "./shared-ui.mjs";

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

export function renderChatSidebarListHtml({
  items = [],
  searchTerm = "",
  activeConversationId = null
} = {}) {
  const source = Array.isArray(items) ? items : [];
  const term = normalizeChatSidebarSearchTerm(searchTerm);
  const filtered = filterChatSidebarItems(source, term);
  if (filtered.length === 0) {
    return source.length === 0
      ? `<p class="chat-sidebar-empty">还没有对话，点 + New 开始。</p>`
      : `<p class="chat-sidebar-empty">没有匹配 "${escapeHtml(term)}" 的对话。</p>`;
  }
  return filtered.map((conversation) => {
    const conversationId = String(conversation?.conversation_id ?? "");
    const isActive = conversationId === activeConversationId;
    return `
      <button type="button" class="chat-sidebar-item ${isActive ? "active" : ""}" data-chat-sidebar-id="${escapeHtml(conversationId)}">
        <div class="chat-sidebar-item-title">${escapeHtml(conversationTitle(conversation))}</div>
        <div class="chat-sidebar-item-meta">
          <span>${escapeHtml(String(conversation.message_count ?? 0))}m · ${escapeHtml(String(conversation.task_count ?? 0))}t</span>
          <span>·</span>
          <span>${escapeHtml(formatDateTime(conversation.updated_at))}</span>
        </div>
      </button>
    `;
  }).join("");
}
