import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GENERATE_DOCUMENT_TOOL } from "../../src/service/action_tools/tools/index.mjs";
import { renderDocumentPreviewHtml } from "../../src/service/capabilities/tools/document-renderer.mjs";

test("generate_document renders structured diagram components in PDF HTML", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-doc-diagram-"));
  try {
    const result = await GENERATE_DOCUMENT_TOOL.execute({
      kind: "pdf",
      filename: "report.pdf",
      outline: {
        title: "Structured Artifact",
        sections: [
          {
            heading: "System View",
            body: "A reusable artifact section.",
            diagram: {
              code: "flowchart TD\n  A[Input] --> B[Process]\n  B --> C[Output]",
              caption: "System flow"
            }
          }
        ]
      }
    }, {
      outputDir,
      task: { task_id: "task_document_diagram_component" }
    });

    assert.equal(result.success, true);
    const pdfPath = result.artifact_paths?.[0] ?? result.metadata?.path;
    assert.ok(pdfPath);
    assert.ok((await stat(pdfPath)).size > 1024);

    const html = await readFile(path.join(outputDir, "report.html"), "utf8");
    assert.match(html, /class="doc-diagram"/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /System flow/);
    assert.match(html, /A\[Input\] --&gt; B\[Process\]/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("generate_document renders structured components in standalone HTML artifact", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-doc-html-"));
  try {
    const result = await GENERATE_DOCUMENT_TOOL.execute({
      kind: "html",
      filename: "report.html",
      outline: {
        title: "Structured HTML Artifact",
        sections: [
          {
            heading: "Evidence Table",
            body: "Standalone HTML can carry richer, refreshable previews.",
            table: {
              headers: ["Component", "Purpose"],
              rows: [["Table", "Comparison"], ["Diagram", "Flow"]]
            },
            diagram: {
              code: "flowchart TD\n  A[Input] --> B[Process]\n  B --> C[Output]",
              caption: "System flow"
            },
            svg: {
              markup: "<svg viewBox=\"0 0 80 40\"><rect width=\"80\" height=\"40\" rx=\"6\" fill=\"#0f766e\"/><text x=\"40\" y=\"24\" text-anchor=\"middle\" fill=\"white\">SVG</text></svg>",
              caption: "Vector block"
            }
          }
        ]
      }
    }, {
      outputDir,
      task: { task_id: "task_document_html_component" }
    });

    assert.equal(result.success, true);
    assert.equal(path.extname(result.artifact_paths?.[0] ?? ""), ".html");
    assert.equal(result.metadata?.preview_html_path, result.artifact_paths?.[0]);

    const html = await readFile(path.join(outputDir, "report.html"), "utf8");
    assert.match(html, /Structured HTML Artifact/);
    assert.match(html, /class="doc-table"/);
    assert.match(html, /class="doc-diagram"/);
    assert.match(html, /class="mermaid"/);
    assert.match(html, /<svg viewBox="0 0 80 40"/);
    assert.match(html, /node_modules\/mermaid\/dist\/mermaid\.min\.js/);
    assert.doesNotMatch(html, /cdn\.jsdelivr/i);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("document preview renderer supports structured diagram components", () => {
  const html = renderDocumentPreviewHtml({
    kind: "docx",
    outline: {
      title: "Preview",
      sections: [
        {
          heading: "Flow",
          diagram: "flowchart LR\n  Start --> Finish"
        }
      ]
    }
  });

  assert.match(html, /class="doc-diagram"/);
  assert.match(html, /class="mermaid"/);
  assert.match(html, /Start --&gt; Finish/);
  assert.doesNotMatch(html, /cdn\.jsdelivr/i);
});
