#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import { buildContextSelectionProjectPack } from "../src/shared/context-selection-project-pack.mjs";

const contract = readFileSync("src/shared/context-selection-project-pack.mjs", "utf8");
const detailRenderer = readFileSync("src/desktop/renderer/console-task-detail.mjs", "utf8");
const behavior = readFileSync("tests/behavior/context-selection-project-pack.test.mjs", "utf8");
const debugBehavior = readFileSync("tests/behavior/context-debug-panel.test.mjs", "utf8");
const docs = readFileSync("docs/architecture/context-selection-project-pack.md", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-product-gap-roadmap.md", "utf8");

assert.match(contract, /CONTEXT_SELECTION_PROJECT_PACK_VERSION/u, "shared contract must define schema version");
assert.match(contract, /buildContextSelectionProjectPack/u, "shared contract must expose pack builder");
assert.match(contract, /attachments/u, "pack must group attachments");
assert.match(contract, /memoryScope/u, "pack must expose memory scope");
assert.match(contract, /branch/u, "pack must expose conversation branch provenance");
assert.match(contract, /selectedKinds/u, "pack must summarize selected context kinds");
assert.match(contract, /omittedKinds/u, "pack must summarize omitted context kinds");
assert.match(detailRenderer, /buildContextSelectionProjectPack/u, "task detail renderer must consume shared pack builder");
assert.match(detailRenderer, /Project pack/u, "task detail renderer must show the project pack");
assert.match(detailRenderer, /pack\.project\?\.memoryScope/u, "task detail renderer must show memory scope");
assert.match(behavior, /project scope attachments and provenance/u, "behavior tests must cover project scope, attachments, and provenance");
assert.match(debugBehavior, /Project pack/u, "context debug behavior tests must cover project pack rendering");
assert.match(docs, /Renderer surfaces consume the shared view-model/u, "docs must lock renderer/shared boundary");
assert.match(roadmap, /CTX-001 Context selection and project packs \| complete/u, "roadmap must mark CTX-001 complete");

const pack = buildContextSelectionProjectPack({
  conversation_id: "conv",
  project_id: "project",
  context_packet: {
    file_paths: ["E:\\project\\a.txt"],
    compiled_context: {
      selected: [{ kind: "attached_file", source: "context_packet.file_paths", reason: "attached" }],
      omissions: [{ kind: "prior_message", source: "conversation", reason: "omitted_by_budget" }]
    }
  }
});
assert.equal(pack.project.packId, "project:project");
assert.equal(pack.attachments.count, 1);
assert.equal(pack.context.selectedKinds.attached_file, 1);
assert.equal(pack.context.omittedKinds.prior_message, 1);

const command = "node scripts/verify-context-selection-project-pack.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include context selection project pack verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include context selection project pack verifier");

console.log("[context-selection-project-pack] CTX-001 context/project pack contract verified");
