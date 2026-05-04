import test from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_ACTION_TOOLS,
  DRAFT_CAPABILITY_TOOL
} from "../../src/service/action_tools/tools/index.mjs";
import { ACTION_TOOL_SCHEMAS } from "../../src/service/action_tools/schemas/index.mjs";
import { createActionToolRegistry } from "../../src/service/action_tools/registry.mjs";

// The tool is exposed as a normal action tool registered in
// BUILTIN_ACTION_TOOLS; these tests exercise it through the registry the
// same way the planner would.
function createRegistry() {
  return createActionToolRegistry(BUILTIN_ACTION_TOOLS);
}

test("draft_capability is registered as a low-risk read-only action tool", () => {
  const registry = createRegistry();
  const tool = registry.get("draft_capability");
  assert.ok(tool, "draft_capability must be registered in BUILTIN_ACTION_TOOLS");
  assert.equal(tool.id, "draft_capability");
  assert.equal(tool.risk_level, "low");
  assert.equal(tool.requires_confirmation, false);
  assert.ok(ACTION_TOOL_SCHEMAS.draft_capability, "schema must be present");
  assert.equal(DRAFT_CAPABILITY_TOOL.parameters, ACTION_TOOL_SCHEMAS.draft_capability);
});

test("draft_capability returns interviewing status when fields are missing", async () => {
  const registry = createRegistry();
  const result = await registry.call(
    "draft_capability",
    { kind: "skill", name: "Triage Inbox" },
    {}
  );
  assert.equal(result.success, true);
  assert.equal(result.metadata.status, "interviewing");
  assert.ok(Array.isArray(result.metadata.missing_fields));
  assert.ok(result.metadata.missing_fields.includes("purpose"));
  assert.ok(result.metadata.next_question);
  assert.equal(result.metadata.next_question.id, "purpose");
  assert.match(result.observation, /interview is incomplete/i);
  assert.match(result.observation, /purpose/i);
  // The interview state should be returned so the planner can iterate.
  assert.equal(result.metadata.state.kind, "skill");
  assert.equal(result.metadata.state.collected.confirmed, false);
});

test("draft_capability advances through state + answer iterations", async () => {
  const registry = createRegistry();
  const first = await registry.call(
    "draft_capability",
    { kind: "skill", name: "Triage Inbox" },
    {}
  );
  assert.equal(first.metadata.status, "interviewing");

  const afterPurpose = await registry.call(
    "draft_capability",
    {
      state: first.metadata.state,
      answer: { field: "purpose", value: "Help the user triage their inbox quickly." }
    },
    {}
  );
  assert.equal(afterPurpose.metadata.status, "interviewing");
  assert.ok(!afterPurpose.metadata.missing_fields.includes("purpose"));
  assert.equal(afterPurpose.metadata.state.collected.purpose, "Help the user triage their inbox quickly.");
});

