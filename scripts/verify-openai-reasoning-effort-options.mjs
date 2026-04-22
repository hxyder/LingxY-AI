import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const consoleJs = fs.readFileSync(path.join("src", "desktop", "renderer", "console.js"), "utf8");
assert.match(consoleJs, /id:\s*"none",\s*label:\s*"None \(普通 \/ 不思考\)"/, "UI should expose OpenAI reasoning_effort=none");
assert.match(consoleJs, /id:\s*"minimal"/, "UI should expose OpenAI reasoning_effort=minimal");
assert.match(consoleJs, /id:\s*"xhigh"/, "UI should expose OpenAI reasoning_effort=xhigh");

const adapter = fs.readFileSync(path.join("src", "service", "executors", "agentic", "provider-adapter.mjs"), "utf8");
assert.match(adapter, /\["none", "minimal", "low", "medium", "high", "xhigh"\]/, "Provider adapter should forward all official OpenAI reasoning_effort values");

const agentLoop = fs.readFileSync(path.join("src", "service", "executors", "tool_using", "agent-loop.mjs"), "utf8");
assert.match(agentLoop, /\["none", "minimal", "low", "medium", "high", "xhigh"\]/, "Agent loop fallback should forward all official OpenAI reasoning_effort values");

console.log("OpenAI reasoning_effort options verification passed.");
