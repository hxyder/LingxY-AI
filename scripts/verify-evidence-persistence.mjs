#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const conversationLifecycle = read("src/service/core/task-runtime/conversation-lifecycle.mjs");
const evidenceSourcesView = read("src/desktop/renderer/evidence-sources-view.mjs");
const consoleJs = read("src/desktop/renderer/console.js");
const overlayJs = read("src/desktop/renderer/overlay.js");

assert.ok(/metadata\.evidence_summary\s*=/.test(conversationLifecycle),
  "conversation lifecycle must persist task evidence_summary in assistant message metadata");
assert.ok(/task\?\.evidence_summary[\s\S]{0,120}task\?\.result\?\.evidence_summary/.test(conversationLifecycle),
  "conversation lifecycle must preserve existing task/result evidence summaries without re-extracting");
assert.ok(/export function extractEvidenceSummaryFromMessage/.test(evidenceSourcesView),
  "renderer must expose a message-side evidence extractor for reload rehydration");
assert.ok(/extractEvidenceSummaryFromMessage/.test(consoleJs)
    && /appendConsoleChatEvidenceSourcesToBody/.test(consoleJs),
  "console reload path must rebuild evidence panels from message metadata");
assert.ok(/extractEvidenceSummaryFromMessage/.test(overlayJs)
    && /appendOverlayEvidenceSources/.test(overlayJs),
  "overlay reload path must rebuild evidence panels from message metadata");

console.log("ok verify-evidence-persistence");
