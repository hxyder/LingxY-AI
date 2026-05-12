import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createActionToolRegistry } from "../../src/service/capabilities/registry/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../../src/service/action_tools/tools/index.mjs";
import {
  applyFileReversibilityCheckpoint,
  collectFileReversibilityCheckpoints
} from "../../src/service/capabilities/tools/file-reversibility.mjs";
import { renderFileReversibilityPanel } from "../../src/desktop/renderer/console-task-detail.mjs";

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-fw018-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("write_file records a delete-created-file reverse operation for new files", async () => {
  await withTempDir(async (outputDir) => {
    const result = await registry.call("write_file", {
      path: "notes/new.txt",
      content: "fresh"
    }, {
      outputDir,
      task: { task_id: "task_fw018_new" }
    });

    assert.equal(result.success, true);
    assert.equal(result.metadata.reversibility.reversible, true);
    assert.equal(result.metadata.reversibility.existed_before, false);
    assert.equal(result.metadata.reversibility.reverse_operation, "delete_created_file");
    assert.equal(result.metadata.reversibility.backup_path, null);
  });
});

test("write_file overwrite records a restore checkpoint with the previous bytes", async () => {
  await withTempDir(async (outputDir) => {
    const target = path.join(outputDir, "notes", "existing.txt");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "original", "utf8");

    const result = await registry.call("write_file", {
      path: "notes/existing.txt",
      content: "next",
      overwrite: true
    }, {
      outputDir,
      task: { task_id: "task_fw018_overwrite" }
    });

    const checkpoint = result.metadata.reversibility;
    assert.equal(result.success, true);
    assert.equal(checkpoint.existed_before, true);
    assert.equal(checkpoint.reverse_operation, "restore_file");
    assert.equal(await readFile(checkpoint.backup_path, "utf8"), "original");
    assert.equal(await readFile(target, "utf8"), "next");
  });
});

test("edit_file records a restore checkpoint before in-place replacement", async () => {
  await withTempDir(async (outputDir) => {
    const target = path.join(outputDir, "editable.md");
    await writeFile(target, "before", "utf8");

    const result = await registry.call("edit_file", {
      path: target,
      content: "after"
    }, {
      outputDir,
      task: { task_id: "task_fw018_edit" }
    });

    const checkpoint = result.metadata.reversibility;
    assert.equal(result.success, true);
    assert.equal(checkpoint.reverse_operation, "restore_file");
    assert.equal(await readFile(checkpoint.backup_path, "utf8"), "before");
    assert.equal(await readFile(target, "utf8"), "after");
  });
});

test("generate_document records restore checkpoints for artifact and preview sidecar", async () => {
  await withTempDir(async (outputDir) => {
    const target = path.join(outputDir, "reports", "existing.docx");
    const preview = path.join(outputDir, "reports", "existing-preview.html");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "old-doc-bytes", "utf8");
    await writeFile(preview, "<p>old preview</p>", "utf8");

    const result = await registry.call("generate_document", {
      kind: "docx",
      path: "reports/existing.docx",
      outline: {
        title: "Updated",
        sections: [{ heading: "Summary", body: "New content" }]
      }
    }, {
      outputDir,
      task: { task_id: "task_fw018_generate_doc" }
    });

    assert.equal(result.success, true, result.observation);
    const checkpoint = result.metadata.reversibility;
    const sidecar = result.metadata.reversibility_sidecars?.find((entry) =>
      entry.target_path === preview
    );
    assert.equal(checkpoint.tool_id, "generate_document");
    assert.equal(checkpoint.reverse_operation, "restore_file");
    assert.equal(await readFile(checkpoint.backup_path, "utf8"), "old-doc-bytes");
    assert.ok(sidecar, "preview sidecar checkpoint should be present");
    assert.equal(sidecar.reverse_operation, "restore_file");
    assert.equal(await readFile(sidecar.backup_path, "utf8"), "<p>old preview</p>");

    await applyFileReversibilityCheckpoint(sidecar, { actor: "test" });
    assert.equal(await readFile(preview, "utf8"), "<p>old preview</p>");
  });
});