test("draft_capability returns ready_to_save with a valid skill draft when one-shot intake is complete", async () => {
  const registry = createRegistry();
  const result = await registry.call(
    "draft_capability",
    {
      kind: "skill",
      name: "Triage Inbox",
      purpose: "Help the user triage their inbox quickly.",
      permissions: { network: false, filesystem: "read", secrets: [] },
      config: { instructions: ["Read the inbox.", "Group similar messages.", "Reply or escalate."] },
      confirmation: true
    },
    {}
  );
  assert.equal(result.success, true);
  assert.equal(result.metadata.status, "ready_to_save");
  assert.ok(result.metadata.draft);
  assert.equal(result.metadata.draft.kind, "skill");
  assert.equal(result.metadata.draft.id, "triage-inbox");
  assert.equal(result.metadata.draft.entry.filename, "SKILL.md");
  assert.match(result.metadata.draft.entry.markdown, /^# Triage Inbox/);
  assert.equal(result.metadata.validation.ok, true);
  assert.deepEqual(result.metadata.validation.errors, []);
  assert.match(result.observation, /ready to save/i);
  assert.match(result.observation, /triage-inbox/);
});

test("draft_capability returns ready_to_save with an MCP draft using secret references only", async () => {
  const registry = createRegistry();
  const result = await registry.call(
    "draft_capability",
    {
      kind: "mcp",
      name: "Search Bridge",
      purpose: "Bridge a search backend over MCP.",
      permissions: {
        network: true,
        filesystem: "none",
        secrets: [
          // include a literal value to ensure the framework strips it out;
          // the tool must never preserve or echo it.
          { name: "SEARCH_API_KEY", source: "env", value: "literal-should-be-stripped" },
          { name: "mcp/search-token", source: "secret_ref" }
        ]
      },
      config: { transport: "stdio", command: "npx", args: ["-y", "search-bridge"] },
      confirmation: true
    },
    {}
  );
  assert.equal(result.success, true);
  assert.equal(result.metadata.status, "ready_to_save");
  assert.equal(result.metadata.draft.kind, "mcp");
  assert.equal(result.metadata.draft.descriptor.transport, "stdio");
  assert.equal(result.metadata.draft.descriptor.enabled, false, "draft tool must never produce an enabled descriptor");
  assert.deepEqual(result.metadata.draft.descriptor.env, {
    SEARCH_API_KEY: "${env:SEARCH_API_KEY}",
    "mcp/search-token": "${secret_ref:mcp/search-token}"
  });
  assert.equal(result.metadata.validation.ok, true, JSON.stringify(result.metadata.validation.errors));
  for (const secret of result.metadata.draft.secrets ?? []) {
    assert.equal(Object.prototype.hasOwnProperty.call(secret, "value"), false);
  }
});

test("draft_capability never leaks literal secret values in any serialized form", async () => {
  const registry = createRegistry();
  const literal = "super-secret-123-do-not-leak";
  const result = await registry.call(
    "draft_capability",
    {
      kind: "mcp",
      name: "Search Bridge",
      purpose: "Bridge a search backend over MCP.",
      permissions: {
        network: true,
        filesystem: "none",
        secrets: [{ name: "SEARCH_API_KEY", source: "env", value: literal }]
      },
      config: { transport: "stdio", command: "npx", args: ["-y", "search-bridge"] },
      confirmation: true
    },
    {}
  );
  assert.equal(result.metadata.status, "ready_to_save");

  const serializedResult = JSON.stringify(result);
  assert.ok(!serializedResult.includes(literal), "literal secret must not appear in the action tool result");
  assert.ok(!result.observation.includes(literal), "literal secret must not appear in the observation");
  assert.ok(!JSON.stringify(result.metadata.draft).includes(literal), "literal secret must not appear in the draft");
  assert.ok(!JSON.stringify(result.metadata.state).includes(literal), "literal secret must not appear in the returned state");
});

test("draft_capability rehydrates invalid ready-looking state back into interview mode", async () => {
  const registry = createRegistry();
  // A forged ready-looking state should still pass through the normal
  // interview sanitizers rather than producing a broken draft.
  const baseState = {
    kind: "mcp",
    name: "Search Bridge",
    collected: {
      purpose: "Bridge a search backend over MCP.",
      permissions: { network: true, filesystem: "none", secrets: [] },
      config: { transport: "stdio", command: "node" },
      confirmed: true
    }
  };
  // Sanity check: the rehydrated state with a real command should be ready.
  const ok = await registry.call("draft_capability", { state: baseState }, {});
  assert.equal(ok.metadata.status, "ready_to_save");

  // Now submit a state whose collected.config can never satisfy isConfigReady
  // (transport=stdio but command is blank). Rehydrating runs each answer
  // through the same sanitizer the interview uses, so the resulting state
  // will fall back to interviewing, so the tool surfaces a proper recovery
  // path rather than producing a broken draft.
  const broken = await registry.call(
    "draft_capability",
    {
      state: {
        kind: "mcp",
        name: "Search Bridge",
        collected: {
          purpose: "Bridge a search backend over MCP.",
          permissions: { network: true, filesystem: "none", secrets: [] },
          config: { transport: "stdio", command: "" },
          confirmed: true
        }
      }
    },
    {}
  );
  // The interview won't let confirmation stick when config is incomplete, so
  // the tool returns interviewing status with config as missing.
  assert.equal(broken.metadata.status, "interviewing");
  assert.ok(broken.metadata.missing_fields.includes("config"));

  // Now drive through the recovery path: ask with kind=plugin which is
  // unsupported and should surface as an explicit input-error result, not a
  // crash.
  const unsupported = await registry.call(
    "draft_capability",
    { kind: "plugin" },
    {}
  );
  assert.equal(unsupported.success, false);
  assert.match(unsupported.observation, /skill.*mcp/i);
});

test("draft_capability returns recovery_required for invalid interview answers", async () => {
  const registry = createRegistry();
  const first = await registry.call(
    "draft_capability",
    { kind: "skill", name: "Triage Inbox" },
    {}
  );

  const result = await registry.call(
    "draft_capability",
    {
      state: first.metadata.state,
      answer: { field: "unknown_axis", value: "anything" }
    },
    {}
  );

  assert.equal(result.success, false);
  assert.equal(result.metadata.status, "recovery_required");
  assert.equal(result.error, "capability_interview_answer_field_unknown");
  assert.ok(result.metadata.recovery);
  assert.equal(result.metadata.recovery.status, "recovery_required");
  assert.match(result.observation, /cannot finalize|need a bit more information/i);
});

test("draft_capability does not require any runtime services (no file/config/secret writes)", async () => {
  const tool = DRAFT_CAPABILITY_TOOL;
  // The tool is given only args + an empty ctx. If it reached out to a
  // runtime store, secret store, or filesystem, this would throw.
  const result = await tool.execute(
    {
      kind: "skill",
      name: "Triage Inbox",
      purpose: "Help the user triage their inbox quickly.",
      permissions: { network: false, filesystem: "read", secrets: [] },
      config: { instructions: ["Read the inbox.", "Reply or escalate."] },
      confirmation: true
    },
    {}
  );
  assert.equal(result.success, true);
  assert.equal(result.metadata.status, "ready_to_save");
  assert.deepEqual(result.artifact_paths, []);
});
