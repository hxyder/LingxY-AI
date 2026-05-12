#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-1 document-renderer ownership verifier.
// Locks the post-move owner and no-touch contracts. Runtime coverage lives in
// verify-document-renderer-runtime.mjs.

const currentPath = "src/service/capabilities/tools/document-renderer.mjs";
assert(existsSync(path.join(root, currentPath)), `current owner missing: ${currentPath}`);
assert(!existsSync(path.join(root, "src/service/action_tools/tools/document-renderer.mjs")),
  "old action_tools document-renderer owner must not exist after CAP-1 move");

const docSrc = read(currentPath);
const indexSrc = read("src/service/action_tools/tools/index.mjs");
const documentArtifactHelperSrc = read("src/service/capabilities/tools/document-artifact-helpers.mjs");
const documentRenderToolSrc = read("src/service/capabilities/tools/document-render-tools.mjs");

assert(docSrc.includes("export function renderDocumentPreviewHtml"),
  "document-renderer.mjs must export renderDocumentPreviewHtml");
assert(docSrc.includes("export async function renderDocument"),
  "document-renderer.mjs must export renderDocument");
assert(docSrc.includes("renderMermaidScriptTag"),
  "document previews must use the local Mermaid asset helper");
assert(docSrc.includes("sanitizeSvgMarkup"),
  "document previews must sanitize embedded SVG components");
assert(docSrc.includes("from \"./mermaid-assets.mjs\""),
  "document-renderer must import mermaid-assets from the sibling capability owner");
assert(docSrc.includes("from \"./svg-sanitize.mjs\""),
  "document-renderer must import svg-sanitize from the capability owner");
assert(docSrc.includes("await import(\"pptxgenjs\")"),
  "PPTX dependency must remain lazy-loaded inside the renderer");
assert(docSrc.includes("await import(\"docx\")"),
  "DOCX dependency must remain lazy-loaded inside the renderer");
assert(docSrc.includes("await import(\"exceljs\")"),
  "XLSX dependency must remain lazy-loaded inside the renderer");
assert(!/from\s+["'][^"']*desktop\/renderer/u.test(docSrc),
  "document-renderer must not import desktop renderer code");
assert(!/from\s+["'][^"']*desktop\/tray/u.test(docSrc),
  "document-renderer must not import Electron main/tray code");
assert(!/from\s+["'][^"']*providers/u.test(docSrc),
  "document-renderer must not call provider/model layers");
assert(!docSrc.includes("createActionResult"),
  "document-renderer must stay a pure renderer helper, not own action result wrapping");

const generateDocument = BUILTIN_ACTION_TOOLS.find((tool) => tool.id === "generate_document");
assert(generateDocument, "BUILTIN_ACTION_TOOLS must include generate_document");
assert.equal(generateDocument.risk_level, "low", "generate_document risk_level must remain low");
assert.deepEqual(generateDocument.required_capabilities, ["file_write"],
  "generate_document required_capabilities must remain file_write only");
assert.equal(generateDocument.requires_confirmation, false,
  "generate_document confirmation behavior must remain unchanged");

assert(documentArtifactHelperSrc.includes("await import(\"./document-renderer.mjs\")"),
  "document artifact helpers must dynamically import document-renderer from capabilities/tools/");
assert(documentArtifactHelperSrc.includes("writeDocumentPreviewSidecar"),
  "generate_document must continue writing preview sidecars for previewable artifacts");
assert(documentArtifactHelperSrc.includes("prepareGeneratedDocumentCheckpoint"),
  "generate_document must continue recording file reversibility checkpoints");
assert(indexSrc.includes("from \"../../capabilities/tools/document-render-tools.mjs\""),
  "index.mjs must aggregate generate/render tools from the capability owner");
assert(documentRenderToolSrc.includes("export const GENERATE_DOCUMENT_TOOL"),
  "document-render-tools must own generate_document");
assert(documentRenderToolSrc.includes("export const RENDER_DIAGRAM_TOOL"),
  "document-render-tools must own render_diagram");
assert(documentRenderToolSrc.includes("export const RENDER_SVG_TOOL"),
  "document-render-tools must own render_svg");
assert(!indexSrc.includes("export const GENERATE_DOCUMENT_TOOL = {"),
  "index.mjs must not retain the generate_document implementation");
assert(!indexSrc.includes("export const RENDER_DIAGRAM_TOOL = {"),
  "index.mjs must not retain the render_diagram implementation");
assert(!indexSrc.includes("export const RENDER_SVG_TOOL = {"),
  "index.mjs must not retain the render_svg implementation");
assert(documentRenderToolSrc.includes("preview_html_path"),
  "generate_document metadata must continue exposing preview_html_path");
assert(documentRenderToolSrc.includes("needs_pdf_conversion"),
  "PDF fallback contract must continue exposing needs_pdf_conversion");

const boundaryPath = "docs/architecture/document-renderer-boundary.md";
assert(existsSync(path.join(root, boundaryPath)), "document-renderer boundary doc missing");
const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Document Renderer Boundary",
  "`src/service/capabilities/tools/document-renderer.mjs`",
  "moved to",
  "artifact kinds",
  "preview_html_path",
  "reversibility",
  "No-Touch Areas"
]) {
  assert(boundaryDoc.includes(requiredText),
    `boundary doc missing required text: ${requiredText}`);
}

if (!process.exitCode) {
  console.log("[document-renderer] contract verified");
}
