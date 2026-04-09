const runtimeState = document.querySelector("#runtimeState");
const summaryGrid = document.querySelector("#summaryGrid");
const integrationList = document.querySelector("#integrationList");
const refreshButton = document.querySelector("#refreshButton");
const openOverlayButton = document.querySelector("#openOverlayButton");
const onboardingState = document.querySelector("#onboardingState");
const wizardList = document.querySelector("#wizardList");
const taskComposer = document.querySelector("#taskComposer");
const commandInput = document.querySelector("#commandInput");
const contextInput = document.querySelector("#contextInput");
const submitState = document.querySelector("#submitState");
const taskCount = document.querySelector("#taskCount");
const taskList = document.querySelector("#taskList");
const taskDetailSummary = document.querySelector("#taskDetailSummary");
const taskTimeline = document.querySelector("#taskTimeline");
const retryTaskButton = document.querySelector("#retryTaskButton");
const cancelTaskButton = document.querySelector("#cancelTaskButton");
const approvalCount = document.querySelector("#approvalCount");
const approvalList = document.querySelector("#approvalList");
const scheduleCount = document.querySelector("#scheduleCount");
const scheduleList = document.querySelector("#scheduleList");
const templateCount = document.querySelector("#templateCount");
const templateList = document.querySelector("#templateList");
const templateForm = document.querySelector("#templateForm");
const templateNameInput = document.querySelector("#templateNameInput");
const templatePromptInput = document.querySelector("#templatePromptInput");
const deleteTemplateButton = document.querySelector("#deleteTemplateButton");
const templateState = document.querySelector("#templateState");
const templatePreview = document.querySelector("#templatePreview");
const budgetSummary = document.querySelector("#budgetSummary");
const budgetForm = document.querySelector("#budgetForm");
const monthlyBudgetInput = document.querySelector("#monthlyBudgetInput");
const budgetState = document.querySelector("#budgetState");
const historyForm = document.querySelector("#historyForm");
const historyQueryInput = document.querySelector("#historyQueryInput");
const historyList = document.querySelector("#historyList");
const historyPreview = document.querySelector("#historyPreview");
const privacyState = document.querySelector("#privacyState");
const killSwitchToggle = document.querySelector("#killSwitchToggle");
const offlineModeToggle = document.querySelector("#offlineModeToggle");
const presenterModeToggle = document.querySelector("#presenterModeToggle");
const redactionRuleList = document.querySelector("#redactionRuleList");
const retentionList = document.querySelector("#retentionList");
const auditCount = document.querySelector("#auditCount");
const auditList = document.querySelector("#auditList");

const state = {
  serviceBaseUrl: new URLSearchParams(window.location.search).get("serviceBaseUrl") ?? "http://127.0.0.1:4310",
  workspace: {
    health: null,
    tasks: [],
    approvals: [],
    schedules: [],
    templates: [],
    budget: null,
    providers: [],
    codeCliAdapters: [],
    history: [],
    security: null,
    audit: []
  },
  selectedTaskId: null,
  selectedTemplateId: null,
  currentHistoryQuery: "",
  detailVersion: 0,
  updatingSecurity: false
};

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  const normalized = `${value ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "template";
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${state.serviceBaseUrl}${pathname}`, options);
  const payloadText = await response.text();
  const payload = payloadText ? JSON.parse(payloadText) : {};
  if (!response.ok) {
    throw new Error(payload.message ?? payload.error ?? pathname);
  }
  return payload;
}

function formatDateTime(value) {
  if (!value) {
    return "未记录";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    hour12: false
  });
}

function formatMoney(value) {
  const numeric = Number(value ?? 0);
  return `$${numeric.toFixed(2)}`;
}

function renderEmpty(container, message, className = "muted") {
  container.innerHTML = `<div class="surface"><p class="${className}" style="margin:0;">${escapeHtml(message)}</p></div>`;
}

function setRuntimeBadge(ok, message) {
  runtimeState.textContent = message;
  runtimeState.className = `chip ${ok ? "ready" : "danger"}`;
}

