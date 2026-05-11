#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MERMAID_SCRIPT_SRC,
  renderMermaidScriptTag,
  resolveMermaidScriptSrc
} from "../src/service/capabilities/tools/mermaid-assets.mjs";
import { RENDER_DIAGRAM_TOOL } from "../src/service/action_tools/tools/index.mjs";
import { renderDocumentPreviewHtml } from "../src/service/capabilities/tools/document-renderer.mjs";

function assertLocalMermaid(src, label) {
  assert.match(src, /^file:/u, `${label} must be a file URL`);
  assert.match(src, /node_modules\/mermaid\/dist\/mermaid\.min\.js/iu,
    `${label} must point at the local Mermaid bundle`);
  assert.doesNotMatch(src, /cdn\.jsdelivr|https?:\/\//iu,
    `${label} must not use CDN or remote URLs`);
}

assertLocalMermaid(MERMAID_SCRIPT_SRC, "MERMAID_SCRIPT_SRC");
const bundlePath = fileURLToPath(MERMAID_SCRIPT_SRC);
const bundleInfo = await stat(bundlePath);
assert.equal(bundleInfo.isFile(), true, "Mermaid bundle must exist");
assert.ok(bundleInfo.size > 1024 * 1024, "Mermaid bundle must be the real browser build");

assertLocalMermaid(resolveMermaidScriptSrc({ resolver: () => "" }), "fallback resolver");
assert.equal(
  renderMermaidScriptTag("file:///tmp/a&b\"<.js"),
  '<script src="file:///tmp/a&amp;b&quot;&lt;.js"></script>',
  "script tag helper must escape HTML attributes"
);

const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-mermaid-assets-"));
try {
  const diagram = await RENDER_DIAGRAM_TOOL.execute({
    code: "flowchart TD\n  A[Local] --> B[Bundle]",
    filename: "diagram.html"
  }, { outputDir });
  assert.equal(diagram.success, true, "render_diagram must succeed");
  const htmlPath = diagram.artifact_paths?.[0] ?? diagram.metadata?.path;
  assert.ok(htmlPath?.endsWith(".html"), "render_diagram must return HTML artifact path");
  const html = await readFile(htmlPath, "utf8");
  assert.doesNotMatch(html, /cdn\.jsdelivr|https:\/\/cdn/iu,
    "render_diagram output must not load Mermaid from CDN");
  assert.match(html, /node_modules\/mermaid\/dist\/mermaid\.min\.js/iu,
    "render_diagram output must load local Mermaid bundle");
  assert.match(html, /mermaid-fallback/u, "render_diagram output must keep fallback rendering");

  const preview = renderDocumentPreviewHtml({
    kind: "docx",
    outline: {
      title: "Mermaid Preview",
      sections: [{ heading: "Flow", diagram: "flowchart LR\n  Start --> Finish" }]
    }
  });
  assert.doesNotMatch(preview, /cdn\.jsdelivr|https:\/\/cdn/iu,
    "document preview output must not load Mermaid from CDN");
  assert.match(preview, /node_modules\/mermaid\/dist\/mermaid\.min\.js/iu,
    "document preview output must load local Mermaid bundle");
  assert.match(preview, /class="mermaid"/u,
    "document preview must render Mermaid blocks");
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log("[mermaid-assets] runtime verified");
