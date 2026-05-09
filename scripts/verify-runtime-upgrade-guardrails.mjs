import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readRequired(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(existsSync(absolutePath), `Missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

function assertIncludes(content, relativePath, snippets) {
  for (const snippet of snippets) {
    assert.ok(
      content.includes(snippet),
      `${relativePath} must include guardrail: ${snippet}`,
    );
  }
}

const agents = readRequired("AGENTS.md");
const spine = readRequired("docs/architecture/agent-runtime-spine.md");
const performance = readRequired(
  "docs/architecture/electron-js-runtime-performance-plan.md",
);

assertIncludes(agents, "AGENTS.md", [
  "docs/architecture/agent-runtime-spine.md",
  "docs/architecture/electron-js-runtime-performance-plan.md",
  "Do not fix runtime bugs with prompt-only patches.",
  "Do not special-case specific user phrases, task ids, conversation ids, or sample",
  "Do not put heavy work in Electron main process or renderer.",
  "Prefer additive migrations, feature flags, and reversible wiring.",
  "Legacy code policy",
]);

assertIncludes(spine, "docs/architecture/agent-runtime-spine.md", [
  "ConversationSession -> FollowUpResolver -> ContextCompiler",
  "Tool calls and tool observations are first-class session items.",
  "Context debugging shows why a context item was included",
  "PR-01",
  "Legacy Archive Policy",
]);

assertIncludes(
  performance,
  "docs/architecture/electron-js-runtime-performance-plan.md",
  [
    "Electron main process owns app lifecycle",
    "Heavy indexing, context compilation, extraction, graph execution",
    "Streaming UI updates must be batched",
    "Sidecar Decision Gate",
    "PR-02",
  ],
);

console.log("[verify-runtime-upgrade-guardrails] guardrails verified");
