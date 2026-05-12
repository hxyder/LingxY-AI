// Verifier for Phase 13 — generate_document must not crash on long outlines.
//
// task_75ddc38b failed because the PowerShell fallback was invoked with a
// huge -Text arg; Windows command lines cap at ~8191 bytes. We now write
// the outline to a UTF-8 temp file and pass -TextFile <path>, so any
// payload size is fine.
//
// This verifier:
//   1. Static-checks the wiring (document artifact helpers use -TextFile,
//      writeFile'd temp).
//   2. Static-checks the PS script accepts -TextFile and rejects empty input.
//   3. If PowerShell is available on the host (Windows), actually runs the
//      script with a 50 KB body — well past the 8191-byte CLI limit — and
//      asserts the produced .docx is a valid zip (OOXML file).

import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// --- 1. Static wiring in document-artifact-helpers.mjs ----------------
{
  const src = await readFile(path.join(ROOT, "src/service/capabilities/tools/document-artifact-helpers.mjs"), "utf8");
  assert.ok(src.includes("-TextFile"),
    "invokeDocumentRenderer must pass -TextFile to PowerShell (not -Text)");
  assert.ok(src.includes("lingxy-doc-"),
    "temp-file prefix missing — we need to clean up reliably");
  assert.ok(src.includes("unlink(tempFile)"),
    "temp file must be cleaned up in a finally block");
  assert.ok(!src.match(/"-Text",\s*plainText/),
    "old -Text plainText path must be gone");
}

// --- 2. Static wiring in render-document.ps1 -------------------------
{
  const ps = await readFile(path.join(ROOT, "scripts/render-document.ps1"), "utf8");
  assert.ok(ps.includes("$TextFile"),
    "PS script must declare -TextFile parameter");
  assert.ok(ps.match(/ReadAllText\(\$TextFile/),
    "PS script must read the file when -TextFile is provided");
  assert.ok(ps.match(/\$Text = ""/) || ps.match(/\$Text\s*=\s*""/),
    "PS -Text must be optional with default '' so -TextFile can replace it");
  assert.ok(ps.includes("no text provided"),
    "PS should throw a clear error when both sources are empty");
}

// --- 3. Live invocation with a 50 KB payload -------------------------
if (process.platform === "win32") {
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "lingxy-phase13-"));
  try {
    const longText = "# 北卡气候分析长稿\n\n" + "一段普通的段落文本。".repeat(3000); // ~120 KB UTF-8
    assert.ok(longText.length > 8192, "test payload must exceed the Windows CLI limit");

    const textFile = path.join(tmpRoot, "body.txt");
    const outFile  = path.join(tmpRoot, "out.docx");
    await writeFile(textFile, longText, "utf8");

    const scriptPath = path.join(ROOT, "scripts/render-document.ps1");
    await execFileP("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-TargetPath", outFile,
      "-Kind", "docx",
      "-TextFile", textFile
    ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30000 });

    const info = await stat(outFile);
    assert.ok(info.size > 1024, "produced docx should be non-trivial size");
    // OOXML is a zip; first 2 bytes are "PK".
    const head = await readFile(outFile);
    assert.equal(head[0], 0x50, "docx first byte = 'P' (zip)");
    assert.equal(head[1], 0x4b, "docx second byte = 'K' (zip)");

    // Negative test: missing text file → clear error.
    let rejected = false;
    try {
      await execFileP("powershell", [
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
        "-TargetPath", path.join(tmpRoot, "nope.docx"),
        "-Kind", "docx",
        "-TextFile", path.join(tmpRoot, "does-not-exist.txt")
      ], { timeout: 10000 });
    } catch (error) {
      rejected = true;
      assert.match(error.stderr || error.message || "", /TextFile not found/);
    }
    assert.ok(rejected, "missing -TextFile should throw");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

console.log("ok verify-doc-renderer-arg-length");
