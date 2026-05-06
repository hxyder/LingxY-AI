import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
