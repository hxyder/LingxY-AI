import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DOWNLOAD_FILE_TOOL } from "../../src/service/capabilities/tools/browser-web-tools.mjs";

test("download_file saves binary content as an artifact with image kind metadata", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-download-file-"));
  const originalFetch = globalThis.fetch;
  try {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(bytes.length)
      }
    });

    const result = await DOWNLOAD_FILE_TOOL.execute(
      { url: "https://example.test/wallpaper.png", kind: "image" },
      { outputDir, task: { task_id: "task_download_file" }, runtime: {} }
    );

    assert.equal(result.success, true, result.observation);
    assert.equal(result.metadata.kind, "image");
    assert.equal(result.artifact_paths.length, 1);
    assert.equal(path.extname(result.artifact_paths[0]), ".png");
    assert.deepEqual(await readFile(result.artifact_paths[0]), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("download_file infers Office filenames from content-disposition and MIME type", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-download-office-"));
  const originalFetch = globalThis.fetch;
  try {
    const bytes = Buffer.from("docx-bytes");
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": "attachment; filename*=UTF-8''Quarterly%20Report.docx",
        "content-length": String(bytes.length)
      }
    });

    const result = await DOWNLOAD_FILE_TOOL.execute(
      { url: "https://example.test/download?id=report" },
      { outputDir, task: { task_id: "task_download_docx" }, runtime: {} }
    );

    assert.equal(result.success, true, result.observation);
    assert.equal(result.metadata.kind, "docx");
    assert.equal(path.basename(result.artifact_paths[0]), "Quarterly Report.docx");
    assert.deepEqual(await readFile(result.artifact_paths[0]), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("download_file uses explicit kind to choose a generic extension when the URL has none", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-download-kind-"));
  const originalFetch = globalThis.fetch;
  try {
    const bytes = Buffer.from("# Notes\n");
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.length)
      }
    });

    const result = await DOWNLOAD_FILE_TOOL.execute(
      { url: "https://example.test/raw", filename: "notes", kind: "md" },
      { outputDir, task: { task_id: "task_download_md" }, runtime: {} }
    );

    assert.equal(result.success, true, result.observation);
    assert.equal(result.metadata.kind, "md");
    assert.equal(path.basename(result.artifact_paths[0]), "notes.md");
    assert.deepEqual(await readFile(result.artifact_paths[0]), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("download_file preserves non-image file extensions from direct URLs", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-download-csv-"));
  const originalFetch = globalThis.fetch;
  try {
    const bytes = Buffer.from("a,b\n1,2\n");
    globalThis.fetch = async () => new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.length)
      }
    });

    const result = await DOWNLOAD_FILE_TOOL.execute(
      { url: "https://example.test/files/data.csv?token=abc" },
      { outputDir, task: { task_id: "task_download_csv" }, runtime: {} }
    );

    assert.equal(result.success, true, result.observation);
    assert.equal(result.metadata.kind, "csv");
    assert.equal(path.basename(result.artifact_paths[0]), "data.csv");
    assert.deepEqual(await readFile(result.artifact_paths[0]), bytes);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outputDir, { recursive: true, force: true });
  }
});
