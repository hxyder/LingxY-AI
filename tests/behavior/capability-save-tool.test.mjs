import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BUILTIN_ACTION_TOOLS,
  DRAFT_CAPABILITY_TOOL,
  SAVE_CAPABILITY_DRAFT_TOOL
} from "../../src/service/action_tools/tools/index.mjs";
import { ACTION_TOOL_SCHEMAS } from "../../src/service/capabilities/schemas/index.mjs";
import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";

function createRegistry() {
  return createActionToolRegistry(BUILTIN_ACTION_TOOLS);
}

async function makeRuntime({ withSkillsDir = true } = {}) {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "lingxy-cap-save-"));
  const paths = { baseDir };
  if (withSkillsDir) paths.skillsDir = path.join(baseDir, "data", "integrations", "skills");
  const saved = [];
  return {
    paths,
    configStore: {
      load: () => ({}),
      save(next) { saved.push(next); }
    },
    _configSaves: saved
  };
}

async function buildSkillDraft() {
  const result = await DRAFT_CAPABILITY_TOOL.execute({
    kind: "skill",
    name: "Triage Inbox",
    purpose: "Help the user triage their inbox quickly.",
    permissions: { network: false, filesystem: "read", secrets: [] },
    config: { instructions: ["Read the inbox.", "Reply or escalate."] },
    confirmation: true
  }, {});
  assert.equal(result.metadata.status, "ready_to_save");
  return result.metadata.draft;
}

async function buildMcpDraft() {
  const result = await DRAFT_CAPABILITY_TOOL.execute({
    kind: "mcp",
    name: "Search Bridge",
    purpose: "Bridge a search backend over MCP.",
    permissions: {
      network: true,
      filesystem: "none",
      secrets: [{ name: "SEARCH_API_KEY", source: "env" }]
    },
    config: { transport: "stdio", command: "npx", args: ["-y", "search-bridge"] },
    confirmation: true
  }, {});
  assert.equal(result.metadata.status, "ready_to_save");
  return result.metadata.draft;
}

test("save_capability_draft is registered as a high-risk confirmation-required tool", () => {
  const registry = createRegistry();
  const tool = registry.get("save_capability_draft");
  assert.ok(tool, "save_capability_draft must be registered in BUILTIN_ACTION_TOOLS");
  assert.equal(tool.id, "save_capability_draft");
  assert.equal(tool.risk_level, "high");
  assert.equal(tool.requires_confirmation, true);
  assert.deepEqual(tool.required_capabilities, ["file_write"]);
  assert.ok(ACTION_TOOL_SCHEMAS.save_capability_draft, "schema must be present");
  assert.equal(SAVE_CAPABILITY_DRAFT_TOOL.parameters, ACTION_TOOL_SCHEMAS.save_capability_draft);

  const decision = registry.evaluate("save_capability_draft", {}, {});
  assert.equal(decision.requires_confirmation, true);
});

test("save_capability_draft writes SKILL.md under the runtime skillsDir", async () => {
  const runtime = await makeRuntime();
  const draft = await buildSkillDraft();

  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft }, { runtime });

  assert.equal(result.success, true);
  assert.equal(result.metadata.status, "saved");
  assert.equal(result.metadata.kind, "skill");
  assert.equal(result.metadata.enabled, null);
  assert.equal(result.metadata.review_required, true);
  assert.equal(result.metadata.validation.ok, true);
  assert.equal(path.basename(result.metadata.path), "SKILL.md");
  assert.equal(result.artifact_paths[0], result.metadata.path);
  assert.ok(result.metadata.path.startsWith(runtime.paths.skillsDir));

  const written = await readFile(result.metadata.path, "utf8");
  assert.match(written, /^# Triage Inbox/);
  assert.match(result.observation, /editable skill/i);
  assert.match(result.observation, /review or test/i);
});

test("save_capability_draft writes an MCP draft JSON without mutating runtime configStore", async () => {
  const runtime = await makeRuntime();
  const draft = await buildMcpDraft();

  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft }, { runtime });

  assert.equal(result.success, true);
  assert.equal(result.metadata.status, "saved");
  assert.equal(result.metadata.kind, "mcp");
  assert.equal(result.metadata.enabled, false);
  assert.equal(result.metadata.review_required, true);
  assert.equal(path.extname(result.metadata.path), ".json");

  const expectedDir = path.join(runtime.paths.baseDir, "data", "mcp-drafts");
  assert.ok(result.metadata.path.startsWith(expectedDir));

  const stats = await stat(result.metadata.path);
  assert.ok(stats.isFile());
  const body = JSON.parse(await readFile(result.metadata.path, "utf8"));
  assert.equal(body.kind, "mcp");
  assert.equal(body.descriptor.enabled, false);
  assert.equal(body.descriptor.transport, "stdio");
  assert.deepEqual(body.descriptor.env, { SEARCH_API_KEY: "${env:SEARCH_API_KEY}" });

  // The save action MUST NOT touch live MCP runtime config.
  assert.deepEqual(runtime._configSaves, []);
});

