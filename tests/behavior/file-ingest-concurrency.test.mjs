import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildFileContextPacket } from "../../src/service/extractors/file-ingest.mjs";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("file ingest extracts multiple files with bounded concurrency and preserves output order", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-ingest-concurrency-"));
  try {
    const files = ["a.txt", "b.txt", "c.txt", "d.txt"].map((name) => path.join(dir, name));
    await Promise.all(files.map((file, index) => writeFile(file, `file ${index}`, "utf8")));

    let active = 0;
    let maxActive = 0;
    const started = [];
    const progress = [];

    const packet = await buildFileContextPacket({
      filePaths: files,
      traceId: "trace_test",
      contextId: "ctx_test",
      extractionConcurrency: 2,
      onProgress(event) {
        progress.push(event);
      },
      async extractFileContentImpl(filePath) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        started.push(path.basename(filePath));
        await delay(path.basename(filePath) === "a.txt" ? 30 : 5);
        active -= 1;
        return {
          path: filePath,
          size: 10,
          mime: "text/plain",
          extraction_mode: "test",
          text: `contents:${path.basename(filePath)}`
        };
      }
    });

    assert.equal(maxActive, 2);
    assert.deepEqual(started.slice(0, 2).sort(), ["a.txt", "b.txt"]);
    assert.deepEqual(packet.file_metadata.map((entry) => path.basename(entry.path)), [
      "a.txt",
      "b.txt",
      "c.txt",
      "d.txt"
    ]);
    assert.match(packet.text, /## a\.txt\ncontents:a\.txt[\s\S]*## d\.txt\ncontents:d\.txt/);
    assert.equal(progress[0].phase, "file_expand_started");
    assert.equal(progress[1].phase, "file_expand_finished");
    assert.ok(progress.some((event) => event.phase === "file_ingest_started"));
    assert.equal(progress.at(-1).phase, "file_ingest_finished");
    assert.equal(progress.filter((event) => event.phase === "file_ingest_progress").length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("file ingest inventory mode counts selected folders without extracting file contents", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-ingest-inventory-"));
  try {
    const selectedFolder = path.join(dir, "selected");
    const nestedFolder = path.join(selectedFolder, "nested");
    await mkdir(nestedFolder, { recursive: true });
    await writeFile(path.join(selectedFolder, "a.txt"), "alpha", "utf8");
    await writeFile(path.join(nestedFolder, "b.txt"), "beta", "utf8");
    const selectedFile = path.join(dir, "image.png");
    await writeFile(selectedFile, "not a real png", "utf8");
    const progress = [];

    const packet = await buildFileContextPacket({
      filePaths: [selectedFolder, selectedFile],
      traceId: "trace_inventory",
      contextId: "ctx_inventory",
      inventoryOnly: true,
      onProgress(event) {
        progress.push(event);
      },
      async extractFileContentImpl() {
        throw new Error("inventory mode must not extract file contents");
      }
    });

    assert.equal(packet.selection_metadata.file_inventory.inventory_only, true);
    assert.equal(packet.selection_metadata.file_inventory.total_file_count, 3);
    assert.equal(packet.selection_metadata.file_inventory.total_directory_count, 1);
    assert.deepEqual(packet.image_paths, []);
    assert.deepEqual(packet.file_paths, [selectedFile]);
    assert.match(packet.text, /Content extraction was skipped/);
    assert.match(packet.text, /Recursive file count: 3/);
    assert.equal(packet.file_metadata.find((entry) => entry.path === selectedFolder)?.extraction_mode, "directory_inventory");
    assert.equal(packet.file_metadata.find((entry) => entry.path === selectedFile)?.extraction_mode, "file_inventory");
    assert.equal(progress[0].phase, "file_expand_started");
    assert.ok(progress.some((event) => event.phase === "file_expand_finished" && event.inventory_only === true));
    assert.equal(progress.at(-1).phase, "file_ingest_finished");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
