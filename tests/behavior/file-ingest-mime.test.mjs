import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { detectMimeType } from "../../src/service/extractors/file-ingest.mjs";

test("file ingest MIME detection reads signatures without changing extension semantics", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lingxy-file-ingest-"));
  try {
    const pdf = path.join(dir, "sample.bin");
    await writeFile(pdf, Buffer.from("%PDF-1.7\nbody"));
    assert.equal(await detectMimeType(pdf), "application/pdf");

    const docx = path.join(dir, "sample.docx");
    await writeFile(docx, Buffer.from("PK\x03\x04"));
    assert.equal(
      await detectMimeType(docx),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );

    const text = path.join(dir, "notes.md");
    await writeFile(text, "# Notes");
    assert.equal(await detectMimeType(text), "text/markdown");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
