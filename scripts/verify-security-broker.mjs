import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { submitActionToolTask } from "../src/service/core/action-tool-submission.mjs";
import { submitBrowserTask } from "../src/service/core/browser-submission.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { createSecurityBroker } from "../src/service/security/broker.mjs";
import { redactText, unredactText } from "../src/service/security/rules/pii_redaction.mjs";
import { buildPrivacySettingsViewModel } from "../src/desktop/console/privacy_settings/view-model.mjs";
import { buildFirstRunWizardViewModel } from "../src/desktop/console/first_run_wizard/view-model.mjs";
import { buildAuditLogViewerModel } from "../src/desktop/console/audit_log_viewer/view-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createRuntime(name, config = {}) {
  const runtime = {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-security", name) }),
    actionToolRegistry: createActionToolRegistry(BUILTIN_ACTION_TOOLS),
    toolContext: {
      allowedApps: ["notepad.exe"],
      allowedRoots: [path.join(repoRoot, "tests")]
    }
  };
  runtime.securityBroker = createSecurityBroker({ runtime, config });
  return runtime;
}

const redaction = redactText("Contact me at alice@example.com and 13800138000");
assert.ok(Object.keys(redaction.map).length >= 2);
assert.match(redaction.redactedText, /\[EMAIL_1\]/);
assert.equal(unredactText(redaction.redactedText, redaction.map), "Contact me at alice@example.com and 13800138000");

const protectedRuntime = createRuntime("protected", {
  blocklist: {
    process_names: ["chrome.exe"],
    window_title_patterns: [],
    url_domains: []
  }
});
const blockedBrowser = await submitBrowserTask({
  capture: {
    sourceType: "text_selection",
    browser: "chrome.exe",
    url: "https://example.com",
    text: "sensitive selection"
  },
  userCommand: "请总结这段网页内容",
  runtime: protectedRuntime
});
assert.equal(blockedBrowser.task.status, "failed");

const killSwitchRuntime = createRuntime("kill-switch");
killSwitchRuntime.securityBroker.setConfig({ global_kill_switch: true });
const killSwitchResult = await submitActionToolTask({
  userCommand: "请发送邮件给导师",
  executionMode: "interactive",
  runtime: killSwitchRuntime
});
assert.equal(killSwitchResult.task.status, "failed");

const offlineRuntime = createRuntime("offline", {
  offline_mode: true
});
let offlinePlannerCalled = false;
offlineRuntime.toolPlanner = () => {
  offlinePlannerCalled = true;
  return {
    type: "tool_call",
    tool: "web_search",
    args: {
      query: "latest gpt review"
    }
  };
};
const offlineResult = await submitActionToolTask({
  userCommand: "请搜索最新 GPT 评测",
  executionMode: "interactive",
  runtime: offlineRuntime
});
assert.equal(offlinePlannerCalled, true);
assert.equal(offlineResult.task.status, "partial_success");

const presenterRuntime = createRuntime("presenter");
const presenterState = presenterRuntime.securityBroker.togglePresenterMode("user");
assert.equal(presenterState.active, true);
const presenterBlocked = await submitActionToolTask({
  userCommand: "请发送邮件给导师",
  executionMode: "interactive",
  runtime: presenterRuntime
});
assert.equal(presenterBlocked.task.status, "failed");

const recoveryRuntime = createRuntime("recovery");
recoveryRuntime.store.insertTask({
  task_id: "task_redacted",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  status: "running",
  sub_status: "streaming",
  progress: 0.5,
  current_step: "llm_call",
  completed_steps: [],
  remaining_steps_estimate: [],
  failure_category: null,
  failure_user_message: null,
  failure_internal_log_excerpt: null,
  retryable: true,
  parent_task_id: null,
  retry_count: 0,
  executor_history: [],
  intent: "summarize",
  executor: "fast",
  user_command: "please summarize",
  execution_mode: "interactive",
  context_packet: {
    schema_version: "1.0",
    context_id: "ctx_redacted",
    trace_id: "trace_redacted",
    source_type: "clipboard",
    source_app: "uca.console",
    capture_mode: "manual",
    security_level: "internal",
    redaction_applied: true,
    text: "[EMAIL_1]",
    captured_at: new Date().toISOString()
  }
});
const recovered = recoveryRuntime.securityBroker.recoverRedactionStateLost();
assert.equal(recovered.length, 1);
assert.equal(recoveryRuntime.store.getTask("task_redacted").failure_category, "redaction_state_lost");

const privacyVm = buildPrivacySettingsViewModel(recoveryRuntime.securityBroker.getConfig());
assert.equal(typeof privacyVm.presenterMode, "boolean");
const wizardVm = buildFirstRunWizardViewModel();
assert.equal(wizardVm.steps.length, 5);
const auditVm = buildAuditLogViewerModel(recoveryRuntime.store.listAuditLogs());
assert.equal(auditVm.total >= 1, true);

console.log("Security broker and privacy controls verification passed.");
