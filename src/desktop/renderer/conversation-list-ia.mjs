export function conversationBranchMeta(conversation = {}) {
  const branch = conversation?.metadata?.branch;
  if (!branch || typeof branch !== "object") return null;
  const kind = String(branch.kind ?? "").trim();
  const source = String(branch.source_conversation_id ?? "").trim();
  if (!kind && !source) return null;
  return {
    kind: kind || "branch",
    source
  };
}

export function buildConversationTreeRows(items = [], {
  groupBranches = true,
  searchTerm = ""
} = {}) {
  const conversations = Array.isArray(items) ? items : [];
  if (!groupBranches || String(searchTerm ?? "").trim()) {
    return conversations.map((conversation) => ({ conversation, depth: 0, isBranch: false }));
  }

  const byId = new Map();
  for (const conversation of conversations) {
    const id = String(conversation?.conversation_id ?? "");
    if (id) byId.set(id, conversation);
  }

  const childrenBySource = new Map();
  const childIds = new Set();
  for (const conversation of conversations) {
    const id = String(conversation?.conversation_id ?? "");
    const branch = conversationBranchMeta(conversation);
    if (!id || !branch?.source || branch.source === id || !byId.has(branch.source)) continue;
    if (!childrenBySource.has(branch.source)) childrenBySource.set(branch.source, []);
    childrenBySource.get(branch.source).push(conversation);
    childIds.add(id);
  }

  const roots = conversations.filter((conversation) => {
    const id = String(conversation?.conversation_id ?? "");
    return !id || !childIds.has(id);
  });
  const rows = [];
  const seen = new Set();
  const append = (conversation, depth = 0) => {
    const id = String(conversation?.conversation_id ?? "");
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    rows.push({
      conversation,
      depth,
      isBranch: depth > 0 || Boolean(conversationBranchMeta(conversation))
    });
    const children = id ? (childrenBySource.get(id) ?? []) : [];
    for (const child of children) append(child, depth + 1);
  };

  for (const root of roots) append(root, 0);
  for (const conversation of conversations) append(conversation, 0);
  return rows;
}
