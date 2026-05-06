import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateSubmissionBoundary } from "../../src/service/core/policy/submission-boundary.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";
import { submitBrowserTask } from "../../src/service/core/browser-submission.mjs";
import { submitCompositeTask } from "../../src/service/core/composite-submission.mjs";
import { submitContextTask } from "../../src/service/core/context-submission.mjs";
import { submitFileTask } from "../../src/service/core/file-submission.mjs";
import { submitImageTask } from "../../src/service/core/image-submission.mjs";
import { submitOfficeTask } from "../../src/service/core/office-submission.mjs";
import { submitScreenshotTask } from "../../src/service/core/screenshot-submission.mjs";
import { submitTaskWithConversation } from "../../src/service/core/task-runtime.mjs";
import { submitTaskFromBody } from "../../src/service/core/http-routes/task-routes.mjs";

function createRuntime({ enqueueAccepted = true } = {}) {
  return {
    store: createInMemoryStoreScaffold(),
    queue: {
      enqueue() { return { accepted: enqueueAccepted, dedupedTaskId: null }; },
      markRunning() {},
      markFinished() {}
    },
    eventBus: {
      publish() {}
    },
    executors: []
  };
}

test("submission boundary stamps and audits tasks without blocking execution", () => {
  const runtime = createRuntime();
  const { task } = submitTaskWithConversation({
    runtime,
    route: { intent: "act", executor: "tool_using", requires_confirmation: false, intent_tags: [] },
    contextPacket: {
      source_type: "clipboard",
      source_app: "uca.test",
      capture_mode: "manual",
      text: "Open the app"
    },
    userCommand: "Open the app",
    executionMode: "interactive",
    executorOverride: "tool_using",
    submissionKind: "action_tool"
  });

  assert.equal(task.status, "queued");
  assert.equal(task.submission_boundary.submission_kind, "action_tool");
  assert.equal(task.submission_boundary.decision, "audit_only");
  assert.equal(task.submission_boundary.blocking, false);
  assert.match(task.submission_boundary.reasons.join("\n"), /executor_override:tool_using/);

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.task_id, task.task_id);
  assert.equal(audit.payload.submission_kind, "action_tool");
  assert.equal(audit.payload.decision, "audit_only");
});

test("submission boundary pure evaluator records missing kind and forbidden policy groups", () => {
  const decision = evaluateSubmissionBoundary({
    submissionKind: "",
    executorOverride: null,
    contextPacket: {},
    task: {
      task_spec: {
        tool_policy: {
          policy_groups: {
            external_web_read: { mode: "forbidden", reason: "local only" }
          }
        }
      }
    }
  });

  assert.equal(decision.decision, "audit_only");
  assert.equal(decision.risk, "medium");
  assert.deepEqual(decision.required_guards, ["policy_group:external_web_read"]);
  assert.match(decision.reasons.join("\n"), /missing_submission_kind/);
  assert.match(decision.reasons.join("\n"), /forbidden_policy_group:external_web_read/);
});

test("submission boundary blocks declared direct tools forbidden by task policy", () => {
  const decision = evaluateSubmissionBoundary({
    submissionKind: "action_tool",
    executorOverride: "tool_using",
    contextPacket: {},
    boundaryContext: {
      requestedToolIds: ["web_search"]
    },
    task: {
      executor: "tool_using",
      task_spec: {
        goal: "search",
        tool_policy: {
          policy_groups: {
            external_web_read: { mode: "forbidden", reason: "local only" }
          }
        }
      }
    }
  });

  assert.equal(decision.decision, "block");
  assert.equal(decision.blocking, true);
  assert.equal(decision.risk, "high");
  assert.deepEqual(decision.requested_tools, ["web_search"]);
  assert.deepEqual(decision.blocked_tools, [{
    tool_id: "web_search",
    policy_source: "group:external_web_read",
    reason: "local only"
  }]);
  assert.match(decision.reasons.join("\n"), /requested_tool_forbidden:web_search/);
  assert.match(decision.audit_payload.reasons.join("\n"), /requested_tool_forbidden:web_search/);
});

test("context submission declares its submission kind through the central boundary", async () => {
  const runtime = createRuntime({ enqueueAccepted: false });
  const { task } = await submitContextTask({
    runtime,
    userCommand: "Summarize this context",
    executionMode: "interactive",
    background: true,
    skipPlanLayer: true,
    contextPacket: {
      source_type: "text",
      source_app: "uca.test",
      capture_mode: "manual",
      text: "Some captured context."
    }
  });

  assert.equal(task.submission_boundary.submission_kind, "context");

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.submission_kind, "context");
});

test("context submission inline evidence gate blocks unreadable file metadata before executor", async () => {
  let executorCalled = false;
  const runtime = createRuntime();
  runtime.executors = [{
    id: "fast",
    async *execute() {
      executorCalled = true;
      yield { event_type: "inline_result", payload: { text: "should not run" } };
    }
  }];

  const { task, taskEvents } = await submitContextTask({
    runtime,
    userCommand: "总结这个文件",
    executionMode: "interactive",
    background: true,
    skipPlanLayer: true,
    contentEvidenceGateMode: "inline_context_only",
    contextPacket: {
      source_type: "file",
      source_app: "uca.test",
      capture_mode: "manual",
      text: "",
      file_paths: ["E:\\docs\\scan.pdf"],
      selection_metadata: {
        content_evidence: [{
          source_kind: "local_file_metadata",
          coverage_scope: "file_metadata",
          locator: "E:\\docs\\scan.pdf",
          extraction_mode: "pdf_ocr_unavailable",
          content_extracted: false
        }]
      }
    }
  });

  assert.equal(task.status, "failed");
  assert.equal(executorCalled, false);
  assert.match(task.failure_user_message, /does not contain readable text|没有/);
  assert.ok(taskEvents.some((event) =>
    event.event_type === "step_warning"
    && event.payload?.step === "content_evidence_gate"
  ));
});

