import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createActionToolRegistry } from "../src/service/action_tools/registry.mjs";
import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDir = path.join(repoRoot, ".tmp", "verify-edit-file-and-preview");

await rm(workDir, { recursive: true, force: true });
await mkdir(workDir, { recursive: true });

const runtime = {
  paths: { outputsDir: workDir },
  configStore: { load: () => ({ output: { defaultDir: workDir } }) }
};
const ctx = {
  outputDir: workDir,
  runtime,
  task: { task_id: "verify-edit-preview" }
};
const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);

const generated = await registry.call("generate_document", {
  kind: "pptx",
  filename: "deck.pptx",
  outline: {
    title: "Quarterly Review",
    subtitle: "Preview Check",
    slides: [
      { heading: "Overview", bullets: ["Revenue up", "Costs stable"] },
      { heading: "Next Steps", bullets: ["Ship update"] }
    ]
  }
}, ctx);

assert.equal(generated.success, true, `generate_document should succeed: ${generated.observation}`);
const artifactPath = generated.artifact_paths?.[0];
assert.ok(artifactPath && artifactPath.endsWith(".pptx"), "generate_document must return a pptx artifact");

const previewPath = path.join(workDir, "deck-preview.html");
const generatedPreview = await readFile(previewPath, "utf8");
assert.match(generatedPreview, /Quarterly Review/, "preview html should include the document title");
assert.match(generatedPreview, /幻灯片 1/, "preview html should include slide chrome");

const edited = await registry.call("edit_file", {
  path: artifactPath,
  outline: {
    title: "Quarterly Review",
    subtitle: "Updated In Place",
    slides: [
      { heading: "Overview", bullets: ["Revenue up", "Added source links"] },
      { heading: "Visual Refresh", bullets: ["Add image placeholders", "Tighten spacing"] }
    ]
  }
}, ctx);

assert.equal(edited.success, true, `edit_file should succeed: ${edited.observation}`);
assert.equal(edited.artifact_paths?.[0], artifactPath, "edit_file must preserve the existing artifact path");

const updatedPreview = await readFile(previewPath, "utf8");
assert.match(updatedPreview, /Updated In Place/, "preview html should refresh after edit_file");
assert.match(updatedPreview, /Visual Refresh/, "updated preview should contain the revised slide content");

const fileInfo = await stat(artifactPath);
assert.ok(fileInfo.size > 0, "edited artifact should remain non-empty");

console.log("ok verify-edit-file-and-preview");
