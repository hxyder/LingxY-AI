import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeRequestedArtifacts } from "../../src/service/executors/kimi/output-format.mjs";

test("requested HTML fallback preserves markdown structure instead of wrapping everything in pre", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-requested-html-"));
  try {
    const artifacts = await writeRequestedArtifacts({
      assistantText: [
        "# Research Report",
        "",
        "## Comparison",
        "",
        "| Layer | Purpose |",
        "| --- | --- |",
        "| Planner | Chooses steps |",
        "| Renderer | Writes artifacts |",
        "",
        "- Keep structure",
        "- Keep tables"
      ].join("\n"),
      outputDir,
      requestedFormat: {
        id: "html",
        extension: ".html",
        mimeType: "text/html"
      }
    });

    assert.equal(artifacts.length, 1);
    const html = await readFile(artifacts[0].path, "utf8");
    assert.match(html, /<h1[^>]*>Research Report<\/h1>/);
    assert.match(html, /<h2[^>]*>Comparison<\/h2>/);
    assert.match(html, /<table>/);
    assert.match(html, /<li>Keep structure<\/li>/);
    assert.doesNotMatch(html, /<pre>\s*Research Report/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("requested HTML fallback keeps Mermaid as a local-rendered capability", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-requested-html-mermaid-"));
  try {
    const artifacts = await writeRequestedArtifacts({
      assistantText: [
        "# Diagram",
        "",
        "```mermaid",
        "flowchart TD",
        "  A[Input] --> B[Output]",
        "```"
      ].join("\n"),
      outputDir,
      requestedFormat: {
        id: "html",
        extension: ".html",
        mimeType: "text/html"
      }
    });

    const html = await readFile(artifacts[0].path, "utf8");
    assert.match(html, /node_modules\/mermaid\/dist\/mermaid\.min\.js/i);
    assert.doesNotMatch(html, /cdn\.jsdelivr/i);
    assert.match(html, /language-mermaid|mermaid/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});
