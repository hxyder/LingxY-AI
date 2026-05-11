#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RENDER_SVG_TOOL
} from "../src/service/action_tools/tools/index.mjs";
import { renderDocumentPreviewHtml } from "../src/service/capabilities/tools/document-renderer.mjs";
import {
  isSafeSvgMarkup,
  sanitizeSvgMarkup
} from "../src/service/capabilities/tools/svg-sanitize.mjs";

function svgFigure(html = "") {
  return html.match(/<figure class="doc-svg">[\s\S]*?<\/figure>/iu)?.[0] ?? "";
}

function innerSvg(markup = "") {
  return markup.match(/<svg[\s\S]*?<\/svg>/iu)?.[0] ?? markup;
}

function assertSanitized(markup, label) {
  assert.match(markup, /^<svg[\s>]/iu, `${label} must remain SVG markup`);
  assert.doesNotMatch(markup, /<script|foreignObject|iframe|object|embed/iu,
    `${label} must remove forbidden elements`);
  assert.doesNotMatch(markup, /\son[a-z]+\s*=/iu,
    `${label} must remove inline event handlers`);
  assert.doesNotMatch(markup, /javascript:/iu,
    `${label} must remove javascript URLs`);
  assert.doesNotMatch(markup, /xmlns:xlink/iu,
    `${label} must remove xlink namespace declarations`);
}

const malicious = `<?xml version="1.0"?><!doctype svg>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 20" onclick=alert(1)>
  <script>alert(1)</script>
  <foreignObject><body>bad</body></foreignObject>
  <iframe src="https://example.test"></iframe>
  <object data="x"></object>
  <embed src="x"/>
  <a href="javascript:alert(1)" xlink:href="javascript:alert(2)">
    <text x="2" y="12">Safe</text>
  </a>
</svg>`;

const sanitized = sanitizeSvgMarkup(malicious);
assertSanitized(sanitized, "direct sanitizer output");
assert.match(sanitized, /Safe/u, "safe SVG content should remain");
assert.equal(isSafeSvgMarkup(sanitized), true, "sanitized SVG should be safe");

for (const invalid of ["", "not svg", "<div></div>", "<svg><circle /></svg><script></script>", "<svg><circle />"]) {
  assert.equal(sanitizeSvgMarkup(invalid), "", `invalid input must be rejected: ${invalid}`);
  assert.equal(isSafeSvgMarkup(invalid), false, `invalid input must not be safe: ${invalid}`);
}

const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-svg-sanitize-preflight-"));
try {
  const rejected = await RENDER_SVG_TOOL.execute({
    svg: "<script>alert(1)</script>"
  }, { outputDir });
  assert.equal(rejected.success, false, "render_svg must reject non-SVG unsafe input");
  assert.equal(rejected.metadata?.tool_id, "render_svg");

  const result = await RENDER_SVG_TOOL.execute({
    svg: malicious,
    filename: "safe.svg"
  }, { outputDir });
  assert.equal(result.success, true, "render_svg must write sanitized SVG");
  const svgPath = result.artifact_paths?.[0] ?? result.metadata?.path;
  assert.ok(svgPath?.endsWith(".svg"), "render_svg must return an SVG artifact path");
  assert.equal(result.metadata?.mime_type, "image/svg+xml");
  const fileMarkup = await readFile(svgPath, "utf8");
  assertSanitized(fileMarkup, "render_svg artifact");

  const preview = renderDocumentPreviewHtml({
    kind: "docx",
    outline: {
      title: "SVG Preview",
      sections: [{ heading: "Vector", svg: malicious }]
    }
  });
  const figure = svgFigure(preview);
  assert.ok(figure, "document preview must render an SVG figure");
  assertSanitized(innerSvg(figure), "document preview SVG figure");
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log("[svg-sanitize] runtime preflight verified");
