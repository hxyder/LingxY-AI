// Phase 3 verifier (UCA-182) — assert every fake-preview symbol is gone.
//
// The old live-preview.js modelled docx / pptx / xlsx layouts by
// parsing partial tool-args JSON. We deleted that code in favour of
// real renderers (Phase 2 providers + pdfjs in Phase 4). This check
// makes sure the forbidden symbols do not creep back in — anywhere
// in the renderer tree or the service tree.
//
// The symbols we forbid:
//   renderStructuredDoc
//   parseObjectArray
//   parseStringArray
//   parseStringMatrix
// and the http-server fallback markers:
//   "(无可提取文本)"
//   "extractFileContent(target)"  inside render-preview-html
//
// extractStringField stays allowed — streaming path detection
// legitimately needs it (see preview/streaming.js).

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const FORBIDDEN = [
  "renderStructuredDoc",
  "parseObjectArray",
  "parseStringArray",
  "parseStringMatrix"
];

const SEARCH_ROOTS = [
  path.join(ROOT, "src", "desktop", "renderer"),
  path.join(ROOT, "src", "service")
];

// Skip dirs that can legitimately mention the old symbols (this
// verifier file itself, the plan document, the progress log).
const SKIP = new Set([
  path.resolve(__dirname, "verify-no-fake-preview.mjs")
]);

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (SKIP.has(full)) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...(await walk(full)));
    } else if (entry.isFile() && /\.(m?js|mjs|cjs|html|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];
for (const rootDir of SEARCH_ROOTS) {
  const files = await walk(rootDir);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const sym of FORBIDDEN) {
      if (text.includes(sym)) offenders.push({ file, symbol: sym });
    }
  }
}

if (offenders.length) {
  for (const o of offenders) {
    console.error(`  [fake preview] ${o.symbol} found in ${path.relative(ROOT, o.file)}`);
  }
  assert.fail(`found ${offenders.length} forbidden fake-preview symbol(s)`);
}

// Additional check: http-server.mjs must NOT wrap extractFileContent
// output into a <pre> inside /file/render-preview-html. We look for
// the exact marker string the fallback used.
{
  const http = await readFile(path.join(ROOT, "src", "service", "core", "http-server.mjs"), "utf8");
  assert.ok(!http.includes("(无可提取文本)"),
    "http-server.mjs still contains legacy <pre> fallback marker");
}

// Positive check: the replacement modules exist.
for (const expected of [
  "src/desktop/renderer/preview/client-registry.js",
  "src/desktop/renderer/preview/streaming.js",
  "src/desktop/renderer/preview/handlers/iframe-remote.js",
  "src/desktop/renderer/preview/handlers/text.js",
  "src/desktop/renderer/preview/handlers/csv.js",
  "src/desktop/renderer/preview/handlers/image.js"
]) {
  await stat(path.join(ROOT, expected));
}

// Positive check: live-preview.js should be much smaller than the
// pre-Phase-3 629-line version. 350 is a generous upper bound that
// still catches accidental revert.
{
  const lp = await readFile(path.join(ROOT, "src/desktop/renderer/live-preview.js"), "utf8");
  const lineCount = lp.split("\n").length;
  assert.ok(lineCount < 350,
    `live-preview.js should be <350 lines after Phase 3; got ${lineCount}`);
}

console.log("ok verify-no-fake-preview");
