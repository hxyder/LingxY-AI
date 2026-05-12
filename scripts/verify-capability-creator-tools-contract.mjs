#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BUILTIN_ACTION_TOOLS } from "../src/service/action_tools/tools/index.mjs";
import {
  DRAFT_CAPABILITY_TOOL,
  SAVE_CAPABILITY_DRAFT_TOOL
} from "../src/service/capabilities/tools/capability-creator-tools.mjs";
import { ACTION_TOOL_SCHEMAS } from "../src/service/capabilities/schemas/index.mjs";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// CAP-5H verifier.
// Post-move state: capability creator tools are owned by capabilities/tools and
// index.mjs only aggregates and re-exports them.

const aggregatorPath = "src/service/action_tools/tools/index.mjs";
const ownerPath = "src/service/capabilities/tools/capability-creator-tools.mjs";
const oldOwnerPath = "src/service/action_tools/tools/capability-creator-tools.mjs";
const boundaryPath = "docs/architecture/capability-creator-tools-boundary.md";

assert(existsSync(path.join(root, aggregatorPath)), `tool aggregator missing: ${aggregatorPath}`);
assert(existsSync(path.join(root, ownerPath)), `capability creator tool owner missing: ${ownerPath}`);
assert(!existsSync(path.join(root, oldOwnerPath)), `old capability creator owner must not exist: ${oldOwnerPath}`);
assert(existsSync(path.join(root, boundaryPath)), `capability creator boundary doc missing: ${boundaryPath}`);

const indexSrc = read(aggregatorPath);
const ownerSrc = read(ownerPath);
assert(indexSrc.includes("from \"../../capabilities/tools/capability-creator-tools.mjs\""),
  "index.mjs must import capability-creator-tools.mjs from capabilities/tools/");

for (const tool of ["DRAFT_CAPABILITY_TOOL", "SAVE_CAPABILITY_DRAFT_TOOL"]) {
  assert(ownerSrc.includes(`export const ${tool} = {`),
    `capability-creator-tools.mjs must own ${tool}`);
  assert(!indexSrc.includes(`export const ${tool} = {`),
    `index.mjs must not retain capability creator owner text: ${tool}`);
}
for (const ownerText of [
  "function rehydrateInterviewState",
  "function buildOneShotInterviewState",
  "function summarizeDraftForObservation",
  "async function saveCapabilityDraftSkill",
  "async function saveCapabilityDraftMcp",
  "descriptor = { ...(draft.descriptor ?? {}), enabled: false }",
  "validateCapabilityDraft(draft)",
  "createEditableSkill(runtime",
  "resolveMcpDraftsDir(runtime)"
]) {
  assert(ownerSrc.includes(ownerText), `capability-creator-tools.mjs missing ${ownerText}`);
  assert(!indexSrc.includes(ownerText), `index.mjs must not retain capability creator owner text: ${ownerText}`);
}

const tools = new Map(BUILTIN_ACTION_TOOLS.map((tool) => [tool.id, tool]));
assert.equal(tools.get("draft_capability"), DRAFT_CAPABILITY_TOOL,
  "draft_capability must be aggregated from capability-creator-tools.mjs");
assert.equal(tools.get("save_capability_draft"), SAVE_CAPABILITY_DRAFT_TOOL,
  "save_capability_draft must be aggregated from capability-creator-tools.mjs");
assert.equal(DRAFT_CAPABILITY_TOOL.risk_level, "low", "draft_capability risk level changed");
assert.equal(DRAFT_CAPABILITY_TOOL.requires_confirmation, false, "draft_capability confirmation behavior changed");
assert.equal(SAVE_CAPABILITY_DRAFT_TOOL.risk_level, "high", "save_capability_draft risk level changed");
assert.equal(SAVE_CAPABILITY_DRAFT_TOOL.requires_confirmation, true, "save_capability_draft confirmation behavior changed");
assert.deepEqual(SAVE_CAPABILITY_DRAFT_TOOL.required_capabilities, ["file_write"],
  "save_capability_draft required capabilities changed");
assert.equal(DRAFT_CAPABILITY_TOOL.parameters, ACTION_TOOL_SCHEMAS.draft_capability,
  "draft_capability schema object changed");
assert.equal(SAVE_CAPABILITY_DRAFT_TOOL.parameters, ACTION_TOOL_SCHEMAS.save_capability_draft,
  "save_capability_draft schema object changed");

