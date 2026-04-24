import assert from "node:assert/strict";

import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { detectRequestedOutputFormatForTask } from "../src/service/executors/kimi/output-format.mjs";
import { createNotesStore } from "../src/service/store/notes-store.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function verifyTextNoteIntent() {
  const taskSpec = createTaskSpec(
    "把下面这段内容整理成会议笔记",
    { text: "今天讨论了发布时间、负责人和风险。" }
  );
  assert.equal(taskSpec.goal, "analyze_and_report");
  assert.equal(taskSpec.artifact.required, true);
  assert.equal(taskSpec.artifact.kind, "md");
  assert.equal(taskSpec.suggested_executor, "agentic");
  assert.ok(taskSpec.intent_tags.includes("note_capture"));

  const requestedFormat = detectRequestedOutputFormatForTask({
    user_command: "把下面这段内容整理成会议笔记",
    task_spec: taskSpec,
    context_packet: { text: "今天讨论了发布时间、负责人和风险。" }
  });
  assert.equal(requestedFormat.id, "markdown");
}

function verifyImageNoteIntent() {
  const taskSpec = createTaskSpec(
    "根据这张图片整理成课堂笔记",
    { image_paths: ["E:\\tmp\\board.png"] }
  );
  assert.equal(taskSpec.goal, "multimodal_analyze");
  assert.equal(taskSpec.artifact.required, true);
  assert.equal(taskSpec.artifact.kind, "md");
  assert.equal(taskSpec.suggested_executor, "multi_modal");

  const requestedFormat = detectRequestedOutputFormatForTask({
    user_command: "根据这张图片整理成课堂笔记",
    task_spec: taskSpec,
    context_packet: { image_paths: ["E:\\tmp\\board.png"] }
  });
  assert.equal(requestedFormat.id, "markdown");
}

function verifyAudioNoteFormat() {
  const taskSpec = createTaskSpec(
    "整理这段录音为结构化笔记",
    { source_type: "audio_note", text: "讨论了下周 demo 和负责人。" }
  );
  const requestedFormat = detectRequestedOutputFormatForTask({
    user_command: "整理这段录音为结构化笔记",
    task_spec: taskSpec,
    context_packet: { source_type: "audio_note", source_app: "uca.note" }
  });
  assert.equal(requestedFormat.id, "markdown");
}

function verifyNotesStoreAppend() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "lingxy-notes-verify-"));
  try {
    const store = createNotesStore({ filePath: path.join(tempDir, "notes.json") });
    const first = store.upsertNote({
      id: "n-1",
      title: "Daily",
      body_html: "<p>hello</p>",
      created_at: "2026-04-23T00:00:00.000Z",
      updated_at: "2026-04-23T00:00:00.000Z"
    });
    assert.equal(first.id, "n-1");
    const appended = store.appendChip({
      noteId: "n-1",
      text: "follow-up action",
      sourceLabel: "From chat"
    });
    assert.equal(appended.created, false);
    assert.match(appended.note.body_html, /follow-up action/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

verifyTextNoteIntent();
verifyImageNoteIntent();
verifyAudioNoteFormat();
verifyNotesStoreAppend();

console.log("verify-note-intent-and-format: ok");
