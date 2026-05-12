#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import {
  GENERATE_DOCUMENT_TOOL,
  RENDER_DIAGRAM_TOOL,
  RENDER_SVG_TOOL
} from "../src/service/capabilities/tools/document-render-tools.mjs";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-5G verifier.
// Post-move state: generate/render tools are owned by capabilities/tools and
// index.mjs only aggregates and re-exports them.

const aggregatorPath = "src/service/action_tools/tools/index.mjs";
const ownerPath = "src/service/capabilities/tools/document-render-tools.mjs";
const oldOwnerPath = "src/service/action_tools/tools/document-render-tools.mjs";
const boundaryPath = "docs/architecture/document-render-tools-boundary.md";

assert(existsSync(path.join(root, aggregatorPath)), `tool aggregator missing: ${aggregatorPath}`);
assert(existsSync(path.join(root, ownerPath)), `document render tool owner missing: ${ownerPath}`);
assert(!existsSync(path.join(root, oldOwnerPath)), `old document render owner must not exist: ${oldOwnerPath}`);
assert(existsSync(path.join(root, boundaryPath)), `document render boundary doc missing: ${boundaryPath}`);

const indexSrc = read(aggregatorPath);
const ownerSrc = read(ownerPath);

assert(indexSrc.includes("from \"../../capabilities/tools/document-render-tools.mjs\""),
  "index.mjs must import document-render-tools.mjs from capabilities/tools/");
for (const tool of ["GENERATE_DOCUMENT_TOOL", "RENDER_DIAGRAM_TOOL", "RENDER_SVG_TOOL"]) {
  assert(ownerSrc.includes(`export const ${tool} = {`),
    `document-render-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not retain document/render owner text: ${tool}`);
}
for (const requiredText of [
  "from \"./document-artifact-helpers.mjs\"",
  "from \"./mermaid-assets.mjs\"",
  "from \"./svg-sanitize.mjs\"",
  "resolveSandboxedTarget(outputDir, targetArg)",
  "prepareGeneratedDocumentCheckpoint",
  "preview_html_path",
  "needs_pdf_conversion",
  "renderMermaidScriptTag()",
  "sanitizeSvgMarkup(args.svg",
  "artifactPaths: [absTarget]",
  "artifactPaths: [htmlPath]",
  "artifactPaths: [svgPath]"
]) {
  assert(ownerSrc.includes(requiredText), `document-render-tools.mjs missing contract text: ${requiredText}`);
}

const tools = new Map(BUILTIN_ACTION_TOOLS.map((tool) => [tool.id, tool]));
const expected = [
  ["generate_document", GENERATE_DOCUMENT_TOOL],
  ["render_diagram", RENDER_DIAGRAM_TOOL],
  ["render_svg", RENDER_SVG_TOOL]
];
for (const [id, expectedTool] of expected) {
  const tool = tools.get(id);
  assert(tool, `missing built-in tool ${id}`);
  assert.equal(tool, expectedTool, `${id} must be aggregated from document-render-tools.mjs`);
  assert.equal(tool.risk_level, "low", `${id} risk level changed`);
  assert.equal(tool.requires_confirmation, false, `${id} confirmation behavior changed`);
  assert.deepEqual(tool.required_capabilities ?? [], ["file_write"], `${id} required capabilities changed`);
  assert.equal(tool.parameters?.type, "object", `${id} schema must remain an object schema`);
}

const ids = BUILTIN_ACTION_TOOLS.map((tool) => tool.id);
assert.deepEqual(
  ids.slice(ids.indexOf("generate_document"), ids.indexOf("render_svg") + 1),
  ["generate_document", "render_diagram", "render_svg"],
  "generate/render registry order changed"
);

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-doc-render-tools-"));
try {
  const rejected = await registry.call("generate_document", {
    kind: "epub",
    outline: { title: "Bad kind" }
  }, { outputDir, task: { task_id: "cap5g_contract" } });
  assert.equal(rejected.success, false, "generate_document must reject unsupported kinds");
  assert.equal(rejected.metadata?.tool_id, "generate_document", "generate_document rejection metadata changed");

  const html = await registry.call("generate_document", {
    kind: "html",
    filename: "report.html",
    outline: {
      title: "CAP-5G Report",
      sections: [{ heading: "Summary", body: "Generated through moved owner." }]
    }
  }, { outputDir, task: { task_id: "cap5g_contract" } });
  assert.equal(html.success, true, `generate_document(html) must succeed; got ${html.observation}`);
  assert.equal(html.metadata?.preview_html_path, html.artifact_paths?.[0],
    "HTML artifact must use itself as preview_html_path");
  assert.ok(html.metadata?.reversibility?.checkpoint_id,
    "generate_document must expose primary reversibility metadata");

  const diagram = await registry.call("render_diagram", {
    code: "flowchart TD\nA[Moved] --> B[Owner]",
    filename: "diagram.html"
  }, { outputDir, task: { task_id: "cap5g_contract" } });
  assert.equal(diagram.success, true, `render_diagram must succeed; got ${diagram.observation}`);
  const diagramHtml = await readFile(diagram.artifact_paths[0], "utf8");
  assert.doesNotMatch(diagramHtml, /cdn\.jsdelivr|https:\/\/cdn/iu,
    "render_diagram must not load Mermaid from a CDN");
  assert.match(diagramHtml, /mermaid-fallback/u, "render_diagram fallback contract changed");

  const svg = await registry.call("render_svg", {
    filename: "graphic.svg",
    svg: `<svg viewBox="0 0 20 20" onclick="alert(1)"><script>alert(1)</script><circle cx="10" cy="10" r="8"/></svg>`
  }, { outputDir, task: { task_id: "cap5g_contract" } });
  assert.equal(svg.success, true, `render_svg must succeed; got ${svg.observation}`);
  const svgMarkup = await readFile(svg.artifact_paths[0], "utf8");
  assert.doesNotMatch(svgMarkup, /<script|onclick=/iu, "render_svg must write sanitized SVG");
  assert.match(svgMarkup, /<svg\b/iu, "render_svg artifact must remain SVG markup");
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Document Render Tools Boundary",
  "`src/service/capabilities/tools/document-render-tools.mjs`",
  "generate_document",
  "render_diagram",
  "render_svg",
  "No-Touch Areas",
  "Moved"
]) {
  assert(boundaryDoc.includes(requiredText),
    `document render boundary doc missing required text: ${requiredText}`);
}

console.log("[document-render-tools] contract verified");
