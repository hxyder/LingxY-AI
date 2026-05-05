#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHECK_COMMANDS } from "./check-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (relativePath) => path.join(repoRoot, relativePath);
const read = (relativePath) => readFileSync(repoPath(relativePath), "utf8");

const matrixPath = "docs/release/functional_acceptance_matrix.md";
assert.equal(existsSync(repoPath(matrixPath)), true, "missing functional acceptance matrix");

const matrix = read(matrixPath);
const userInteractionChecklist = read("docs/release/user_interaction_smoke_checklist.md");
const releaseChecklist = read("docs/release/github_release_checklist.md");
const releaseReadiness = read("scripts/verify-release-readiness.mjs");
const releaseConfig = read("tools/release/release-config.json");
const pkg = JSON.parse(read("package.json"));

const scripts = pkg.scripts ?? {};

const requiredDomains = [
  "Desktop shell",
  "Console workspace",
  "Provider and model routing",
  "First useful task path",
  "Tool-using agent",
  "Search and research",
  "Local files and RAG",
  "Rich artifacts",
  "Browser entry",
  "Office entry",
  "Native Windows entry",
  "Scheduler and automation",
  "Connectors",
  "MCP, skills, plugins, and code CLIs",
  "Privacy and safety",
  "Packaging and release"
];

for (const domain of requiredDomains) {
  assert.equal(matrix.includes(`| ${domain} |`), true,
    `functional acceptance matrix missing domain row: ${domain}`);
}

const requiredVerifyScripts = [
  "verify:desktop-shell",
  "verify:desktop-renderer",
  "verify:overlay-composer",
  "verify:console-ui",
  "verify:console-runtime-client",
  "verify:provider-routing",
  "verify:ai-integrations",
  "verify:runtime-wiring",
  "verify:behavior-tests",
  "verify:action-tools",
  "verify:explicit-search-required",
  "verify:single-url-routing",
  "verify:deep-research-tier",
  "verify:research-quality-e2e",
  "verify:file-content-search-tool",
  "verify:file-evidence-coverage",
  "verify:artifact-action-contract",
  "verify:browser-extension",
  "verify:office-base",
  "verify:native-integrations",
  "verify:scheduler",
  "verify:schedule-create-obligation",
  "verify:create-schedule-recursion-guard",
  "verify:unified-connectors",
  "verify:plugin-registry",
  "verify:internal-mcp-server",
  "verify:local-http-surface",
  "verify:security-broker",
  "verify:ui-extras",
  "verify:release-readiness",
  "verify:release-artifact-workflow",
  "verify:agentic-parity",
  "verify:action-claim-guard",
  "verify:public-branding",
  "verify:github-readiness",
  "verify:functional-acceptance",
  "verify:user-interaction-smoke"
];

for (const scriptName of requiredVerifyScripts) {
  assert.equal(typeof scripts[scriptName], "string", `package.json missing script ${scriptName}`);
  const nodeScript = scripts[scriptName].match(/node\s+(scripts\/[^ ]+\.mjs)/u)?.[1];
  if (nodeScript) {
    assert.equal(CHECK_COMMANDS.includes(`node ${nodeScript}`), true,
      `npm run check must include ${nodeScript} for ${scriptName}`);
  } else {
    assert.equal(CHECK_COMMANDS.some((command) => command.includes(scriptName)), true,
      `npm run check must include ${scriptName}`);
  }
  assert.equal(matrix.includes(scriptName), true,
    `functional acceptance matrix must reference ${scriptName}`);
}

const manualRows = [
  "Fresh install",
  "User interaction smoke",
  "Provider smoke",
  "Browser sideload",
  "Office sideload",
  "Explorer entry",
  "Scheduler",
  "Side-effect approval",
  "Artifact quality",
  "MCP/skills",
  "Packaging",
  "Recovery"
];

for (const row of manualRows) {
  assert.equal(matrix.includes(`| ${row} |`), true,
    `functional acceptance matrix missing manual row: ${row}`);
}

assert.equal(releaseChecklist.includes("functional_acceptance_matrix.md"), true,
  "GitHub release checklist must point maintainers to the functional acceptance matrix");
assert.equal(matrix.includes("user_interaction_smoke_checklist.md"), true,
  "functional acceptance matrix must point to the user interaction smoke checklist");
assert.equal(userInteractionChecklist.includes("Voice and Audio"), true,
  "user interaction smoke checklist must cover voice and audio");
assert.equal(userInteractionChecklist.includes("Browser Extension"), true,
  "user interaction smoke checklist must cover the browser extension");
assert.equal(releaseReadiness.includes("docs/release/functional_acceptance_matrix.md"), true,
  "release readiness verifier must require the functional acceptance matrix");
assert.equal(releaseConfig.includes("docs/release/functional_acceptance_matrix.md"), true,
  "trial release config must bundle the functional acceptance matrix");

for (const phrase of [
  "at least one automated verifier",
  "Manual Release Pass",
  "Any partial/fail row must be copied into `docs/release/known_issues.md`"
]) {
  assert.equal(matrix.includes(phrase), true,
    `functional acceptance matrix missing release discipline phrase: ${phrase}`);
}

console.log("ok verify-functional-acceptance");