test("file recovery checkpoint restores previous bytes", async () => {
  await withTempDir(async (outputDir) => {
    const target = path.join(outputDir, "restore-me.txt");
    await writeFile(target, "before", "utf8");

    const result = await registry.call("write_file", {
      path: target,
      content: "after",
      overwrite: true
    }, {
      outputDir,
      task: { task_id: "task_fw018_restore" }
    });

    const recovered = await applyFileReversibilityCheckpoint(result.metadata.reversibility, {
      actor: "test"
    });

    assert.equal(recovered.ok, true);
    assert.equal(recovered.reverse_operation, "restore_file");
    assert.equal(await readFile(target, "utf8"), "before");
  });
});

test("file recovery checkpoint deletes a newly-created file", async () => {
  await withTempDir(async (outputDir) => {
    const target = path.join(outputDir, "created.txt");
    const result = await registry.call("write_file", {
      path: target,
      content: "created"
    }, {
      outputDir,
      task: { task_id: "task_fw018_delete_created" }
    });

    assert.equal(await readFile(target, "utf8"), "created");
    const recovered = await applyFileReversibilityCheckpoint(result.metadata.reversibility, {
      actor: "test"
    });

    assert.equal(recovered.ok, true);
    assert.equal(recovered.reverse_operation, "delete_created_file");
    await assert.rejects(readFile(target, "utf8"), /ENOENT/u);
  });
});

test("file recovery checkpoints are collected from task events by checkpoint id", () => {
  const entries = collectFileReversibilityCheckpoints([
    {
      event_type: "tool_call_completed",
      payload: {
        tool_id: "write_file",
        metadata: {
          reversibility: {
            checkpoint_id: "fw018_collect",
            reversible: true,
            target_path: "E:\\linxiDoc\\collect.md",
            reverse_operation: "delete_created_file",
            existed_before: false
          }
        },
        reversibility_sidecars: [{
          checkpoint_id: "fw018_sidecar",
          reversible: true,
          target_path: "E:\\linxiDoc\\collect-preview.html",
          reverse_operation: "restore_file",
          existed_before: true,
          backup_path: "E:\\linxiDoc\\.lingxy-checkpoints\\fw018_sidecar.html"
        }]
      }
    }
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].checkpoint_id, "fw018_collect");
  assert.equal(entries[0].reverse_operation, "delete_created_file");
  assert.equal(entries[1].checkpoint_id, "fw018_sidecar");
  assert.equal(entries[1].operation, "file_mutation");
});

test("task detail renders copyable file recovery checkpoints without raw event JSON", () => {
  const html = renderFileReversibilityPanel([
    {
      event_type: "tool_call_completed",
      ts: "2026-05-08T12:00:00.000Z",
      payload: {
        tool_id: "write_file",
        success: true,
        metadata: {
          reversibility: {
            checkpoint_id: "fw018_demo",
            reversible: true,
            tool_id: "write_file",
            operation: "write_file",
            target_path: "E:\\linxiDoc\\demo.md",
            backup_path: "E:\\linxiDoc\\.lingxy-checkpoints\\fw018_demo.md",
            existed_before: true,
            reverse_operation: "restore_file",
            created_at: "2026-05-08T12:00:00.000Z"
          },
          reversibility_sidecars: [{
            checkpoint_id: "fw018_preview",
            reversible: true,
            tool_id: "generate_document",
            operation: "generate_document_preview_sidecar",
            target_path: "E:\\linxiDoc\\demo-preview.html",
            backup_path: "E:\\linxiDoc\\.lingxy-checkpoints\\fw018_preview.html",
            existed_before: true,
            reverse_operation: "restore_file",
            created_at: "2026-05-08T12:00:01.000Z"
          }]
        }
      }
    }
  ]);

  assert.match(html, /Recovery|可逆性/);
  assert.match(html, /2 file checkpoints/);
  assert.match(html, /Restore previous bytes/);
  assert.match(html, /backup ready/);
  assert.match(html, /data-file-reversibility-copy="1"/);
  assert.match(html, /data-file-reversibility-restore="fw018_demo"/);
  assert.match(html, /data-file-reversibility-restore="fw018_preview"/);
  assert.match(html, /data-reversibility-json=/);
  assert.doesNotMatch(html, /event_type|tool_call_completed/u);
});
