import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createConsoleViewModel } from "../src/desktop/console/view-model.mjs";
import { buildFirstRunWizardViewModel } from "../src/desktop/console/first_run_wizard/view-model.mjs";
import { buildTaskDetailViewModel } from "../src/desktop/console/task-detail/view-model.mjs";

const today = new Date().toISOString().slice(0, 10);

const tasks = [
  {
    task_id: "task_running",
    created_at: `${today}T10:00:00.000Z`,
    updated_at: `${today}T10:01:00.000Z`,
    status: "running",
    progress: 0.5,
    current_step: "kimi_cli",
    retry_count: 0,
    retryable: true,
    executor: "kimi",
    provider_id: "kimi-code-cli",
    model_id: "kimi-cli",
    cost_usd: 0,
    usage_summary: {
      tokens_in: 0,
      tokens_out: 0
    },
    context_packet: {
      source_type: "file_group",
      source_app: "explorer.exe",
      capture_mode: "shell_menu"
    }
  },
  {
    task_id: "task_success",
    created_at: `${today}T11:00:00.000Z`,
    updated_at: `${today}T11:02:00.000Z`,
    status: "success",
    progress: 1,
    current_step: null,
    retry_count: 1,
    retryable: true,
    executor: "fast",
    provider_id: "openai.gpt-5.4-mini",
    model_id: "gpt-5.4-mini",
    cost_usd: 0.012,
    usage_summary: {
      tokens_in: 1200,
      tokens_out: 300
    },
    context_packet: {
      source_type: "clipboard",
      source_app: "uca.console",
      capture_mode: "manual"
    }
  }
];

const consoleVm = createConsoleViewModel({
  tasks,
  budgetState: {
    limits: {
      monthly_usd_limit: 50
    },
    spent: {
      this_month_usd: 1.25
    }
  },
  health: {
    kimi: {
      id: "kimi-code-cli",
      available: true,
      command: "C:\\Users\\der\\.local\\bin\\kimi.exe"
    }
  },
  codeCliAdapters: [
    {
      id: "kimi-code-cli",
      available: true,
      configured: true,
      command: "C:\\Users\\der\\.local\\bin\\kimi.exe"
    }
  ],
  providers: [
    {
      id: "openai.gpt-5.4-mini",
      displayName: "OpenAI GPT-5.4 Mini",
      available: true,
      configured: true
    }
  ]
});

assert.equal(consoleVm.summary.running, 1);
assert.equal(consoleVm.summary.today_success >= 1, true);
assert.equal(consoleVm.recommendedEntry, "kimi-code-cli");
assert.ok(consoleVm.integrationCards.some((card) => card.id === "kimi-code-cli" && card.status === "ready"));

const wizardVm = buildFirstRunWizardViewModel({
  permissions: {
    clipboard: true
  },
  integrations: {
    fileEntry: {
      installed: true,
      detail: "uca-cli is installed"
    }
  },
  codeCliAdapters: [
    {
      id: "kimi-code-cli",
      available: true,
      configured: true
    }
  ],
  providers: []
});

assert.equal(wizardVm.steps.length, 5);
assert.equal(wizardVm.recommendedPath, "code_cli");
assert.equal(wizardVm.nextAction, "open_console");
assert.equal(wizardVm.steps.find((step) => step.id === "llm_backend")?.status, "ready");

const detailVm = buildTaskDetailViewModel(tasks[1], [
  {
    event_id: "evt_1",
    ts: `${today}T11:01:00.000Z`,
    event_type: "usage_recorded",
    payload: {
      usd: 0.012
    }
  }
], []);

assert.equal(detailVm.provider, "openai.gpt-5.4-mini");
assert.equal(detailVm.cost.usd, 0.012);
assert.equal(detailVm.canRetry, true);
assert.equal(detailVm.canCancel, false);

const consoleRenderer = readFileSync(new URL("../src/desktop/renderer/console.js", import.meta.url), "utf8");
const sharedChatCss = readFileSync(new URL("../src/desktop/renderer/shared-chat.css", import.meta.url), "utf8");
assert.match(consoleRenderer, /function appendConsoleChatProgress/);
assert.match(consoleRenderer, /function appendConsoleChatLiveProgress/);
assert.match(consoleRenderer, /chat-progress-card/);
assert.match(consoleRenderer, /closeConsoleChatProgressCard/);
assert.match(consoleRenderer, /const CONSOLE_CHAT_PROGRESS_EVENT_TYPES = new Set/);
assert.match(consoleRenderer, /"step_started"[\s\S]{0,240}"log"/);
assert.match(consoleRenderer, /function shouldAppendConsoleChatProgressFrame\(frame\)/);
assert.match(consoleRenderer, /card\.open = true;/);
assert.match(consoleRenderer, /closeConsoleChatProgressCard folds it after terminal/);
assert.match(consoleRenderer, /frame\.event === "reasoning_delta"[\s\S]{0,220}appendConsoleChatLiveProgress\(taskId,\s*"reasoning_delta"/);
assert.doesNotMatch(consoleRenderer, /consoleChatProgressEventIds = new Set\(\);\s*closeConsoleChatProgressCard\(\);/);
assert.match(
  consoleRenderer,
  /frame\.event === "inline_result"[\s\S]{0,360}appendConsoleChatFinalText\(taskId[\s\S]{0,180}clearConsoleChatTerminalBuffers\(taskId\)/,
  "inline_result must finalize the streaming answer before clearing buffers so it cannot render a duplicate/incomplete assistant bubble"
);
assert.match(consoleRenderer, /event:\s*"submission_received"[\s\S]{0,120}已收到请求，正在创建任务/u);
assert.match(consoleRenderer, /event:\s*"task_created"[\s\S]{0,160}任务已创建，正在执行/u);
assert.doesNotMatch(consoleRenderer, /appendConsoleChatMessage\("system",\s*"已收到请求，正在创建任务/u);
assert.match(sharedChatCss, /\.chat-progress-card/);

console.log("Console UI view-model verification passed.");