const registry = createActionToolRegistry(BUILTIN_ACTION_TOOLS);
const draftResult = await registry.call("draft_capability", {
  kind: "mcp",
  name: "Search Bridge",
  purpose: "Bridge a search backend over MCP.",
  permissions: {
    network: true,
    filesystem: "none",
    secrets: [{ name: "SEARCH_API_KEY", source: "env", value: "literal-must-not-leak" }]
  },
  config: { transport: "stdio", command: "npx", args: ["-y", "search-bridge"] },
  confirmation: true
}, {});
assert.equal(draftResult.success, true, "draft_capability must still produce a valid draft");
assert.equal(draftResult.metadata?.status, "ready_to_save", "draft_capability ready status changed");
assert.equal(draftResult.metadata?.draft?.descriptor?.enabled, false,
  "MCP drafts must remain disabled by default");
assert(!JSON.stringify(draftResult).includes("literal-must-not-leak"),
  "draft_capability must not leak literal secret values");

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "lingxy-capability-creator-tools-"));
try {
  const runtime = {
    paths: {
      baseDir: tmpRoot,
      skillsDir: path.join(tmpRoot, "data", "integrations", "skills")
    },
    configStore: {
      load: () => ({}),
      save() {
        throw new Error("save_capability_draft must not mutate runtime configStore");
      }
    }
  };
  const saveResult = await registry.call("save_capability_draft", {
    draft: draftResult.metadata.draft
  }, { runtime });
  assert.equal(saveResult.success, true, `save_capability_draft must save MCP draft; got ${saveResult.observation}`);
  assert.equal(saveResult.metadata?.kind, "mcp", "save_capability_draft MCP kind changed");
  assert.equal(saveResult.metadata?.enabled, false, "saved MCP draft must remain disabled");
  assert.equal(path.extname(saveResult.metadata?.path ?? ""), ".json", "MCP draft output path changed");
  const payload = JSON.parse(await readFile(saveResult.metadata.path, "utf8"));
  assert.equal(payload.descriptor.enabled, false, "persisted MCP descriptor must stay disabled");
  assert.deepEqual(payload.descriptor.env, { SEARCH_API_KEY: "${env:SEARCH_API_KEY}" },
    "persisted MCP env references changed");

  const skillDraft = await registry.call("draft_capability", {
    kind: "skill",
    name: "Inbox Helper",
    purpose: "Help the user triage inbox items.",
    permissions: { network: false, filesystem: "read", secrets: [] },
    config: { instructions: ["Read the inbox.", "Group messages."] },
    confirmation: true
  }, {});
  assert.equal(skillDraft.metadata?.status, "ready_to_save", "skill draft ready status changed");
  const skillSave = await registry.call("save_capability_draft", {
    draft: skillDraft.metadata.draft
  }, { runtime });
  assert.equal(skillSave.success, true, `save_capability_draft must save skill draft; got ${skillSave.observation}`);
  assert.equal(path.basename(skillSave.metadata?.path ?? ""), "SKILL.md", "skill draft output filename changed");
  assert.match(await readFile(skillSave.metadata.path, "utf8"), /^# Inbox Helper/u,
    "saved skill markdown heading changed");

  const broken = await registry.call("save_capability_draft", {
    draft: { ...skillDraft.metadata.draft, status: "needs_more_input", missing_fields: ["config"] }
  }, { runtime });
  assert.equal(broken.success, false, "save_capability_draft must reject invalid drafts");
  assert.equal(broken.error, "capability_draft_invalid", "invalid draft error changed");
  assert.deepEqual(await readdir(path.join(tmpRoot, "data", "mcp-drafts")).catch(() => []),
    [path.basename(saveResult.metadata.path)],
    "invalid save must not write extra MCP draft files");
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}

const ids = BUILTIN_ACTION_TOOLS.map((tool) => tool.id);
assert.deepEqual(
  ids.slice(ids.indexOf("draft_capability"), ids.indexOf("save_capability_draft") + 1),
  ["draft_capability", "save_capability_draft"],
  "capability creator registry order changed"
);

const boundaryDoc = read(boundaryPath);
for (const requiredText of [
  "Capability Creator Tools Boundary",
  "`src/service/capabilities/tools/capability-creator-tools.mjs`",
  "draft_capability",
  "save_capability_draft",
  "No-Touch Areas",
  "Moved"
]) {
  assert(boundaryDoc.includes(requiredText),
    `capability creator boundary doc missing required text: ${requiredText}`);
}

console.log("[capability-creator-tools] contract verified");