test("save_capability_draft uses runtime.paths.mcpDraftsDir when provided", async () => {
  const runtime = await makeRuntime();
  runtime.paths.mcpDraftsDir = path.join(runtime.paths.baseDir, "custom-mcp-drafts");
  const draft = await buildMcpDraft();

  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft }, { runtime });

  assert.equal(result.success, true);
  assert.ok(result.metadata.path.startsWith(runtime.paths.mcpDraftsDir));
});

test("save_capability_draft returns recovery_required when draft is invalid", async () => {
  const runtime = await makeRuntime();
  const draft = await buildSkillDraft();
  // Forge an invalid draft by stripping required content; validateCapabilityDraft
  // should reject it and the tool must surface a recovery proposal rather than write.
  const broken = { ...draft, status: "needs_more_input", missing_fields: ["config"] };

  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft: broken }, { runtime });

  assert.equal(result.success, false);
  assert.equal(result.error, "capability_draft_invalid");
  assert.equal(result.metadata.status, "recovery_required");
  assert.ok(result.metadata.recovery);
  assert.equal(result.metadata.recovery.status, "recovery_required");

  // Nothing should have been written under skillsDir.
  const dir = await readdir(runtime.paths.skillsDir).catch(() => []);
  assert.deepEqual(dir, []);
});

test("save_capability_draft returns structured failure when runtime is missing", async () => {
  const draft = await buildSkillDraft();
  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft }, {});

  assert.equal(result.success, false);
  assert.equal(result.error, "runtime_unavailable");
  assert.equal(result.metadata.status, "runtime_unavailable");
  assert.match(result.observation, /runtime/i);
});

test("save_capability_draft requires a kind-appropriate runtime path", async () => {
  const skillDraft = await buildSkillDraft();
  const mcpDraft = await buildMcpDraft();
  const onlyBase = await makeRuntime({ withSkillsDir: false });
  const onlySkillsDir = await makeRuntime();
  delete onlySkillsDir.paths.baseDir;

  const skillResult = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft: skillDraft }, { runtime: onlyBase });
  assert.equal(skillResult.success, false);
  assert.equal(skillResult.error, "skillsDir_not_configured");

  const mcpResult = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft: mcpDraft }, { runtime: onlySkillsDir });
  assert.equal(mcpResult.success, false);
  assert.equal(mcpResult.error, "mcp_drafts_dir_not_configured");
});

test("save_capability_draft rejects MCP draft whose env contains a literal secret value", async () => {
  const runtime = await makeRuntime();
  const draft = await buildMcpDraft();
  const tampered = {
    ...draft,
    descriptor: {
      ...draft.descriptor,
      env: { SEARCH_API_KEY: "raw-literal-secret-must-not-be-saved" }
    }
  };

  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute({ draft: tampered }, { runtime });

  assert.equal(result.success, false);
  assert.equal(result.error, "capability_draft_invalid");
  assert.equal(result.metadata.status, "recovery_required");

  // Nothing leaked into the drafts directory.
  const draftsDir = path.join(runtime.paths.baseDir, "data", "mcp-drafts");
  const present = await readdir(draftsDir).catch(() => []);
  assert.deepEqual(present, []);
  // And nothing leaked into configStore either.
  assert.deepEqual(runtime._configSaves, []);
});

test("save_capability_draft accepts a completed interview state and rebuilds the draft", async () => {
  const runtime = await makeRuntime();
  const drafted = await DRAFT_CAPABILITY_TOOL.execute({
    kind: "skill",
    name: "Triage Inbox",
    purpose: "Help the user triage their inbox quickly.",
    permissions: { network: false, filesystem: "read", secrets: [] },
    config: { instructions: ["Read the inbox.", "Reply or escalate."] },
    confirmation: true
  }, {});

  const result = await SAVE_CAPABILITY_DRAFT_TOOL.execute(
    { state: drafted.metadata.state },
    { runtime }
  );

  assert.equal(result.success, true);
  assert.equal(result.metadata.kind, "skill");
  assert.equal(path.basename(result.metadata.path), "SKILL.md");
});
