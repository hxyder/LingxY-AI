import { escapeHtml } from "./shared-ui.mjs";

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function countSecrets(value) {
  return Array.isArray(value) ? value.length : 0;
}

function permissionsSummary(permissions = {}) {
  if (!permissions || typeof permissions !== "object") return "";
  const parts = [];
  if (permissions.network) parts.push("network");
  if (permissions.filesystem) parts.push(`files: ${permissions.filesystem}`);
  const secretCount = countSecrets(permissions.secrets);
  if (secretCount > 0) parts.push(`secrets: ${secretCount}`);
  return parts.join(" · ");
}

function draftSummaryRows(draft = {}) {
  const rows = [];
  const kind = asText(draft.kind);
  const name = asText(draft.name) || asText(draft.id);
  if (kind) rows.push({ label: "类型", value: kind });
  if (name) rows.push({ label: "名称", value: name });
  const purpose = asText(draft.purpose);
  if (purpose) rows.push({ label: "用途", value: purpose });
  const perms = permissionsSummary(draft.permissions);
  if (perms) rows.push({ label: "权限", value: perms });
  if (draft.kind === "skill") {
    rows.push({ label: "产物", value: "SKILL.md 草案" });
  } else if (draft.kind === "mcp") {
    const descriptor = draft.descriptor && typeof draft.descriptor === "object" ? draft.descriptor : {};
    rows.push({ label: "连接", value: descriptor.transport === "stdio" ? "stdio MCP" : `${descriptor.transport ?? "mcp"}` });
    rows.push({ label: "状态", value: "草稿，未启用" });
  }
  return rows;
}

// Structured next-step affordances for a ready_to_save draft. The view layer
// describes intents only — no click handlers and no direct save plumbing —
// so the user keeps driving the interview through chat and approval flow.
function readyToSaveActions(draft = {}) {
  const kind = asText(draft.kind);
  const saveDescription = kind === "mcp"
    ? "保存为待审核 MCP 草稿；仍需导入、配置、测试、启用。"
    : "保存为可编辑 skill 草稿；仍可修改、测试、回滚。";
  return [
    {
      intent: "confirm_save",
      label: "确认保存草稿",
      description: saveDescription,
      safety: "review_required"
    },
    {
      intent: "edit_field",
      label: "继续编辑",
      description: "修改用途、权限或配置；不写文件。",
      safety: "no_side_effect"
    },
    {
      intent: "discard",
      label: "放弃草案",
      description: "结束当前草案；不写文件。",
      safety: "no_side_effect"
    }
  ];
}

function recoveryActions(recovery = {}) {
  const list = Array.isArray(recovery.suggested_next_actions) ? recovery.suggested_next_actions : [];
  return list
    .map((action) => {
      const field = asText(action?.field);
      const prompt = asText(action?.prompt);
      if (!prompt) return null;
      return {
        intent: "edit_field",
        label: field || "下一步",
        description: prompt,
        field: field || null,
        safety: "no_side_effect"
      };
    })
    .filter(Boolean);
}

export function buildCapabilityToolView(toolName = "", metadata = {}) {
  const toolId = asText(toolName);
  if (toolId !== "draft_capability" && toolId !== "save_capability_draft") return null;
  const data = metadata && typeof metadata === "object" ? metadata : {};
  const status = asText(data.status);

  if (toolId === "draft_capability") {
    if (status === "interviewing") {
      const state = data.state && typeof data.state === "object" ? data.state : {};
      const question = data.next_question && typeof data.next_question === "object" ? data.next_question : {};
      const missing = Array.isArray(data.missing_fields) ? data.missing_fields : state.missing_fields;
      return {
        title: "能力访谈",
        badge: "需要补充",
        tone: "info",
        rows: [
          { label: "类型", value: asText(state.kind) || "capability" },
          { label: "缺少", value: Array.isArray(missing) && missing.length ? missing.join(", ") : "待确认" }
        ],
        question: asText(question.prompt),
        hint: asText(question.hint)
      };
    }
    if (status === "ready_to_save") {
      return {
        title: "能力草案已就绪",
        badge: "待确认保存",
        tone: "ok",
        rows: draftSummaryRows(data.draft),
        question: "确认后才会进入保存步骤；未确认不会写入 skill 或 MCP 配置。",
        actions: readyToSaveActions(data.draft)
      };
    }
    if (status === "recovery_required") {
      const recovery = data.recovery && typeof data.recovery === "object" ? data.recovery : {};
      const actions = recoveryActions(recovery);
      return {
        title: "能力草案需要调整",
        badge: "需要修正",
        tone: "warn",
        rows: actions.map((action) => ({ label: action.label, value: action.description })),
        question: asText(recovery.question),
        actions
      };
    }
  }

  if (toolId === "save_capability_draft") {
    const kind = asText(data.kind);
    const rows = [];
    if (kind) rows.push({ label: "类型", value: kind });
    if (asText(data.id)) rows.push({ label: "名称", value: asText(data.id) });
    if (asText(data.path)) rows.push({ label: "位置", value: asText(data.path) });
    return {
      title: status === "saved" ? "能力草稿已保存" : "能力保存需要处理",
      badge: status === "saved" ? "已保存" : "需要处理",
      tone: status === "saved" ? "ok" : "warn",
      rows,
      question: data.review_required ? "MCP 草稿仍需 review/install/enable；保存草稿不等于启用 live capability。" : ""
    };
  }

  return null;
}

function renderActionListHtml(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return "";
  const items = actions.map((action) => {
    const intent = escapeHtml(action.intent ?? "");
    const safety = escapeHtml(action.safety ?? "");
    const label = escapeHtml(action.label ?? "");
    const description = escapeHtml(action.description ?? "");
    return `<li class="capability-tool-view-action" data-capability-action="${intent}" data-capability-safety="${safety}">`
      + `<span class="capability-tool-view-action-label">${label}</span>`
      + (description ? `<span class="capability-tool-view-action-desc">${description}</span>` : "")
      + "</li>";
  }).join("");
  return `<ul class="capability-tool-view-actions">${items}</ul>`;
}

export function renderCapabilityToolViewHtml(view = null) {
  if (!view) return "";
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const actionsHtml = renderActionListHtml(view.actions);
  return `
    <div class="capability-tool-view capability-tool-view--${escapeHtml(view.tone ?? "info")}">
      <div class="capability-tool-view-head">
        <strong>${escapeHtml(view.title ?? "能力")}</strong>
        <span>${escapeHtml(view.badge ?? "")}</span>
      </div>
      ${rows.length ? `<dl>${rows.map((row) => `
        <div>
          <dt>${escapeHtml(row.label ?? "")}</dt>
          <dd>${escapeHtml(row.value ?? "")}</dd>
        </div>`).join("")}</dl>` : ""}
      ${view.question ? `<p>${escapeHtml(view.question)}</p>` : ""}
      ${view.hint ? `<p class="muted">${escapeHtml(view.hint)}</p>` : ""}
      ${actionsHtml}
    </div>
  `;
}
