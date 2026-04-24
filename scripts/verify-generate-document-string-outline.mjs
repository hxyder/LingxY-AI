import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { GENERATE_DOCUMENT_TOOL } from "../src/service/action_tools/tools/index.mjs";

function countSlideXmlEntries(buffer) {
  const text = buffer.toString("utf8");
  const matches = text.match(/ppt\/slides\/slide\d+\.xml/g) ?? [];
  return new Set(matches).size;
}

const outputDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-gendoc-verify-"));
const outline = JSON.stringify({
  title: "Weekly Brief",
  subtitle: "String outline should still render",
  slides: [
    { heading: "Overview", bullets: ["Point A", "Point B"] },
    { heading: "Risks", bullets: ["Risk A", "Risk B"] },
    { heading: "Next steps", bullets: ["Do X", "Do Y"] }
  ]
});

const result = await GENERATE_DOCUMENT_TOOL.execute({
  kind: "pptx",
  filename: "weekly-brief.pptx",
  outline
}, { outputDir });

assert.equal(result.success, true);
assert.ok(result.artifact_paths?.[0]);

const pptxBuffer = await readFile(result.artifact_paths[0]);
const slideCount = countSlideXmlEntries(pptxBuffer);

assert.ok(slideCount >= 4, `expected at least 4 slides, got ${slideCount}`);

console.log("verify-generate-document-string-outline: ok");
