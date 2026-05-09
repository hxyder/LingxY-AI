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
const postRuntimeRoadmap = readRequired("docs/architecture/post-runtime-upgrade-roadmap.md");

assertIncludes(agents, "AGENTS.md", [
  "docs/architecture/agent-runtime-spine.md",
  "docs/architecture/electron-js-runtime-performance-plan.md",
  "docs/architecture/post-runtime-upgrade-roadmap.md",
  "Do not fix runtime bugs with prompt-only patches.",
  "Do not special-case specific user phrases, task ids, conversation ids, or sample",
  "Do not put heavy work in Electron main process or renderer.",
  "Prefer additive migrations, feature flags, and reversible wiring.",
  "Legacy code policy",
  "Mandatory upgrade PR intake protocol",
  "protocol governs code upgrade work only",
  "Module boundaries",
  "Architecture rules file",
  "Task scope",
  "Forbidden modification areas",
  "Interface contracts",
  "Test gate",
  "Design-before-generation",
  "Patch check",
  "Replacement discipline",
  "Legacy removal discipline",
  "delete the old code",
  "variable/name collisions",
]);

assertIncludes(spine, "docs/architecture/agent-runtime-spine.md", [
  "ConversationSession -> FollowUpResolver -> ContextCompiler",
  "Tool calls and tool observations are first-class session items.",
  "Context debugging shows why a context item was included",
  "Mandatory Upgrade PR Protocol",
  "not a runtime rule for every user task",
  "Upgrade task scope",
  "Replacement discipline",
  "Legacy removal discipline",
  "PR-01",
  "Legacy Archive Policy",
  "duplicated route/script registrations",
]);

assertIncludes(
  performance,
  "docs/architecture/electron-js-runtime-performance-plan.md",
  [
    "Electron main process owns app lifecycle",
    "Heavy indexing, context compilation, extraction, graph execution",
    "Streaming UI updates must be batched",
    "mandatory upgrade PR protocol",
    "not a runtime requirement for every user task",
    "replacement discipline",
    "legacy removal discipline",
    "duplicate route/script registrations",
    "Sidecar Decision Gate",
    "PR-02",
  ],
);

assertIncludes(
  postRuntimeRoadmap,
  "docs/architecture/post-runtime-upgrade-roadmap.md",
  [
    "True sub-agent runtime",
    "Multi-model execution",
    "Generic HITL graph resume",
    "Desktop/GUI completion",
    "SQLite write queue / DB worker",
    "Permission/mode model",
    "Sidecar decision record",
    "Optional git checkpoint mode",
    "Program-Grounded Triage",
    "Plugin/MCP marketplace",
    "Privacy/sandbox hardening",
    "SQLite Write-Path Audit And Queue Decision",
    "Permission And Mode Model",
    "Optional Git Checkpoint Mode",
    "Sidecar Decision Record Template",
    "WindowSession State Machine",
    "Sub-Agent Runtime Contract",
    "Bind Model Roles To Real Call Sites",
    "Marketplace Trust Model",
    "OS-Level Sandbox Decision Records",
  ],
);

console.log("[verify-runtime-upgrade-guardrails] guardrails verified");