async function withEmptyProviderConfig(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "uca-submission-boundary-"));
  const configPath = path.join(dir, "runtime.json");
  const originalConfigPath = process.env.UCA_CONFIG_PATH;
  const originalForceBootKimi = process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
  await writeFile(configPath, JSON.stringify({ ai: { customProviders: [], taskRouting: {} } }));
  process.env.UCA_CONFIG_PATH = configPath;
  process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = "1";
  try {
    return await fn(dir);
  } finally {
    if (originalConfigPath === undefined) delete process.env.UCA_CONFIG_PATH;
    else process.env.UCA_CONFIG_PATH = originalConfigPath;
    if (originalForceBootKimi === undefined) delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
    else process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = originalForceBootKimi;
    await rm(dir, { recursive: true, force: true });
  }
}

test("file submission direct path declares its submission kind through the central boundary", async () => {
  await withEmptyProviderConfig(async (dir) => {
    const filePath = path.join(dir, "notes.txt");
    await writeFile(filePath, "local file content", "utf8");
    const runtime = createRuntime({ enqueueAccepted: false });

    const { task } = await submitFileTask({
      runtime,
      filePaths: [filePath],
      userCommand: "总结这个文件",
      executionMode: "interactive"
    });

    assert.equal(task.submission_boundary.submission_kind, "file");

    const audit = runtime.store.listAuditLogs()
      .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
    assert.ok(audit);
    assert.equal(audit.payload.submission_kind, "file");
  });
});

test("office submission declares its submission kind through the central boundary", async () => {
  const runtime = createRuntime({ enqueueAccepted: false });
  const { task } = await submitOfficeTask({
    runtime,
    userCommand: "Summarize this selection",
    executionMode: "interactive",
    capture: {
      hostProcess: "WINWORD.EXE",
      officeApp: "Word",
      documentName: "Draft.docx",
      documentPath: "E:\\fixtures\\Draft.docx",
      selectionText: "Selected office text",
      selectionMetadata: { selected_text: "Selected office text" }
    }
  });

  assert.equal(task.submission_boundary.submission_kind, "office");

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.submission_kind, "office");
});

test("image submission declares its submission kind through the central boundary", async () => {
  await withEmptyProviderConfig(async (dir) => {
    const imagePath = path.join(dir, "pixel.png");
    await writeFile(
      imagePath,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
    );
    const runtime = createRuntime({ enqueueAccepted: false });

    const { task } = await submitImageTask({
      runtime,
      imagePaths: [imagePath],
      userCommand: "分析这张图",
      executionMode: "interactive"
    });

    assert.equal(task.submission_boundary.submission_kind, "image");

    const audit = runtime.store.listAuditLogs()
      .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
    assert.ok(audit);
    assert.equal(audit.payload.submission_kind, "image");
  });
});

test("composite submission declares its submission kind through the central boundary", async () => {
  const runtime = createRuntime();
  const { task } = await submitCompositeTask({
    runtime,
    userCommand: "Do these steps",
    executionMode: "interactive",
    contextPacket: {
      source_type: "composite_test",
      source_app: "uca.test",
      capture_mode: "manual",
      text: "Composite parent"
    },
    subtasks: [],
    submitChild: async () => null
  });

  assert.equal(task.submission_boundary.submission_kind, "composite");

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.submission_kind, "composite");
});

test("task route preserves mixed file and image attachments in one context envelope", async () => {
  const runtime = createRuntime({ enqueueAccepted: false });
  const { task } = await submitTaskFromBody(runtime, {
    userCommand: "Analyze these materials together",
    filePaths: ["E:\\docs\\brief.pdf"],
    imagePaths: ["E:\\shots\\diagram.png"],
    sourceApp: "uca.test",
    captureMode: "drag_drop",
    background: true
  });

  assert.equal(task.submission_boundary.submission_kind, "context");
  assert.deepEqual(task.context_packet.file_paths, ["E:\\docs\\brief.pdf"]);
  assert.deepEqual(task.context_packet.image_paths, ["E:\\shots\\diagram.png"]);
  assert.equal(task.context_packet.selection_metadata.attachment_mode, "mixed");

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.submission_kind, "context");
});

test("browser submission declares its submission kind through the central boundary", async () => {
  const runtime = createRuntime({ enqueueAccepted: false });
  const { task } = await submitBrowserTask({
    runtime,
    userCommand: "Summarize this page",
    executionMode: "interactive",
    background: true,
    capture: {
      sourceType: "webpage",
      browser: "uca.test.browser",
      url: "https://example.com/article",
      pageTitle: "Example Article"
    }
  });

  assert.equal(task.submission_boundary.submission_kind, "browser");

  const audit = runtime.store.listAuditLogs()
    .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
  assert.ok(audit);
  assert.equal(audit.payload.submission_kind, "browser");
});

test("screenshot submission preserves its entrypoint kind through the image pipeline", async () => {
  await withEmptyProviderConfig(async (dir) => {
    const screenshotPath = path.join(dir, "capture.png");
    await writeFile(
      screenshotPath,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64")
    );
    const runtime = createRuntime({ enqueueAccepted: false });

    const { task } = await submitScreenshotTask({
      runtime,
      screenshotPath,
      userCommand: "总结这张截图",
      executionMode: "interactive"
    });

    assert.equal(task.submission_boundary.submission_kind, "screenshot");

    const audit = runtime.store.listAuditLogs()
      .find((entry) => entry.event_subtype === "submission.boundary_evaluated");
    assert.ok(audit);
    assert.equal(audit.payload.submission_kind, "screenshot");
  });
});