function computeSummary(tasks, budget) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    running: tasks.filter((task) => ["running", "cancelling"].includes(task.status)).length,
    queued: tasks.filter((task) => task.status === "queued").length,
    todaySuccess: tasks.filter((task) => task.status === "success" && `${task.updated_at ?? task.created_at ?? ""}`.startsWith(today)).length,
    todayFailed: tasks.filter((task) => ["failed", "cancelled"].includes(task.status) && `${task.updated_at ?? task.created_at ?? ""}`.startsWith(today)).length,
    monthlyBudgetUsage: budget?.spent?.this_month_usd ?? 0
  };
}

function renderSummary() {
  const summary = computeSummary(state.workspace.tasks, state.workspace.budget);
  const items = [
    ["运行中", summary.running],
    ["排队中", summary.queued],
    ["今日成功", summary.todaySuccess],
    ["本月花费", formatMoney(summary.monthlyBudgetUsage)]
  ];
  summaryGrid.innerHTML = items.map(([label, value]) => `
    <div class="summary-tile">
      <span class="muted">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderOnboarding() {
  const kimi = state.workspace.health?.kimi ?? state.workspace.codeCliAdapters.find((item) => item.id === "kimi-code-cli") ?? null;
  const providerReady = state.workspace.providers.some((provider) => provider.available && provider.configured);
  const tasks = state.workspace.tasks ?? [];
  const hasFileFlow = tasks.some((task) => ["file", "file_group"].includes(task.source_type));
  const hasBrowserFlow = tasks.some((task) => ["text_selection", "image", "webpage", "link"].includes(task.source_type));
  const steps = [
    {
      title: "欢迎使用桌面版 UCA",
      status: "ready",
      detail: "当前已经运行在 Electron 桌面壳中。"
    },
    {
      title: "本地 runtime",
      status: state.workspace.health?.ok ? "ready" : "action_needed",
      detail: state.workspace.health?.ok ? `已连接 ${state.serviceBaseUrl}` : "本地 runtime 尚未连接。"
    },
    {
      title: "Kimi Code CLI",
      status: kimi?.available ? "ready" : kimi?.configured ? "recommended" : "action_needed",
      detail: kimi?.command ?? kimi?.detail ?? (providerReady ? "云端 provider 已可用，但当前阶段建议优先使用 Code CLI。" : "请先安装并登录 Kimi Code CLI。")
    },
    {
      title: "文件右键入口",
      status: hasFileFlow ? "ready" : "recommended",
      detail: hasFileFlow ? "已检测到文件入口任务记录。" : "右键文件后可直接拉起桌面浮窗输入要求。"
    },
    {
      title: "浏览器/扩展入口",
      status: hasBrowserFlow ? "ready" : "optional",
      detail: hasBrowserFlow ? "已检测到网页类任务记录。" : "如果你需要网页选区和页面抓取，再启用浏览器入口。"
    }
  ];

  const hasBlocking = steps.some((step) => step.status === "action_needed");
  const hasRecommended = steps.some((step) => step.status === "recommended");
  onboardingState.textContent = hasBlocking ? "需处理" : hasRecommended ? "建议完善" : "已就绪";
  onboardingState.className = `chip ${hasBlocking ? "danger" : hasRecommended ? "warning" : "ready"}`;
  wizardList.innerHTML = steps.map((step, index) => `
    <div class="surface">
      <div class="row">
        <strong>${index + 1}. ${escapeHtml(step.title)}</strong>
        <span class="chip ${step.status === "ready" ? "ready" : step.status === "optional" ? "muted" : step.status === "recommended" ? "warning" : "danger"}">${escapeHtml(step.status)}</span>
      </div>
      <p class="muted" style="margin:10px 0 0;">${escapeHtml(step.detail)}</p>
    </div>
  `).join("");
}

function renderIntegrations() {
  const health = state.workspace.health ?? {};
  const kimi = health.kimi ?? state.workspace.codeCliAdapters.find((item) => item.id === "kimi-code-cli") ?? null;
  const cards = [
    {
      title: "Kimi Code CLI",
      status: kimi?.available ? "ready" : kimi?.configured ? "warning" : "danger",
      detail: kimi?.command ?? kimi?.detail ?? "当前阶段主路径，建议优先接通。"
    },
    ...state.workspace.providers.slice(0, 3).map((provider) => ({
      title: provider.displayName,
      status: provider.available ? "ready" : provider.configured ? "warning" : "danger",
      detail: provider.detail ?? provider.id
    }))
  ];

  integrationList.innerHTML = cards.map((card) => `
    <div class="integration-item">
      <div class="row">
        <strong>${escapeHtml(card.title)}</strong>
        <span class="chip ${card.status}">${escapeHtml(card.status)}</span>
      </div>
      <p class="muted" style="margin:8px 0 0;">${escapeHtml(card.detail)}</p>
    </div>
  `).join("");
}

function renderTasks() {
  const tasks = state.workspace.tasks ?? [];
  taskCount.textContent = `${tasks.length}`;
  if (tasks.length === 0) {
    renderEmpty(taskList, "还没有任务。");
    state.selectedTaskId = null;
    renderTaskDetail(null);
    return;
  }

  if (!state.selectedTaskId || !tasks.some((task) => task.task_id === state.selectedTaskId)) {
    state.selectedTaskId = tasks[0].task_id;
  }

  taskList.innerHTML = tasks.slice(0, 12).map((task) => {
    const selected = task.task_id === state.selectedTaskId;
    const statusClass = task.status === "success" ? "ready" : task.status === "failed" ? "danger" : "warning";
    return `
      <button class="task-item ${selected ? "selected" : ""}" data-task-id="${escapeHtml(task.task_id)}" style="text-align:left;">
        <div class="row">
          <div>
            <h4>${escapeHtml(task.user_command ?? task.intent ?? "未命名任务")}</h4>
            <p class="muted">${escapeHtml(task.executor ?? "unknown")} · ${escapeHtml(task.source_type ?? "unknown")}</p>
          </div>
          <span class="chip ${statusClass}">${escapeHtml(task.status)}</span>
        </div>
        <p class="muted" style="margin-top:10px;">${escapeHtml(formatDateTime(task.created_at))}</p>
      </button>
    `;
  }).join("");

  for (const button of taskList.querySelectorAll("[data-task-id]")) {
    button.addEventListener("click", () => {
      state.selectedTaskId = button.dataset.taskId;
      renderTasks();
      void refreshTaskDetail();
    });
  }
}

function renderTaskDetail(detail) {
  if (!detail) {
    taskDetailSummary.innerHTML = `<p class="muted">选择一个任务后显示详情。</p>`;
    taskTimeline.innerHTML = `<div class="timeline-item"><p class="muted">暂无时间线。</p></div>`;
    retryTaskButton.disabled = true;
    cancelTaskButton.disabled = true;
    return;
  }

  const task = detail.task ?? {};
  const failureBlock = task.failure_category ? `
    <div class="surface">
      <strong>失败信息</strong>
      <p class="muted" style="margin:8px 0 0;">${escapeHtml(task.failure_user_message ?? task.failure_category)}</p>
    </div>
  ` : "";
  taskDetailSummary.innerHTML = `
    <div class="surface stack">
      <div class="row">
        <strong>${escapeHtml(task.user_command ?? task.intent ?? task.task_id)}</strong>
        <span class="chip ${task.status === "success" ? "ready" : task.status === "failed" ? "danger" : "warning"}">${escapeHtml(task.status ?? "unknown")}</span>
      </div>
      <div class="row wrap">
        <span class="muted">任务 ID: ${escapeHtml(task.task_id)}</span>
        <span class="muted">执行器: ${escapeHtml(task.executor ?? "unknown")}</span>
      </div>
      <div class="row wrap">
        <span class="muted">来源: ${escapeHtml(task.context_packet?.source_type ?? "unknown")}</span>
        <span class="muted">Provider: ${escapeHtml(task.provider_id ?? "code_cli")}</span>
        <span class="muted">Model: ${escapeHtml(task.model_id ?? "default")}</span>
      </div>
      <div class="row wrap">
        <span class="muted">重试次数: ${escapeHtml(task.retry_count ?? 0)}</span>
        <span class="muted">成本: ${escapeHtml(formatMoney(task.cost_usd ?? 0))}</span>
        <span class="muted">创建时间: ${escapeHtml(formatDateTime(task.created_at))}</span>
      </div>
    </div>
    ${failureBlock}
  `;
  taskTimeline.innerHTML = (detail.events ?? []).length > 0
    ? detail.events.map((event) => `
        <div class="timeline-item">
          <div class="row">
            <strong>${escapeHtml(event.event_type ?? event.type ?? "event")}</strong>
            <span class="muted">${escapeHtml(formatDateTime(event.ts ?? event.at))}</span>
          </div>
          <p class="muted" style="margin-top:8px;">${escapeHtml(JSON.stringify(event.payload ?? {}, null, 2))}</p>
        </div>
      `).join("")
    : `<div class="timeline-item"><p class="muted">暂无时间线。</p></div>`;
  retryTaskButton.disabled = !task.retryable;
  cancelTaskButton.disabled = !["queued", "running", "cancelling"].includes(task.status);
}

async function refreshTaskDetail() {
  if (!state.selectedTaskId) {
    renderTaskDetail(null);
    return;
  }

  const detailVersion = ++state.detailVersion;
  taskDetailSummary.innerHTML = `<p class="muted">正在加载任务详情…</p>`;
  try {
    const detail = await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}`);
    if (detailVersion !== state.detailVersion) {
      return;
    }
    renderTaskDetail(detail);
  } catch (error) {
    if (detailVersion !== state.detailVersion) {
      return;
    }
    taskDetailSummary.innerHTML = `<p class="muted">详情加载失败：${escapeHtml(error.message)}</p>`;
    taskTimeline.innerHTML = "";
  }
}

