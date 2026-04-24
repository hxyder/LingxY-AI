// LibreOffice detection (UCA-182 Phase 5).
//
// The pptx preview provider works best when it can drive LibreOffice
// (`soffice`) to convert slides to pdf — the output is pixel-perfect.
// We check once at startup, cache the result, and expose it on the
// runtime so the provider (and the Settings panel) can ask without
// probing the filesystem every time.
//
// When `soffice` is absent we fall through to a jszip-based text
// structure renderer (Tier 2). Users can install LibreOffice via
// the popup card shipped in popup-card.js, or manually.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const DETECT_TIMEOUT_MS = 2000;

/**
 * Probe the host for a working LibreOffice CLI (`soffice`).
 *
 * Returns a small capability record rather than a bare boolean so
 * callers can log which path was found and surface it in the UI.
 *
 * @returns {Promise<{ present: boolean, command?: string, path?: string, error?: string }>}
 */
export async function detectLibreOffice() {
  const isWindows = process.platform === "win32";
  const resolver = isWindows ? "where" : "which";
  const candidate = "soffice";
  try {
    const { stdout } = await execFileP(resolver, [candidate], { timeout: DETECT_TIMEOUT_MS });
    const found = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (found.length === 0) {
      return { present: false, error: `${candidate} not found on PATH` };
    }
    return { present: true, command: candidate, path: found[0] };
  } catch (error) {
    return { present: false, error: error?.message ?? "detection failed" };
  }
}

/**
 * Attach LibreOffice capability to a runtime object. The resulting
 * `runtime.capabilities.libreoffice` field is shaped:
 *   { present: boolean, command?, path?, error?, checkedAt: ISO string }
 * and is mutated in-place so callers can await the attach and then
 * read the updated record synchronously thereafter.
 */
export async function attachLibreOfficeCapability(runtime) {
  if (!runtime || typeof runtime !== "object") return null;
  const result = await detectLibreOffice();
  const record = { ...result, checkedAt: new Date().toISOString() };
  if (!runtime.capabilities) runtime.capabilities = {};
  runtime.capabilities.libreoffice = record;
  return record;
}
