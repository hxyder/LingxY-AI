#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const surfaces = [
  "src/service/executors/tool_using/tool-surface.mjs",
  "src/service/executors/agentic/tool-surface.mjs"
];

for (const path of surfaces) {
  const source = read(path);

  assert.ok(
    source.includes("taskHasTypedArtifactCapability"),
    `${path} must expose artifact tools from typed TaskSpec/SemanticRouter contracts`
  );
  assert.ok(
    source.includes("artifact_generation"),
    `${path} must recognize the typed artifact_generation capability`
  );
  assert.ok(
    source.includes("needed_capabilities"),
    `${path} must read SemanticRouter needed_capabilities before filtering tool families`
  );
  assert.doesNotMatch(
    source,
    /ARTIFACT_REQUEST_RE|taskTextExplicitlyAsksForArtifact/u,
    `${path} must not use raw user-text artifact regexes as a tool-surface gate`
  );
  assert.doesNotMatch(
    source,
    /EXTERNAL_RESEARCH_ACTION_RE|EXTERNAL_RESEARCH_TOPIC_RE|hasExternalResearchIntent/u,
    `${path} must not use raw current-research topic regexes as a connector/web surface gate`
  );
  assert.ok(
    source.includes("CODE_EXECUTION_TOOL_IDS"),
    `${path} must explicitly govern code-execution tool visibility`
  );
  assert.ok(
    source.includes("taskAllowsCodeExecutionTools"),
    `${path} must hide run_script unless typed capability or explicit execution intent allows it`
  );
}

const testFiles = [
  "tests/behavior/agent-loop-tool-surface.test.mjs",
  "tests/behavior/agentic-tool-surface.test.mjs"
];

for (const path of testFiles) {
  const source = read(path);
  assert.ok(
    source.includes("does not infer artifact writers from raw text without TaskSpec"),
    `${path} must lock that tool-surface no longer infers artifact writes from raw text`
  );
  assert.ok(
    source.includes("typed artifact_generation capability is not vetoed by live text heuristics"),
    `${path} must lock typed artifact_generation precedence over live text`
  );
  assert.ok(
    source.includes("run_script"),
    `${path} must lock code-execution tool-surface governance`
  );
}

const roadmap = read("docs/architecture/post-runtime-upgrade-roadmap.md");
assert.ok(
  roadmap.includes("OQ-004: Typed Artifact Contract Tool Surface"),
  "post-runtime roadmap must track OQ-004"
);
assert.ok(
  roadmap.includes("node scripts/verify-tool-surface-heuristic-governance.mjs"),
  "post-runtime roadmap must list the tool-surface heuristic governance verifier"
);

const manifest = read("scripts/check-manifest.mjs");
assert.ok(
  manifest.includes("node scripts/verify-tool-surface-heuristic-governance.mjs"),
  "fast check manifest must include the tool-surface heuristic governance verifier"
);

console.log("[verify-tool-surface-heuristic-governance] tool-surface typed artifact governance verified");