function renderApprovals() {
  const approvals = state.workspace.approvals ?? [];
  approvalCount.textContent = `${approvals.filter((item) => item.status === "pending").length}`;
  if (approvals.length === 0) {
    renderEmpty(approvalList, "当前没有待审批项。");
    return;
  }

  approvalList.innerHTML = approvals.map((approval) => `
    <div class="approval-item">
      <div class="row">
        <div>
          <h4>${escapeHtml(approval.proposed_target ?? approval.proposed_action ?? "待审批动作")}</h4>
          <p class="muted">${escapeHtml(approval.source_type ?? "unknown")} · ${escapeHtml(approval.status)}</p>
        </div>
        <span class="chip ${approval.status === "approved" ? "ready" : approval.status === "rejected" ? "danger" : "warning"}">${escapeHtml(approval.status)}</span>
      </div>
      <p class="muted" style="margin-top:10px;">${escapeHtml(approval.preview_text ?? "无预览说明")}</p>
      <div class="row wrap" style="margin-top:12px;">
        <span class="muted">到期: ${escapeHtml(formatDateTime(approval.expires_at))}</span>
        <div class="toolbar">
          <button class="secondary" data-approve-id="${escapeHtml(approval.approval_id)}" ${approval.status !== "pending" ? "disabled" : ""}>批准</button>
          <button class="secondary" data-reject-id="${escapeHtml(approval.approval_id)}" ${approval.status !== "pending" ? "disabled" : ""}>拒绝</button>
        </div>
      </div>
    </div>
  `).join("");

  for (const button of approvalList.querySelectorAll("[data-approve-id]")) {
    button.addEventListener("click", async () => {
      await fetchJson(`/approvals/${encodeURIComponent(button.dataset.approveId)}/approve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ actor: "desktop_console" })
      });
      await refreshWorkspace();
    });
  }

  for (const button of approvalList.querySelectorAll("[data-reject-id]")) {
    button.addEventListener("click", async () => {
      await fetchJson(`/approvals/${encodeURIComponent(button.dataset.rejectId)}/reject`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          actor: "desktop_console",
          reason: "rejected_in_console"
        })
      });
      await refreshWorkspace();
    });
  }
}

function renderSchedules() {
  const schedules = state.workspace.schedules ?? [];
  scheduleCount.textContent = `${schedules.length}`;
  if (schedules.length === 0) {
    renderEmpty(scheduleList, "还没有计划任务。");
    return;
  }

  scheduleList.innerHTML = schedules.map((schedule) => `
    <div class="schedule-item">
      <div class="row">
        <div>
          <h4>${escapeHtml(schedule.name ?? schedule.schedule_id)}</h4>
          <p class="muted">${escapeHtml(schedule.trigger_type ?? "manual")} · ${escapeHtml(schedule.execution_mode ?? "interactive")}</p>
        </div>
        <span class="chip ${schedule.enabled ? "ready" : "warning"}">${schedule.enabled ? "enabled" : "paused"}</span>
      </div>
      <div class="row wrap" style="margin-top:10px;">
        <span class="muted">下次执行: ${escapeHtml(formatDateTime(schedule.next_run_at))}</span>
        <span class="muted">最近状态: ${escapeHtml(schedule.last_run_status ?? "未执行")}</span>
        <button class="secondary" data-run-schedule-id="${escapeHtml(schedule.schedule_id)}">立即执行</button>
      </div>
    </div>
  `).join("");

  for (const button of scheduleList.querySelectorAll("[data-run-schedule-id]")) {
    button.addEventListener("click", async () => {
      await fetchJson(`/schedules/${encodeURIComponent(button.dataset.runScheduleId)}/runs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          triggerPayload: {
            source: "desktop_console"
          }
        })
      });
      await refreshWorkspace();
    });
  }
}

