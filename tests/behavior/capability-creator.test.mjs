import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCapabilityInterviewAnswer,
  buildCapabilityDraft,
  buildCapabilityInterviewState,
  buildCapabilityRecoveryProposal,
  validateCapabilityDraft
} from "../../src/service/core/capability-creator/index.mjs";

function fillSkillState({ name = "Triage Inbox", instructions = ["Read the inbox.", "Group similar messages.", "Reply or escalate."] } = {}) {
  let state = buildCapabilityInterviewState({ kind: "skill", name });
  state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: "Help the user triage their inbox quickly." });
  state = applyCapabilityInterviewAnswer(state, {
    field: "permissions",
    value: { network: false, filesystem: "read", secrets: [] }
  });
  state = applyCapabilityInterviewAnswer(state, {
    field: "config",
    value: { instructions }
  });
  return state;
}

function fillMcpState({
  name = "Local Notes Server",
  command = "node",
  args = ["./mcp-notes/server.js"],
  secrets = [{ name: "NOTES_TOKEN", source: "env" }]
} = {}) {
  let state = buildCapabilityInterviewState({ kind: "mcp", name });
  state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: "Expose a local notes index over MCP." });
  state = applyCapabilityInterviewAnswer(state, {
    field: "permissions",
    value: { network: false, filesystem: "read", secrets }
  });
  state = applyCapabilityInterviewAnswer(state, {
    field: "config",
    value: { transport: "stdio", command, args }
  });
  return state;
}

test("capability creator rejects unknown kinds at interview start", () => {
  assert.throws(() => buildCapabilityInterviewState({ kind: "plugin" }), /capability_interview_kind_unsupported/);
  assert.throws(() => buildCapabilityInterviewState({}), /capability_interview_kind_unsupported/);
});

test("capability creator initial state lists every required field as missing", () => {
  const state = buildCapabilityInterviewState({ kind: "skill", name: "Anything" });
  assert.equal(state.kind, "skill");
  assert.equal(state.status, "interviewing");
  assert.deepEqual(state.missing_fields, ["purpose", "permissions", "config", "confirmation"]);
  assert.equal(state.next_question?.id, "purpose");
});

test("capability creator does not produce a write-ready draft until explicit confirmation", () => {
  const state = fillSkillState();
  assert.equal(state.status, "interviewing");
  assert.deepEqual(state.missing_fields, ["confirmation"]);

  const draftBefore = buildCapabilityDraft(state);
  assert.equal(draftBefore.status, "needs_more_input");
  assert.deepEqual(draftBefore.missing_fields, ["confirmation"]);

  const validationBefore = validateCapabilityDraft(draftBefore);
  assert.equal(validationBefore.ok, false);
  assert.ok(validationBefore.errors.some((entry) => entry.field === "status"));
});

test("capability creator ignores premature confirmation when other fields are unanswered", () => {
  const start = buildCapabilityInterviewState({ kind: "skill", name: "Premature" });
  const confirmed = applyCapabilityInterviewAnswer(start, { field: "confirmation", value: true });
  assert.equal(confirmed.collected.confirmed, false);
  assert.equal(confirmed.status, "interviewing");
  assert.ok(confirmed.missing_fields.includes("purpose"));
  assert.ok(confirmed.missing_fields.includes("permissions"));
  assert.ok(confirmed.missing_fields.includes("config"));
  const draft = buildCapabilityDraft(confirmed);
  assert.equal(draft.status, "needs_more_input");
});

test("capability creator requires a fresh confirmation after draft inputs change", () => {
  let state = applyCapabilityInterviewAnswer(fillSkillState(), { field: "confirmation", value: true });
  assert.equal(state.status, "ready_to_save");

  state = applyCapabilityInterviewAnswer(state, {
    field: "config",
    value: { instructions: ["Read the queue.", "Summarize action items."] }
  });

  assert.equal(state.status, "interviewing");
  assert.equal(state.collected.confirmed, false);
  assert.deepEqual(state.missing_fields, ["confirmation"]);
  assert.equal(buildCapabilityDraft(state).status, "needs_more_input");
});

