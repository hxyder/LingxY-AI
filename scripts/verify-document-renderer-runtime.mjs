#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  renderDocument,
  renderDocumentPreviewHtml
} from "../src/service/action_tools/tools/document-renderer.mjs";
import { GENERATE_DOCUMENT_TOOL } from "../src/service/action_tools/tools/index.mjs";

function assertNoUnsafeSvgSurface(html, label) {
  assert.doesNotMatch(html, /<script/i, `${label} must not include script tags`);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${label} must not include inline event handlers`);
  assert.doesNotMatch(html, /javascript:/i, `${label} must not include javascript: URLs`);
}

function svgFigures(html = "") {
  return html.match(/<figure class="doc-svg">[\s\S]*?<\/figure>/giu) ?? [];
}

function assertZipHeader(buffer, label) {
  assert.equal(buffer[0], 0x50, `${label} header byte 0 must be P`);
  assert.equal(buffer[1], 0x4b, `${label} header byte 1 must be K`);
}

const maliciousSvg = `<svg viewBox="0 0 20 20" onclick="alert(1)">
  <script>alert(1)</script>
  <a href="javascript:alert(1)"><circle cx="10" cy="10" r="8"/></a>
  <text x="10" y="12" text-anchor="middle">Safe</text>
</svg>`;

for (const kind of ["docx", "pdf", "pptx", "xlsx"]) {
  const html = renderDocumentPreviewHtml({
    kind,
    outline: {
      title: `<${kind} Preview>`,
      subtitle: "runtime verifier",
      sections: [
        {
          heading: "Diagram & SVG",
          body: "Preview body <must be escaped>",
          diagram: {
            code: "flowchart TD\n  A[Input] --> B[Output]",
            caption: "Flow"
          },
          svg: {
            markup: maliciousSvg,
            caption: "Vector"
          },
          table: {
            headers: ["Name", "Value"],
            rows: [["Alpha", "<escaped>"]]
          }
        }
      ],
      slides: [
        {
          heading: "Slide",
          body: "Slide body <escaped>",
          diagram: "flowchart LR\n  Start --> Finish",
          svg: maliciousSvg
        }
      ],
      sheets: [
        {
          name: "Sheet <One>",
          headers: ["Metric", "Value"],
          rows: [["Score", "<95>"]]
        }
      ]
    }
  });
  assert.match(html, /node_modules\/mermaid\/dist\/mermaid\.min\.js/u,
    `${kind} preview must use the local Mermaid asset`);
  assert.doesNotMatch(html, /cdn\.jsdelivr/i,
    `${kind} preview must not load Mermaid from a CDN`);
  assert.match(html, /&lt;/u, `${kind} preview must escape text content`);
  const figures = svgFigures(html);
  if (kind !== "xlsx") {
    assert.ok(figures.length >= 1, `${kind} preview must render at least one SVG figure`);
    for (const figure of figures) {
      assertNoUnsafeSvgSurface(figure, `${kind} SVG figure`);
    }
  } else {
    assert.equal(figures.length, 0, "xlsx preview should stay table-focused and not invent SVG figures");
  }
}

await assert.rejects(
  () => renderDocument({ kind: "pdf", targetPath: "ignored.pdf", outline: {} }),
  /unsupported kind "pdf"/u,
  "renderDocument helper must only own pptx/docx/xlsx binary rendering"
);

const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-doc-renderer-preflight-"));
try {
  const docxPath = path.join(outputDir, "nested", "report.docx");
  await renderDocument({
    kind: "docx",
    targetPath: docxPath,
    outline: {
      title: "Runtime DOCX",
      sections: [{ heading: "Summary", body: "Direct renderer coverage." }]
    }
  });
  assertZipHeader(await readFile(docxPath), "docx");

  const xlsxPath = path.join(outputDir, "nested", "report.xlsx");
  await renderDocument({
    kind: "xlsx",
    targetPath: xlsxPath,
    outline: {
      sheets: [{ name: "Metrics", headers: ["Name", "Score"], rows: [["Alpha", 91]] }]
    }
  });
  assertZipHeader(await readFile(xlsxPath), "xlsx");

  const pptxPath = path.join(outputDir, "nested", "report.pptx");
  await renderDocument({
    kind: "pptx",
    targetPath: pptxPath,
    outline: {
      title: "Runtime PPTX",
      slides: [{ heading: "Summary", bullets: ["Direct renderer coverage"] }]
    }
  });
  assertZipHeader(await readFile(pptxPath), "pptx");

  const htmlResult = await GENERATE_DOCUMENT_TOOL.execute({
    kind: "html",
    filename: "artifact.html",
    outline: {
      title: "HTML Artifact",
      sections: [{
        heading: "Safe Components",
        body: "Standalone HTML output.",
        diagram: "flowchart TD\n  A --> B",
        svg: maliciousSvg
      }]
    }
  }, {
    outputDir,
    task: { task_id: "task_document_renderer_preflight" }
  });
  assert.equal(htmlResult.success, true, "generate_document(html) must succeed");
  assert.equal(htmlResult.metadata?.tool_id, "generate_document");
  assert.equal(htmlResult.metadata?.kind, "html");
  const htmlPath = htmlResult.artifact_paths?.[0] ?? htmlResult.artifactPaths?.[0];
  assert.equal(htmlResult.metadata?.preview_html_path, htmlPath,
    "HTML artifacts must use the artifact itself as preview_html_path");
  assert.ok(htmlResult.metadata?.reversibility,
    "generate_document(html) must record primary reversibility metadata");
  assert.ok(htmlPath?.endsWith(".html"), "HTML artifact path must be returned");
  assert.ok((await stat(htmlPath)).size > 500, "HTML artifact must be non-trivial");
  const htmlContent = await readFile(htmlPath, "utf8");
  assert.match(htmlContent, /class="doc-diagram"/u, "HTML artifact must render diagrams");
  assert.match(htmlContent, /class="doc-svg"/u, "HTML artifact must render SVG components");
  const figures = svgFigures(htmlContent);
  assert.ok(figures.length >= 1, "HTML artifact must render at least one SVG figure");
  for (const figure of figures) {
    assertNoUnsafeSvgSurface(figure, "HTML artifact SVG figure");
  }
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log("[document-renderer] runtime preflight verified");
