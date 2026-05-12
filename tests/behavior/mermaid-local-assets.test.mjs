import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MERMAID_SCRIPT_SRC,
  renderMermaidScriptTag,
  resolveMermaidScriptSrc
} from "../../src/service/capabilities/tools/mermaid-assets.mjs";
import { RENDER_DIAGRAM_TOOL } from "../../src/service/action_tools/tools/index.mjs";

test("mermaid asset resolver points at the local npm dependency, never a CDN", async () => {
  assert.match(MERMAID_SCRIPT_SRC, /^file:/);
  assert.match(MERMAID_SCRIPT_SRC, /node_modules\/mermaid\/dist\/mermaid\.min\.js/i);
  assert.doesNotMatch(MERMAID_SCRIPT_SRC, /cdn\.jsdelivr|https?:\/\//i);

  const localPath = fileURLToPath(MERMAID_SCRIPT_SRC);
  const info = await stat(localPath);
  assert.equal(info.isFile(), true);
  assert.ok(info.size > 1024 * 1024, "local mermaid bundle should be the real browser build");

  const fallback = resolveMermaidScriptSrc({ resolver: () => "" });
  assert.match(fallback, /^file:/);
  assert.match(fallback, /node_modules\/mermaid\/dist\/mermaid\.min\.js/i);

  assert.equal(
    renderMermaidScriptTag("file:///tmp/a&b.js"),
    '<script src="file:///tmp/a&amp;b.js"></script>'
  );
});

test("generated diagram HTML loads mermaid from the local bundle", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "uca-mermaid-local-"));
  try {
    const result = await RENDER_DIAGRAM_TOOL.execute({
      code: "flowchart TD\n  A[Local] --> B[Mermaid]",
      filename: "diagram.html"
    }, {
      outputDir,
      task: { task_id: "task_mermaid_local" }
    });

    assert.equal(result.success, true);
    const htmlPath = result.artifact_paths?.[0] ?? result.artifactPaths?.[0] ?? result.metadata?.path;
    assert.ok(htmlPath);
    const html = await readFile(htmlPath, "utf8");

    assert.doesNotMatch(html, /cdn\.jsdelivr|https:\/\/cdn/i);
    assert.match(html, /<script src="file:\/\/\/.*node_modules\/mermaid\/dist\/mermaid\.min\.js"><\/script>/i);
    assert.match(html, /typeof mermaid !== "undefined"/);
    assert.match(html, /mermaid-fallback/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("document HTML templates no longer embed a mermaid CDN URL", async () => {
  const source = [
    await readFile("src/service/capabilities/tools/document-render-tools.mjs", "utf8"),
    await readFile("src/service/capabilities/tools/document-artifact-helpers.mjs", "utf8")
  ].join("\n");
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net\/npm\/mermaid/i);
  const localTagUses = source.match(/renderMermaidScriptTag\(\)/g) ?? [];
  assert.ok(localTagUses.length >= 2, "PDF and standalone diagram templates should share the local mermaid asset helper");
});