test("capability creator builds a valid skill draft once the interview is confirmed", () => {
  const state = applyCapabilityInterviewAnswer(fillSkillState(), { field: "confirmation", value: true });
  assert.equal(state.status, "ready_to_save");
  assert.deepEqual(state.missing_fields, []);

  const draft = buildCapabilityDraft(state);
  assert.equal(draft.kind, "skill");
  assert.equal(draft.status, "ready_to_save");
  assert.equal(draft.id, "triage-inbox");
  assert.equal(draft.entry.filename, "SKILL.md");
  assert.match(draft.entry.markdown, /^# Triage Inbox/);
  assert.match(draft.entry.markdown, /Help the user triage their inbox quickly\./);
  assert.match(draft.entry.markdown, /- Read the inbox\./);

  const validation = validateCapabilityDraft(draft);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
});

test("capability creator builds a valid MCP descriptor that passes validateMcpServerDescriptor", () => {
  const state = applyCapabilityInterviewAnswer(fillMcpState(), { field: "confirmation", value: true });
  const draft = buildCapabilityDraft(state);
  assert.equal(draft.kind, "mcp");
  assert.equal(draft.status, "ready_to_save");
  assert.equal(draft.descriptor.transport, "stdio");
  assert.equal(draft.descriptor.command, "node");
  assert.equal(draft.descriptor.enabled, false);

  const validation = validateCapabilityDraft(draft);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("capability creator represents secrets as references and never persists literal values", () => {
  let state = buildCapabilityInterviewState({ kind: "mcp", name: "Search Bridge" });
  state = applyCapabilityInterviewAnswer(state, { field: "purpose", value: "Search bridge." });
  state = applyCapabilityInterviewAnswer(state, {
    field: "permissions",
    value: {
      network: true,
      filesystem: "none",
      secrets: [
        { name: "SEARCH_API_KEY", source: "env", value: "literal-should-be-discarded" },
        "FALLBACK_TOKEN"
      ]
    }
  });
  state = applyCapabilityInterviewAnswer(state, {
    field: "config",
    value: { transport: "stdio", command: "npx", args: ["-y", "search-bridge"] }
  });
  state = applyCapabilityInterviewAnswer(state, { field: "confirmation", value: true });

  const collectedSecrets = state.collected.permissions.secrets;
  assert.equal(collectedSecrets.length, 2);
  for (const entry of collectedSecrets) {
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "value"), false);
    assert.ok(["env", "secret_ref"].includes(entry.source));
  }

  const draft = buildCapabilityDraft(state);
  for (const entry of draft.secrets) {
    assert.equal(Object.prototype.hasOwnProperty.call(entry, "value"), false);
  }
  assert.deepEqual(draft.descriptor.env, {
    SEARCH_API_KEY: "${env:SEARCH_API_KEY}",
    FALLBACK_TOKEN: "${env:FALLBACK_TOKEN}"
  });
  const serialized = JSON.stringify(draft);
  assert.ok(!serialized.includes("literal-should-be-discarded"), "literal secret value must not appear in draft");

  const validation = validateCapabilityDraft(draft);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("capability creator preserves secret_ref secrets as descriptor references", () => {
  const state = applyCapabilityInterviewAnswer(fillMcpState({
    secrets: [{ name: "mcp/search-token", source: "secret_ref" }]
  }), { field: "confirmation", value: true });

  const draft = buildCapabilityDraft(state);
  assert.deepEqual(draft.descriptor.env, {
    "mcp/search-token": "${secret_ref:mcp/search-token}"
  });
  assert.equal(validateCapabilityDraft(draft).ok, true);
});

test("capability creator validation accepts URL-encoded secret_ref references", () => {
  const state = applyCapabilityInterviewAnswer(fillMcpState(), { field: "confirmation", value: true });
  const draft = buildCapabilityDraft(state);
  const withEncodedRef = {
    ...draft,
    descriptor: {
      ...draft.descriptor,
      env: { API_KEY: "${secret_ref:secret://lingxy/mcp/custom%20server/env/API_KEY}" }
    }
  };
  assert.equal(validateCapabilityDraft(withEncodedRef).ok, true);
});

test("capability creator validation rejects drafts that smuggle in literal secret values", () => {
  const state = applyCapabilityInterviewAnswer(fillMcpState(), { field: "confirmation", value: true });
  const draft = buildCapabilityDraft(state);
  const tampered = {
    ...draft,
    secrets: [{ name: "NOTES_TOKEN", source: "env", value: "leak" }]
  };
  const validation = validateCapabilityDraft(tampered);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((entry) => entry.field === "secrets"));
});

test("capability creator validation rejects literal MCP descriptor env values", () => {
  const state = applyCapabilityInterviewAnswer(fillMcpState(), { field: "confirmation", value: true });
  const draft = buildCapabilityDraft(state);
  const tampered = {
    ...draft,
    descriptor: {
      ...draft.descriptor,
      env: { NOTES_TOKEN: "literal-token" }
    }
  };
  const validation = validateCapabilityDraft(tampered);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((entry) => entry.field === "env"));
});

test("capability creator recovery proposal converts validation failures into a structured prompt", () => {
  const state = fillMcpState({ command: "" });
  const confirmed = applyCapabilityInterviewAnswer(state, { field: "confirmation", value: true });
  // command is empty so config is not ready; interview should still flag config as missing
  assert.ok(confirmed.missing_fields.includes("config"));

  const draftBeforeFix = buildCapabilityDraft(confirmed);
  assert.equal(draftBeforeFix.status, "needs_more_input");

  const validation = validateCapabilityDraft(draftBeforeFix);
  assert.equal(validation.ok, false);

  const proposal = buildCapabilityRecoveryProposal(validation);
  assert.equal(proposal.status, "recovery_required");
  assert.ok(proposal.missing_fields.length > 0);
  assert.ok(typeof proposal.question === "string" && proposal.question.length > 0);
  assert.ok(Array.isArray(proposal.suggested_next_actions));
  for (const action of proposal.suggested_next_actions) {
    assert.equal(action.type, "answer_interview_field");
    assert.ok(["purpose", "permissions", "config", "confirmation", "name"].includes(action.field));
    assert.ok(typeof action.prompt === "string" && action.prompt.length > 0);
  }
});

test("capability creator recovery proposal handles raw MCP descriptor validation errors", () => {
  const proposal = buildCapabilityRecoveryProposal({
    ok: false,
    errors: [
      { field: "command", message: "Stdio transport requires a command." },
      { field: "id", message: "Server id is required." }
    ]
  });
  assert.equal(proposal.status, "recovery_required");
  assert.deepEqual(proposal.missing_fields, ["command", "id"]);
  const fields = proposal.suggested_next_actions.map((entry) => entry.field);
  assert.ok(fields.includes("config"));
  assert.ok(fields.includes("name"));
  assert.ok(proposal.question.includes("Stdio transport requires a command."));
});

test("capability creator recovery proposal accepts a thrown error without crashing", () => {
  const proposal = buildCapabilityRecoveryProposal(new Error("descriptor_unparseable"));
  assert.equal(proposal.status, "recovery_required");
  assert.ok(proposal.question.includes("descriptor_unparseable"));
  assert.deepEqual(proposal.missing_fields, ["exception"]);
});