async function loadTemplatePreview(templateId) {
  if (!templateId) {
    templatePreview.textContent = "选择模板后显示。";
    return;
  }
  try {
    const [templatePayload, exportPayload] = await Promise.all([
      fetchJson(`/templates/${encodeURIComponent(templateId)}`),
      fetchJson(`/templates/${encodeURIComponent(templateId)}/export`)
    ]);
    const template = templatePayload.template ?? null;
    templatePreview.textContent = exportPayload.raw ?? "暂无导出内容。";
    templateNameInput.value = template?.name ?? "";
    const prompt = template?.steps?.find((step) => step.kind === "executor")?.inputs?.prompt ?? "";
    templatePromptInput.value = prompt;
    deleteTemplateButton.disabled = template?.template_origin !== "user";
  } catch (error) {
    templatePreview.textContent = `模板读取失败：${error.message}`;
  }
}

async function selectTemplate(templateId) {
  state.selectedTemplateId = templateId;
  renderTemplates();
  await loadTemplatePreview(templateId);
}

function renderTemplates() {
  const templates = state.workspace.templates ?? [];
  templateCount.textContent = `${templates.length}`;
  if (templates.length === 0) {
    renderEmpty(templateList, "还没有模板。");
    state.selectedTemplateId = null;
    templatePreview.textContent = "选择模板后显示。";
    deleteTemplateButton.disabled = true;
    return;
  }

  if (!state.selectedTemplateId || !templates.some((template) => template.id === state.selectedTemplateId)) {
    state.selectedTemplateId = templates[0].id;
  }

  templateList.innerHTML = templates.map((template) => `
    <button class="template-item ${template.id === state.selectedTemplateId ? "selected" : ""}" data-template-id="${escapeHtml(template.id)}" style="text-align:left;">
      <div class="row">
        <div>
          <h4>${escapeHtml(template.name)}</h4>
          <p class="muted">${escapeHtml(template.id)} · ${escapeHtml(template.version ?? "1.0.0")}</p>
        </div>
        <span class="chip ${template.template_origin === "user" ? "ready" : "warning"}">${escapeHtml(template.template_origin ?? "builtin")}</span>
      </div>
    </button>
  `).join("");

  for (const button of templateList.querySelectorAll("[data-template-id]")) {
    button.addEventListener("click", () => {
      void selectTemplate(button.dataset.templateId);
    });
  }
}

