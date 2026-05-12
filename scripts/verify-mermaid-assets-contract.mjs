#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-1 mermaid-assets render-asset ownership verifier.
// This is a static ownership and no-touch contract check; runtime coverage
// lives in verify-mermaid-assets-runtime.mjs.

const currentPath = "src/service/capabilities/tools/mermaid-assets.mjs";
const oldPath = "src/service/action_tools/tools/mermaid-assets.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);
assert(!existsSync(path.join(root, oldPath)),
  "mermaid-assets.mjs must not remain at the old action_tools/tools owner path");

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
const documentRenderToolSrc = read("src/service/capabilities/tools/document-render-tools.mjs");
assert(indexSrc.includes("from \"../../capabilities/tools/document-render-tools.mjs\""),
  "index.mjs must aggregate render_diagram from the document-render tool owner");
assert(documentRenderToolSrc.includes("from \"./mermaid-assets.mjs\""),
  "document-render-tools must import Mermaid assets from capabilities/tools/");
assert(documentRenderToolSrc.includes("renderMermaidScriptTag()"),
  "document-render-tools must use shared Mermaid script tag helper");

const docRendererSrc = read("src/service/capabilities/tools/document-renderer.mjs");
assert(docRendererSrc.includes("from \"./mermaid-assets.mjs\""),
  "document-renderer must import Mermaid assets from the sibling capability owner");

const kimiSrc = read("src/service/executors/kimi/output-format.mjs");
assert(kimiSrc.includes("../../capabilities/tools/mermaid-assets.mjs"),
  "Kimi output formatter must import Mermaid assets from capabilities/tools/");

const boundaryPath = "docs/architecture/mermaid-assets-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "mermaid-assets boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Mermaid Assets Boundary",
  "`src/service/capabilities/tools/mermaid-assets.mjs`",
  "moved from `src/service/action_tools/tools/mermaid-assets.mjs`",
  "Render Asset Boundary",
  "No-Touch Areas",
  "render_diagram"
]) {
  assert(boundaryDoc.includes(requiredText),
    `boundary doc missing required text: ${requiredText}`);
}

if (!process.exitCode) {
  console.log("[mermaid-assets] contract verified");
}
