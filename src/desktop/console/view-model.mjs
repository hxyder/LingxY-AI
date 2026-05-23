import { IPC_CHANNELS } from "../shared/manifest.mjs";

function summarizeTasks(tasks = []) {
  const today = new Date().toISOString().slice(0, 10);
  const running = tasks.filter((task) => ["running", "cancelling"].includes(task.status)).length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const todaySuccess = tasks.filter((task) => task.status === "success" && `${task.updated_at ?? task.created_at}`.startsWith(today)).length;
  const todayFailed = tasks.filter((task) => ["failed", "cancelled"].includes(task.status) && `${task.updated_at ?? task.created_at}`.startsWith(today)).length;

  return {
    running,
    queued,
    today_success: todaySuccess,
    today_failed: todayFailed
  };
}

function buildIntegrationCards({ health = null, codeCliAdapters = [], providers = [] } = {}) {
  const kimi = health?.kimi ?? codeCliAdapters.find((adapter) => adapter.id === "kimi-code-cli") ?? null;
  const browserNative = health?.browserNativeHost ?? null;
  const office = health?.office ?? null;
  const primaryProvider = providers.find((provider) => provider.configured && provider.available) ?? null;

  return [
    {
      id: "kimi-code-cli",
      title: "Kimi Code CLI",
      status: kimi?.available ? "ready" : kimi?.configured ? "configured" : "missing",
      detail: kimi?.command ?? kimi?.detail ?? "Not detected",
      recommended: true
    },
    {
      id: "providers",
      title: "AI Providers",
      status: primaryProvider ? "ready" : providers.some((provider) => provider.configured) ? "configured" : "optional",
      detail: primaryProvider
        ? `${primaryProvider.displayName} ready`
        : providers.some((provider) => provider.configured)
          ? "Configured but not active"
          : "Code CLI is the primary path for this phase",
      recommended: false
    },
    {
      id: "browser",
      title: "Browser Entry",
      status: browserNative?.installed ? "ready" : "optional",
      detail: browserNative?.detail ?? "Native host / extension not yet reported",
      recommended: false
    },
    {
      id: "office",
      title: "Office Entry",
      status: office?.available ? "ready" : "optional",
      detail: office?.detail ?? "Office bridge not yet reported",
      recommended: false
    }
  ];
}

export function createConsoleViewModel({
  tasks = [],
  budgetState = null,
  health = null,
  codeCliAdapters = [],
  providers = []
} = {}) {
  const summary = summarizeTasks(tasks);
  const budget = budgetState ?? {
    spent: {
      this_month_usd: 0
    },
    limits: {
      monthly_usd_limit: 0
    }
  };

  return {
    windowId: "console",
    route: "/console",
    defaultState: "hidden",
    panes: ["task-list", "task-detail", "timeline", "artifacts", "settings", "schedules", "pending-approvals", "template-editor", "dag-view", "budget-dashboard", "history-search"],
    summaryCards: ["running", "queued", "today_success", "today_failed", "monthly_budget_usage"],
    filters: ["status", "source_type", "executor", "template_id", "created_at"],
    detailSections: ["summary", "timeline", "logs", "artifacts", "retries", "cost", "children"],
    metricsEndpoint: "/metrics",
    schedulesEndpoint: "/schedules",
    approvalsEndpoint: "/approvals",
    templatesEndpoint: "/templates",
    budgetEndpoint: "/budget",
    historySearchEndpoint: "/history/search",
    healthEndpoint: "/health",
    providersEndpoint: "/ai/providers",
    codeCliEndpoint: "/ai/code-cli",
    supportsEventReplay: true,
    summary: {
      ...summary,
      monthly_budget_usage: budget.spent?.this_month_usd ?? 0,
      monthly_budget_limit: budget.limits?.monthly_usd_limit ?? 0
    },
    integrationCards: buildIntegrationCards({
      health,
      codeCliAdapters,
      providers
    }),
    recommendedEntry: "kimi-code-cli",
    subscribedChannels: [
      IPC_CHANNELS.consoleOpen,
      IPC_CHANNELS.shellStatus
    ]
  };
}
