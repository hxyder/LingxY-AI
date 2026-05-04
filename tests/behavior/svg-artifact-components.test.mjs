import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATE_DOCUMENT_TOOL,
  RENDER_SVG_TOOL
} from "../../src/service/action_tools/tools/index.mjs";
import { renderDocumentPreviewHtml } from "../../src/service/action_tools/tools/document-renderer.mjs";
import { sanitizeSvgMarkup } from "../../src/service/action_tools/tools/svg-sanitize.mjs";

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120">
  <rect width="240" height="120" fill="#f8fafc"/>
  <circle cx="60" cy="60" r="32" fill="#2563eb"/>
  <path d="M100 60h80" stroke="#0f172a" stroke-width="8" stroke-linecap="round"/>
  <text x="120" y="95" font-size="16" text-anchor="middle">Vector</text>
</svg>`;

function firstSvgFigure(html = "") {
  return html.match(/<figure class="doc-svg">[\s\S]*?<\/figure>/i)?.[0] ?? "";
}

test("SVG sanitizer keeps safe vector markup and removes script surfaces", () => {
  const sanitized = sanitizeSvgMarkup(`<svg viewBox="0 0 10 10" onclick="alert(1)">
    <script>alert(1)</script>
    <a href="javascript:alert(1)"><circle cx="5" cy="5" r="4"/></a>
  </svg>`);

  assert.match(sanitized, /^<svg/i);
  assert.doesNotMatch(sanitized, /script/i);
  assert.doesNotMatch(sanitized, /onclick/i);
  assert.doesNotMatch(sanitized, /javascript:/i);
});

test("render_svg writes sanitized standalone SVG artifacts", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-render-svg-"));
  try {
    const result = await RENDER_SVG_TOOL.execute({
      svg: SAMPLE_SVG,
      filename: "vector.svg"
    }, { outputDir });

    assert.equal(result.success, true);
    const svgPath = result.artifact_paths?.[0] ?? result.metadata?.path;
    assert.ok(svgPath?.endsWith(".svg"));
    assert.ok((await stat(svgPath)).size > 100);
    const content = await readFile(svgPath, "utf8");
    assert.match(content, /<svg/);
    assert.match(content, /Vector/);
    assert.doesNotMatch(content, /<script/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generate_document renders structured SVG components in PDF HTML", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-doc-svg-"));
  try {
    const result = await GENERATE_DOCUMENT_TOOL.execute({
      kind: "pdf",
      filename: "report.pdf",
      outline: {
        title: "Vector Artifact",
        sections: [
          {
            heading: "Visual Layer",
            body: "A reusable artifact section.",
            svg: {
              markup: SAMPLE_SVG,
              caption: "Vector component"
            }
          }
        ]
      }
    }, {
      outputDir,
      task: { task_id: "task_svg_component" }
    });

    assert.equal(result.success, true);
    const pdfPath = result.artifact_paths?.[0] ?? result.metadata?.path;
    assert.ok(pdfPath);

    const html = await readFile(path.join(outputDir, "report.html"), "utf8");
    assert.match(html, /class="doc-svg"/);
    assert.match(html, /Vector component/);
    assert.match(html, /<svg/);
    const figure = firstSvgFigure(html);
    assert.doesNotMatch(figure, /<script/i);
    assert.doesNotMatch(figure, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(figure, /javascript:/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("document preview renderer supports structured SVG components", () => {
  const html = renderDocumentPreviewHtml({
    kind: "docx",
    outline: {
      title: "Preview",
      sections: [
        {
          heading: "Vector",
          svg: SAMPLE_SVG
        }
      ]
    }
  });

  assert.match(html, /class="doc-svg"/);
  assert.match(html, /<svg/);
  assert.match(html, /Vector/);
  const figure = firstSvgFigure(html);
  assert.doesNotMatch(figure, /<script/i);
  assert.doesNotMatch(figure, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(figure, /javascript:/i);
});