function renderBudget() {
  const budget = state.workspace.budget ?? {
    limits: {},
    spent: {}
  };
  const entries = [
    ["月预算上限", formatMoney(budget.limits?.monthly_usd_limit ?? 0)],
    ["单任务上限", formatMoney(budget.limits?.per_task_usd_limit ?? 0)],
    ["本月已花费", formatMoney(budget.spent?.this_month_usd ?? 0)],
    ["输入 Token", `${budget.spent?.this_month_tokens_in ?? 0}`]
  ];
  budgetSummary.innerHTML = entries.map(([label, value]) => `
    <div class="summary-tile">
      <span class="muted">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
  monthlyBudgetInput.value = `${budget.limits?.monthly_usd_limit ?? ""}`;
}

function renderHistory() {
  const results = state.workspace.history ?? [];
  historyPreview.textContent = state.currentHistoryQuery
    ? `关键词：${state.currentHistoryQuery}\n结果数：${results.length}`
    : "还没有搜索结果。";
  if (results.length === 0) {
    renderEmpty(historyList, state.currentHistoryQuery ? "没有匹配结果。" : "输入关键词开始搜索。");
    return;
  }

  historyList.innerHTML = results.map((result) => `
    <button class="history-item" data-history-summary="${escapeHtml(result.metadata?.summary ?? result.text ?? "")}" style="text-align:left;">
      <div class="row">
        <strong>${escapeHtml(result.metadata?.summary ?? result.id)}</strong>
        <span class="muted">${escapeHtml(Number(result.score ?? 0).toFixed(4))}</span>
      </div>
      <p class="muted" style="margin-top:8px;">${escapeHtml(result.metadata?.created_at ?? "未记录时间")}</p>
    </button>
  `).join("");

  for (const button of historyList.querySelectorAll("[data-history-summary]")) {
    button.addEventListener("click", () => {
      historyPreview.textContent = button.dataset.historySummary || "无摘要";
    });
  }
}

function renderPrivacy() {
  const security = state.workspace.security ?? {
    global_kill_switch: false,
    offline_mode: false,
    presenter_mode: false,
    field_redaction: {
      enabled_rules: []
    },
    data_retention: {}
  };

  killSwitchToggle.checked = Boolean(security.global_kill_switch);
  offlineModeToggle.checked = Boolean(security.offline_mode);
  presenterModeToggle.checked = Boolean(security.presenter_mode);
  killSwitchToggle.disabled = state.updatingSecurity;
  offlineModeToggle.disabled = state.updatingSecurity;
  presenterModeToggle.disabled = state.updatingSecurity;

  const rules = security.field_redaction?.enabled_rules ?? [];
  redactionRuleList.innerHTML = rules.length > 0
    ? rules.map((rule) => `
        <div class="surface">
          <strong>${escapeHtml(rule)}</strong>
        </div>
      `).join("")
    : `<div class="surface"><p class="muted" style="margin:0;">当前没有启用脱敏规则。</p></div>`;

  const retentionEntries = Object.entries(security.data_retention ?? {});
  retentionList.innerHTML = retentionEntries.length > 0
    ? retentionEntries.map(([label, value]) => `
        <div class="surface">
          <div class="row">
            <strong>${escapeHtml(label)}</strong>
            <span class="muted">${escapeHtml(value)}</span>
          </div>
        </div>
      `).join("")
    : `<div class="surface"><p class="muted" style="margin:0;">当前没有留存策略。</p></div>`;
}

function renderAudit() {
  const entries = state.workspace.audit ?? [];
  auditCount.textContent = `${entries.length}`;
  if (entries.length === 0) {
    renderEmpty(auditList, "还没有审计记录。");
    return;
  }

  auditList.innerHTML = entries.slice(0, 24).map((entry) => `
    <div class="timeline-item">
      <div class="row">
        <strong>${escapeHtml(entry.event_subtype ?? "event")}</strong>
        <span class="muted">${escapeHtml(formatDateTime(entry.ts))}</span>
      </div>
      <p class="muted" style="margin-top:8px;">task: ${escapeHtml(entry.task_id ?? "n/a")}</p>
    </div>
  `).join("");
}

async function updateSecurityConfig(patch, label) {
  privacyState.textContent = `${label}中…`;
  state.updatingSecurity = true;
  renderPrivacy();
  try {
    const payload = await fetchJson("/security/state", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(patch)
    });
    state.workspace.security = payload.security ?? state.workspace.security;
    privacyState.textContent = `${label}已更新`;
    renderPrivacy();
    await refreshWorkspace();
  } catch (error) {
    privacyState.textContent = `${label}失败：${error.message}`;
  } finally {
    state.updatingSecurity = false;
    renderPrivacy();
  }
}

async function refreshWorkspace() {
  try {
    const shell = await window.ucaShell.getShellStatus();
    state.serviceBaseUrl = shell.serviceBaseUrl ?? state.serviceBaseUrl;

    const historyPromise = state.currentHistoryQuery
      ? fetchJson("/history/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            query: state.currentHistoryQuery,
            limit: 8
          })
        })
      : Promise.resolve({ results: [] });

    const [
      health,
      tasksPayload,
      approvalsPayload,
      schedulesPayload,
      templatesPayload,
      budgetPayload,
      securityPayload,
      auditPayload,
      providersPayload,
      codeCliPayload,
      historyPayload
    ] = await Promise.all([
      fetchJson("/health"),
      fetchJson("/tasks"),
      fetchJson("/approvals"),
      fetchJson("/schedules"),
      fetchJson("/templates"),
      fetchJson("/budget"),
      fetchJson("/security/state"),
      fetchJson("/audit-log"),
      fetchJson("/ai/providers"),
      fetchJson("/ai/code-cli"),
      historyPromise
    ]);

    state.workspace = {
      health,
      tasks: tasksPayload.tasks ?? [],
      approvals: approvalsPayload.approvals ?? [],
      schedules: schedulesPayload.schedules ?? [],
      templates: templatesPayload.templates ?? [],
      budget: budgetPayload.budget ?? null,
      providers: providersPayload.providers ?? [],
      codeCliAdapters: codeCliPayload.adapters ?? [],
      history: historyPayload.results ?? [],
      security: securityPayload.security ?? null,
      audit: auditPayload.entries ?? []
    };

    setRuntimeBadge(true, `Desktop Runtime 已连接 · ${state.serviceBaseUrl}`);
    renderSummary();
    renderOnboarding();
    renderIntegrations();
    renderTasks();
    renderApprovals();
    renderSchedules();
    renderTemplates();
    renderBudget();
    renderHistory();
    renderPrivacy();
    renderAudit();
    await Promise.all([
      refreshTaskDetail(),
      loadTemplatePreview(state.selectedTemplateId)
    ]);
  } catch (error) {
    setRuntimeBadge(false, `Runtime unavailable · ${error.message}`);
  }
}

taskComposer.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitState.textContent = "提交中…";
  try {
    const result = await fetchJson("/task", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sourceApp: "uca.console.desktop",
        captureMode: "desktop_console",
        sourceType: "clipboard",
        text: contextInput.value,
        userCommand: commandInput.value || "请处理这段文本",
        executionMode: "interactive"
      })
    });
    submitState.textContent = `已提交 ${result.task.task_id}`;
    contextInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    submitState.textContent = `提交失败：${error.message}`;
  }
});

for (const button of document.querySelectorAll(".quick-command")) {
  button.addEventListener("click", () => {
    commandInput.value = button.dataset.command ?? "";
    commandInput.focus();
  });
}

for (const button of document.querySelectorAll(".nav-link")) {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.target);
    target?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
}

refreshButton.addEventListener("click", () => {
  void refreshWorkspace();
});

openOverlayButton.addEventListener("click", async () => {
  await window.ucaShell.showWindow("overlay");
});

retryTaskButton.addEventListener("click", async () => {
  if (!state.selectedTaskId) {
    return;
  }
  await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}/retry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      mode: "retry_same"
    })
  });
  await refreshWorkspace();
});

cancelTaskButton.addEventListener("click", async () => {
  if (!state.selectedTaskId) {
    return;
  }
  await fetchJson(`/task/${encodeURIComponent(state.selectedTaskId)}/cancel`, {
    method: "POST"
  });
  await refreshWorkspace();
});

templateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  templateState.textContent = "保存中…";
  try {
    const activeTemplate = state.workspace.templates.find((item) => item.id === state.selectedTemplateId) ?? null;
    const templateName = templateNameInput.value.trim();
    const prompt = templatePromptInput.value.trim();
    const templateId = activeTemplate?.template_origin === "user" && activeTemplate?.id
      ? activeTemplate.id
      : `user.${slugify(templateName)}`;
    const template = {
      schema_version: "1.0",
      id: templateId,
      name: templateName || "未命名模板",
      version: activeTemplate?.version ?? "1.0.0",
      steps: [
        {
          id: "draft",
          kind: "executor",
          target: "fast",
          inputs: {
            prompt
          }
        }
      ]
    };
    await fetchJson("/templates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        actor: "desktop_console",
        template
      })
    });
    templateState.textContent = `已保存 ${template.id}`;
    state.selectedTemplateId = template.id;
    await refreshWorkspace();
  } catch (error) {
    templateState.textContent = `保存失败：${error.message}`;
  }
});

deleteTemplateButton.addEventListener("click", async () => {
  if (!state.selectedTemplateId) {
    return;
  }
  try {
    await fetchJson(`/templates/${encodeURIComponent(state.selectedTemplateId)}`, {
      method: "DELETE"
    });
    templateState.textContent = "模板已删除";
    state.selectedTemplateId = null;
    templateNameInput.value = "";
    templatePromptInput.value = "";
    await refreshWorkspace();
  } catch (error) {
    templateState.textContent = `删除失败：${error.message}`;
  }
});

budgetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  budgetState.textContent = "更新中…";
  try {
    const monthlyLimit = Number(monthlyBudgetInput.value || 0);
    await fetchJson("/budget", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limits: {
          monthly_usd_limit: monthlyLimit
        }
      })
    });
    budgetState.textContent = "预算已更新";
    await refreshWorkspace();
  } catch (error) {
    budgetState.textContent = `更新失败：${error.message}`;
  }
});

historyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.currentHistoryQuery = historyQueryInput.value.trim();
  await refreshWorkspace();
});

killSwitchToggle.addEventListener("change", async () => {
  await updateSecurityConfig({
    global_kill_switch: killSwitchToggle.checked
  }, "Kill switch");
});

offlineModeToggle.addEventListener("change", async () => {
  await updateSecurityConfig({
    offline_mode: offlineModeToggle.checked
  }, "离线模式");
});

presenterModeToggle.addEventListener("change", async () => {
  await updateSecurityConfig({
    presenter_mode: presenterModeToggle.checked
  }, "演示模式");
});

window.ucaShell.onShortcutTriggered((payload) => {
  submitState.textContent = `快捷键触发：${payload.shortcutId}`;
});

window.ucaShell.onShellReady(() => {
  void refreshWorkspace();
});

window.ucaShell.onWindowFocused((payload) => {
  if (payload.windowId === "console") {
    void refreshWorkspace();
  }
});

void refreshWorkspace();
setInterval(() => {
  void refreshWorkspace();
}, 6000);
