import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { evaluateToolRisk } from "../src/service/action_tools/risk_matrix.mjs";
import { ACTION_TOOL_SCHEMAS } from "../src/service/action_tools/schemas/index.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import { submitActionToolTask } from "../src/service/core/action-tool-submission.mjs";
import { createEventBusScaffold } from "../src/service/core/events/event-bus.mjs";
import { createTaskQueueScaffold } from "../src/service/core/queue/task-queue.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createArtifactStore } from "../src/service/store/artifact-store.mjs";
import { buildToolCallConfirmViewModel } from "../src/desktop/console/tool-call-confirm/view-model.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createRuntime(name, extras = {}) {
  return {
    store: createInMemoryStoreScaffold(),
    eventBus: createEventBusScaffold(),
    queue: createTaskQueueScaffold(),
    artifactStore: createArtifactStore({ baseDir: path.join(repoRoot, ".tmp", "verify-action-tools", name) }),
    actionToolRegistry: createActionToolRegistry(BUILTIN_ACTION_TOOLS),
    toolContext: {
      allowedApps: ["notepad.exe"],
      allowedRoots: [path.join(repoRoot, "tests")],
      clipboardText: "clipboard sample"
    },
    ...extras
  };
}

assert.equal(BUILTIN_ACTION_TOOLS.length, 12);
assert.equal(Object.keys(ACTION_TOOL_SCHEMAS).length, 12);

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
assert.equal(registry.list().length, 12);
assert.equal(evaluateToolRisk(registry.get("send_email_smtp"), { to: ["a@example.com"], subject: "x", body: "y" }, {}).requires_confirmation, true);

let interactivePlannerState = 0;
const interactiveRuntime = createRuntime("interactive", {
  toolPlanner() {
    if (interactivePlannerState === 0) {
      interactivePlannerState += 1;
      return {
        type: "tool_call",
        tool: "send_email_smtp",
        args: {
          to: ["advisor@example.com"],
          subject: "Draft",
          body: "First pass"
        }
      };
    }
    return {
      type: "final",
      text: "Interactive tool flow completed."
    };
  },
  confirmationHandler() {
    return {
      decision: "edit",
      args: {
        to: ["advisor@example.com"],
        subject: "Edited Draft",
        body: "Edited body"
      }
    };
  }
});

const interactiveResult = await submitActionToolTask({
  userCommand: "请发送邮件给导师",
  executionMode: "interactive",
  runtime: interactiveRuntime
});
assert.equal(interactiveResult.task.status, "success");
assert.equal(interactiveRuntime.store.listAuditLogs().some((entry) => entry.event_subtype === "tool.call"), true);

const unattendedRuntime = createRuntime("unattended", {
  toolPlanner() {
    return {
      type: "tool_call",
      tool: "file_op",
      args: {
        operation: "delete",
        path: path.join(repoRoot, "tests", "fixtures", "sample-note.md")
      }
    };
  }
});
const unattendedResult = await submitActionToolTask({
  userCommand: "删除这个文件",
  executionMode: "unattended_safe",
  runtime: unattendedRuntime
});
assert.equal(unattendedResult.task.status, "partial_success");
assert.equal(unattendedRuntime.store.listAuditLogs().some((entry) => entry.event_subtype === "tool.denied"), true);

const approvalRuntime = createRuntime("approval", {
  toolPlanner() {
    return {
      type: "tool_call",
      tool: "send_email_smtp",
      args: {
        to: ["ops@example.com"],
        subject: "Queued approval",
        body: "Pending send"
      }
    };
  }
});
const approvalResult = await submitActionToolTask({
  userCommand: "定时发送邮件",
  executionMode: "approval_required",
  runtime: approvalRuntime
});
assert.equal(approvalResult.task.sub_status, "waiting_external_decision");
assert.equal(approvalRuntime.store.listPendingApprovals().length, 1);

const screenshotResult = await registry.call("take_screenshot", { label: "capture-1" }, {
  outputDir: path.join(repoRoot, ".tmp", "verify-action-tools", "artifacts")
});
assert.equal(screenshotResult.artifact_paths.length, 1);

const confirmVm = buildToolCallConfirmViewModel({
  toolId: "send_email_smtp",
  args: { to: ["ops@example.com"] },
  risk: {
    risk_level: "high",
    requires_confirmation: true
  },
  mode: "interactive"
});
assert.equal(confirmVm.actions.includes("deny"), true);

console.log("Action tools and execution modes verification passed.");
