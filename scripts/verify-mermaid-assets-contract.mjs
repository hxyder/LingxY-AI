#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-1 mermaid-assets render-asset preflight verifier.
// This is a static ownership and no-touch contract check only. It intentionally
// does not move mermaid-assets.mjs; runtime coverage lives in
// verify-mermaid-assets-runtime.mjs.

const currentPath = "src/service/action_tools/tools/mermaid-assets.mjs";
const futurePath = "src/service/capabilities/tools/mermaid-assets.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);
assert(!existsSync(path.join(root, futurePath)),
  "mermaid-assets.mjs must not be physically moved during preflight");

const assetSrc = read(currentPath);
for (const required of [
  "export function resolveMermaidScriptSrc",
  "export const MERMAID_SCRIPT_SRC",
  "export function renderMermaidScriptTag",
  "mermaid/dist/mermaid.min.js",
  "escapeHtmlAttr"
]) {
  assert(assetSrc.includes(required), `mermaid-assets missing ${required}`);
}
assert(!/cdn\.jsdelivr|https?:\/\//iu.test(assetSrc),
  "mermaid-assets must not contain CDN or remote Mermaid URLs");
assert(!/fetch\s*\(/u.test(assetSrc),
  "mermaid-assets must not make network calls");
assert(!/\b(writeFile|mkdir|rm|unlink)\b/u.test(assetSrc),
  "mermaid-assets must not perform write/delete filesystem IO");
assert(!/from\s+["'][^"']*desktop\//u.test(assetSrc),
  "mermaid-assets must not import desktop code");

const indexSrc = read("src/service/action_tools/tools/index.mjs");
assert(indexSrc.includes("from \"./mermaid-assets.mjs\""),
  "index.mjs must import Mermaid assets from current owner during preflight");
assert(indexSrc.includes("renderMermaidScriptTag()"),
  "index.mjs must use shared Mermaid script tag helper");

const docRendererSrc = read("src/service/capabilities/tools/document-renderer.mjs");
assert(docRendererSrc.includes("../../action_tools/tools/mermaid-assets.mjs"),
  "document-renderer must import Mermaid assets from current owner during preflight");

const kimiSrc = read("src/service/executors/kimi/output-format.mjs");
assert(kimiSrc.includes("../../action_tools/tools/mermaid-assets.mjs"),
  "Kimi output formatter must import Mermaid assets from current owner during preflight");

const boundaryPath = "docs/architecture/mermaid-assets-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "mermaid-assets boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Mermaid Assets Boundary",
  "`src/service/action_tools/tools/mermaid-assets.mjs`",
  "preflight only",
  "Do not physically move",
  "Render Asset Boundary",
  "No-Touch Areas",
  "render_diagram"
]) {
  assert(boundaryDoc.includes(requiredText),
    `boundary doc missing required text: ${requiredText}`);
}

if (!process.exitCode) {
  console.log("[mermaid-assets] contract preflight verified");
}
