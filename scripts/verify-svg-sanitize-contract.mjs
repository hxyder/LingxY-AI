#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-1 svg-sanitize security preflight verifier.
// This is a static ownership and no-touch contract check only. It intentionally
// does not move svg-sanitize.mjs; runtime coverage lives in
// verify-svg-sanitize-runtime.mjs.

const currentPath = "src/service/action_tools/tools/svg-sanitize.mjs";
const futurePath = "src/service/capabilities/tools/svg-sanitize.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);
assert(!existsSync(path.join(root, futurePath)),
  "svg-sanitize.mjs must not be physically moved during preflight");

const sanitizerSrc = read(currentPath);
assert(sanitizerSrc.includes("export function sanitizeSvgMarkup"),
  "svg-sanitize.mjs must export sanitizeSvgMarkup");
assert(sanitizerSrc.includes("export function isSafeSvgMarkup"),
  "svg-sanitize.mjs must export isSafeSvgMarkup");
assert(!/^\s*import\s/u.test(sanitizerSrc),
  "svg-sanitize.mjs must stay an import-free pure helper");
assert(!/from\s+["'][^"']*desktop\//u.test(sanitizerSrc),
  "svg-sanitize must not import desktop code");
assert(!/fetch\s*\(/u.test(sanitizerSrc),
  "svg-sanitize must not make network calls");
assert(!/writeFile|readFile|mkdir|rm|unlink/u.test(sanitizerSrc),
  "svg-sanitize must not perform filesystem IO");
for (const required of [
  "FORBIDDEN_ELEMENT_RE",
  "SELF_CLOSING_FORBIDDEN_RE",
  "EVENT_HANDLER_RE",
  "JAVASCRIPT_URL_RE",
  "XML_DECL_RE",
  "DOCTYPE_RE"
]) {
  assert(sanitizerSrc.includes(required), `svg-sanitize missing ${required}`);
}

const indexSrc = read("src/service/action_tools/tools/index.mjs");
assert(indexSrc.includes("from \"./svg-sanitize.mjs\""),
  "index.mjs must import sanitizer from current owner during preflight");
assert(indexSrc.includes("RENDER_SVG_TOOL"),
  "index.mjs must still own render_svg until its own tool-family extraction");

const docRendererSrc = read("src/service/capabilities/tools/document-renderer.mjs");
assert(docRendererSrc.includes("../../action_tools/tools/svg-sanitize.mjs"),
  "document-renderer must import sanitizer from current owner during preflight");

const validatorSrc = read("src/service/executors/tool_using/tool-call-validator.mjs");
assert(validatorSrc.includes("../../action_tools/tools/svg-sanitize.mjs"),
  "tool-call-validator must import sanitizer from current owner during preflight");

const boundaryPath = "docs/architecture/svg-sanitize-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "svg-sanitize boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "SVG Sanitize Boundary",
  "`src/service/action_tools/tools/svg-sanitize.mjs`",
  "preflight only",
  "Do not physically move",
  "Security Boundary",
  "No-Touch Areas",
  "render_svg"
]) {
  assert(boundaryDoc.includes(requiredText),
    `boundary doc missing required text: ${requiredText}`);
}

if (!process.exitCode) {
  console.log("[svg-sanitize] contract preflight verified");
}
