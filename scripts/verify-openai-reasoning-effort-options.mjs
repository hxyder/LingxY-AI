import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const providerCatalog = fs.readFileSync(path.join("src", "shared", "provider-catalog.mjs"), "utf8");
assert.match(providerCatalog, /id:\s*"none",\s*label:\s*"None \(普通 \/ 不思考\)"/, "Shared provider catalog should expose OpenAI reasoning_effort=none");
assert.match(providerCatalog, /id:\s*"minimal"/, "Shared provider catalog should expose OpenAI reasoning_effort=minimal");
assert.match(providerCatalog, /id:\s*"xhigh"/, "Shared provider catalog should expose OpenAI reasoning_effort=xhigh");

const adapter = fs.readFileSync(path.join("src", "service", "executors", "agentic", "provider-adapter.mjs"), "utf8");
assert.match(adapter, /applyReasoningSelectionToBody/, "Provider adapter should use the shared reasoning applicator");

const agentLoop = fs.readFileSync(path.join("src", "service", "executors", "tool_using", "agent-loop.mjs"), "utf8");
assert.match(agentLoop, /applyReasoningSelectionToBody/, "Agent loop fallback should use the shared reasoning applicator");

console.log("OpenAI reasoning_effort options verification passed.");
