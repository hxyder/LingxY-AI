import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  shouldUseFileInventoryContext,
  submitFileTask
} from "../../src/service/core/file-submission.mjs";
import { createInMemoryStoreScaffold } from "../../src/service/core/store/memory-store.mjs";

function createRuntime() {
  return {
    store: createInMemoryStoreScaffold(),
    queue: {
      enqueue() { return { accepted: true, dedupedTaskId: null }; },
      markRunning() {},
      markFinished() {}
    },
    eventBus: { publish() {} },
    executors: [],
    kimiRuntime: {
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      env: process.env,
      transport: "stdio",
      model: "test-code-cli",
      maxRuntimeSeconds: 1
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createResolvedFilePacket(filePath, text = "local file content") {
  return {
    schema_version: "1.0",
    context_id: "ctx_test",
    trace_id: "trace_test",
    source_type: "file",
    source_app: "explorer.exe",
    capture_mode: "shell_menu",
    file_paths: [filePath],
    original_file_paths: [filePath],
    file_metadata: [{ path: filePath, size: text.length, mime: "text/plain", extraction_mode: "test" }],
    image_paths: [],
    text,
    selection_metadata: {}
  };
}

async function withApiProviderConfig(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-provider-"));
  const configPath = path.join(dir, "runtime.json");
  const originalConfigPath = process.env.UCA_CONFIG_PATH;
  const originalForceBootKimi = process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
  await writeFile(configPath, JSON.stringify({
    ai: {
      customProviders: [{
        id: "test-api",
        name: "Test API",
        kind: "openai",
        apiKey: "test-key",
        baseUrl: "https://example.invalid/v1",
        model: "test-model"
      }],
      taskRouting: {
        chat: { providerId: "test-api", model: "test-model" },
        file_analysis: { providerId: "test-api", model: "test-model" }
      }
    }
  }));
  process.env.UCA_CONFIG_PATH = configPath;
  delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
  try {
    return await fn();
  } finally {
    if (originalConfigPath === undefined) delete process.env.UCA_CONFIG_PATH;
    else process.env.UCA_CONFIG_PATH = originalConfigPath;
    if (originalForceBootKimi === undefined) delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
    else process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = originalForceBootKimi;
    await rm(dir, { recursive: true, force: true });
  }
}

async function withBootCliRuntime(fn) {
  const originalForceBootKimi = process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
  process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = "1";
  try {
    return await fn();
  } finally {
    if (originalForceBootKimi === undefined) delete process.env.UCA_FORCE_BOOT_KIMI_RUNTIME;
    else process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = originalForceBootKimi;
  }
}

test("file submission can create a visible background task before file ingest completes", async () => {
  await withBootCliRuntime(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-submission-"));
    try {
      const filePath = path.join(dir, "notes.txt");
      await writeFile(filePath, "local file content", "utf8");
      const runtime = createRuntime();
      let buildCalled = false;
      let releaseBuild;
      const buildReleased = new Promise((resolve) => { releaseBuild = resolve; });

      const result = await submitFileTask({
        runtime,
        filePaths: [filePath],
        userCommand: "总结这个文件",
        executionMode: "interactive",
        background: true,
        async buildFileContextPacketImpl({ onProgress }) {
          buildCalled = true;
          onProgress?.({ phase: "file_ingest_started", total: 1 });
          await buildReleased;
          onProgress?.({ phase: "file_ingest_finished", completed: 1, total: 1 });
          return {
            schema_version: "1.0",
            context_id: "ctx_test",
            trace_id: "trace_test",
            source_type: "file",
            source_app: "explorer.exe",
            capture_mode: "shell_menu",
            file_paths: [filePath],
            original_file_paths: [filePath],
            file_metadata: [{ path: filePath, size: 18, mime: "text/plain", extraction_mode: "test" }],
            image_paths: [],
            text: "local file content",
            selection_metadata: {}
          };
        }
      });

      assert.equal(result.background, true);
      assert.equal(buildCalled, false);
      const events = runtime.store.getTaskEvents(result.task.task_id);
      assert.ok(events.some((event) => event.event_type === "task_created"));
      assert.equal(result.task.context_packet.selection_metadata.file_ingest_status, "pending");

      await delay(0);
      assert.equal(buildCalled, true);
      releaseBuild();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("context-like file submissions create one visible task before ingest completes", async () => {
  await withBootCliRuntime(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-context-like-"));
    try {
      const filePath = path.join(dir, "notes.txt");
      await writeFile(filePath, "local file content", "utf8");
      const runtime = createRuntime();
      runtime.executors = [{
        id: "tool_using",
        async *execute() {
          yield { event_type: "success", payload: { text: "done" } };
        }
      }];
      let buildCalled = false;
      let releaseBuild;
      const buildReleased = new Promise((resolve) => { releaseBuild = resolve; });

      const submitPromise = submitFileTask({
        runtime,
        filePaths: [filePath],
        userCommand: "这是什么",
        executionMode: "interactive",
        background: true,
        async buildFileContextPacketImpl({ onProgress }) {
          buildCalled = true;
          onProgress?.({ phase: "file_ingest_started", total: 1 });
          await buildReleased;
          onProgress?.({ phase: "file_ingest_finished", completed: 1, total: 1 });
          return createResolvedFilePacket(filePath);
        }
      });

      const result = await Promise.race([
        submitPromise,
        delay(30).then(() => null)
      ]);
      assert.ok(result, "file submission should return before context-like ingest completes");
      assert.equal(result.background, true);
      assert.equal(runtime.store.listTasks().length, 1);
      assert.ok(runtime.store.getTaskEvents(result.task.task_id).some((event) => event.event_type === "task_created"));

      await delay(0);
      assert.equal(buildCalled, true);
      releaseBuild();
      await submitPromise;
      await delay(20);
      assert.equal(runtime.store.listTasks().length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("API-provider file submissions create one visible task before ingest completes", async () => {
  await withApiProviderConfig(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-api-"));
    try {
      const filePath = path.join(dir, "notes.txt");
      await writeFile(filePath, "local file content", "utf8");
      const runtime = createRuntime();
      runtime.kimiRuntime = null;
      runtime.executors = [{
        id: "tool_using",
        async *execute() {
          yield { event_type: "success", payload: { text: "done" } };
        }
      }];
      let releaseBuild;
      const buildReleased = new Promise((resolve) => { releaseBuild = resolve; });

      const submitPromise = submitFileTask({
        runtime,
        filePaths: [filePath],
        userCommand: "总结这个文件",
        executionMode: "interactive",
        background: true,
        async buildFileContextPacketImpl({ onProgress }) {
          onProgress?.({ phase: "file_ingest_started", total: 1 });
          await buildReleased;
          onProgress?.({ phase: "file_ingest_finished", completed: 1, total: 1 });
          return createResolvedFilePacket(filePath);
        }
      });

      const result = await Promise.race([
        submitPromise,
        delay(30).then(() => null)
      ]);
      assert.ok(result, "file submission should return before API-provider ingest completes");
      assert.equal(result.background, true);
      assert.equal(runtime.store.listTasks().length, 1);
      assert.ok(runtime.store.getTaskEvents(result.task.task_id).some((event) => event.event_type === "task_created"));

      releaseBuild();
      await submitPromise;
      await delay(20);
      assert.equal(runtime.store.listTasks().length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("file count submissions use deterministic inventory without content extraction or image routing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-count-"));
  try {
    const selectedFolder = path.join(dir, "selected");
    const nestedFolder = path.join(selectedFolder, "nested");
    await mkdir(nestedFolder, { recursive: true });
    await writeFile(path.join(selectedFolder, "a.txt"), "alpha", "utf8");
    await writeFile(path.join(nestedFolder, "b.txt"), "beta", "utf8");
    const selectedImage = path.join(dir, "screen.png");
    await writeFile(selectedImage, "not a real png", "utf8");
    const runtime = createRuntime();

    const result = await submitFileTask({
      runtime,
      filePaths: [selectedFolder, selectedImage],
      userCommand: "一共有多少个文件",
      executionMode: "interactive"
    });

    const events = runtime.store.getTaskEvents(result.task.task_id);
    const names = events.map((event) => event.event_type);
    assert.equal(result.task.status, "success");
    assert.match(result.task.result_summary, /共 3 个文件/);
    assert.equal(result.task.task_spec.goal, "qa");
    assert.deepEqual(result.task.context_packet.image_paths, []);
    assert.equal(result.task.context_packet.selection_metadata.file_inventory.total_file_count, 3);
    assert.ok(names.includes("file_expand_finished"));
    assert.ok(names.includes("inline_result"));
    assert.ok(names.includes("success"));
    assert.equal(names.includes("provider_resolved"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file inventory detector excludes content-count requests", () => {
  assert.equal(shouldUseFileInventoryContext({
    userCommand: "一共有多少个文件",
    filePaths: ["C:\\tmp\\folder"],
    route: { intent_tags: ["file_action"] },
    taskSpec: { goal: "qa", artifact: { required: false } }
  }), true);
  assert.equal(shouldUseFileInventoryContext({
    userCommand: "统计这个文件有多少行",
    filePaths: ["C:\\tmp\\notes.txt"],
    route: { intent_tags: ["file_action"] },
    taskSpec: { goal: "qa", artifact: { required: false } }
  }), false);
});

test("file submission emits file ingest events before provider execution", async () => {
  await withBootCliRuntime(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-submission-events-"));
    try {
      const filePath = path.join(dir, "notes.txt");
      await writeFile(filePath, "local file content", "utf8");
      const runtime = createRuntime();

      const result = await submitFileTask({
        runtime,
        filePaths: [filePath],
        userCommand: "总结这个文件",
        executionMode: "interactive",
        async buildFileContextPacketImpl({ onProgress }) {
          onProgress?.({ phase: "file_ingest_started", total: 1 });
          onProgress?.({ phase: "file_ingest_progress", completed: 1, total: 1, path: filePath });
          onProgress?.({ phase: "file_ingest_finished", completed: 1, total: 1 });
          return {
            schema_version: "1.0",
            context_id: "ctx_test",
            trace_id: "trace_test",
            source_type: "file",
            source_app: "explorer.exe",
            capture_mode: "shell_menu",
            file_paths: [filePath],
            original_file_paths: [filePath],
            file_metadata: [{ path: filePath, size: 18, mime: "text/plain", extraction_mode: "test" }],
            image_paths: [],
            text: "local file content",
            selection_metadata: {}
          };
        }
      });

      const events = runtime.store.getTaskEvents(result.task.task_id);
      const names = events.map((event) => event.event_type);
      assert.ok(names.indexOf("task_created") < names.indexOf("file_ingest_started"));
      assert.ok(names.indexOf("file_ingest_started") < names.indexOf("file_ingest_finished"));
      assert.ok(names.indexOf("file_ingest_finished") < names.indexOf("provider_resolved"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
