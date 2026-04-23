#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const toolIndex = readFileSync(path.join(root, "src/service/action_tools/tools/index.mjs"), "utf8");
const agentLoop = readFileSync(path.join(root, "src/service/executors/tool_using/agent-loop.mjs"), "utf8");

assert.ok(
  toolIndex.includes("__GLOBSTAR_DIR__"),
  "globToRegex should preserve **/ as an optional recursive prefix placeholder"
);
assert.ok(
  toolIndex.includes("(?:.*[/\\\\\\\\])?"),
  "globToRegex should allow **/ patterns to match files in the base dir too"
);

assert.match(
  agentLoop,
  /function extractAbsoluteLocalPathsFromText\(text = ""\)/,
  "agent-loop should extract absolute Windows paths from history/context text"
);
assert.match(
  agentLoop,
  /Absolute local file paths already mentioned in the request\/history/,
  "resource hint should surface known absolute paths explicitly"
);
assert.match(
  agentLoop,
  /Use known absolute paths directly\./,
  "planner instructions should tell the model to reuse known absolute paths instead of rediscovering them"
);
assert.match(
  agentLoop,
  /extractAbsoluteLocalPathsFromText\(task\.context_packet\?\.text \?\? ""\)/,
  "conversation builder should seed artifact/path context from prior history text"
);

console.log("ok verify-glob-and-history-path-routing");
