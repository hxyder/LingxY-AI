#!/usr/bin/env node
/**
 * verify-artifact-recovery-hook.mjs — B2-a (b) full hook
 *
 * The 109-corpus regression: D-class 6/10 missing_artifact failures.
 * The LLM emitted markdown content as final_text but never called
 * generate_document, so the success-contract validator caught
 * `artifact_required_not_created` and the run downgraded to
 * partial_success. The deterministic recovery hook plugs into
 * agent-loop.finaliseWithArtifactContract and tries ONCE to
 * materialise the final_text via generate_document before the
 * downgrade.
 *
 * This verifier exercises the recovery path AT THE FINALISER LEVEL
 * via the exported `finaliseWithArtifactContract` and
 * `attemptArtifactRecovery` helpers — driving the full agent loop
 * needs heavy stub plumbing (provider, conversation history, etc.)
 * that adds noise without testing the recovery decision.
 *
 * Constitution check (CADRE C):
 *   - 不打补丁: the recovery only triggers via the existing violation
 *     channel (artifact_required_not_created) and only invokes tools
 *     in POLICY_GROUPS.artifact_generation. No per-task carve-outs.
 *   - 不针对特定提问: the kind alias map (word→docx etc.) and the
 *     html default work uniformly across every task that asks for
 *     an artifact.
 */

import {
  attemptArtifactRecovery,
  finaliseWithArtifactContract
} from "../src/service/executors/tool_using/agent-loop.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

function createStubRegistry({ generateImpl } = {}) {
  const tools = [
    {
      id: "generate_document",
      name: "Generate Document",
      description: "stub",
      parameters: {},
      async execute(args, ctx) {
        if (!generateImpl) {
          return {
            success: true,
            observation: `(stub) generated ${args.kind}`,
            metadata: {
              tool_id: "generate_document",
              kind: args.kind,
              path: `/tmp/stub.${args.kind}`,
              artifact_kind: args.kind
            }
          };
        }
        return generateImpl(args, ctx);
      }
    }
  ];
  return {
    list() { return tools; }
  };
}

function createStubRuntime({ generateImpl, omitGenerateTool = false } = {}) {
  const events = [];
  const audit = [];
  const registry = omitGenerateTool
    ? { list() { return []; } }
    : createStubRegistry({ generateImpl });
  return {
    actionToolRegistry: registry,
    emitTaskEvent(name, payload) { events.push({ name, payload }); },
    store: {
      appendAuditLog(entry) { audit.push(entry); }
    },
    events,
    audit
  };
}

function makeArtifactRequiredTask({ kind = "docx", userCommand = "make me a doc summarising AI agents" } = {}) {
  return {
    task_id: `task_${Math.random().toString(36).slice(2, 10)}`,
    user_command: userCommand,
    task_spec: {
      goal: "generate_document",
      artifact: { required: true, kind },
      success_contract: {
        artifact_created: true,
        required_policy_groups: ["artifact_generation"]
      }
    }
  };
}

function makeSuccessResult(finalText, transcript = []) {
  return {
    status: "success",
    final_text: finalText,
    transcript
  };
}

// ----------------------------------------------------------------------
// 1. Recovery succeeds: artifact_required + final_text + tool available
//    → status stays "success", artifact_recovery.applied = true.
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "docx" });
  const result = makeSuccessResult("# AI Agents Summary\n\nDeep summary content here.");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "recovery success: status stays success",
    out.status === "success"
  );
  check(
    "recovery success: artifact_recovery.applied = true",
    out.artifact_recovery?.applied === true
  );
  check(
    "recovery success: kind = docx (passed through from spec)",
    out.artifact_recovery?.kind === "docx"
  );
  check(
    "recovery success: emitted artifact_recovery_succeeded event",
    runtime.events.some((e) => e.name === "artifact_recovery_succeeded")
  );
  check(
    "recovery success: appended audit log",
    runtime.audit.some((a) => a.event_subtype === "tool_loop.artifact_recovery_succeeded")
  );
  check(
    "recovery success: transcript has the recovered tool result tagged",
    Array.isArray(out.transcript)
      && out.transcript.some((entry) =>
        entry?.tool === "generate_document"
        && entry?.recovery === "artifact_required_deterministic"
      )
  );
}

// ----------------------------------------------------------------------
// 2. Recovery unavailable (registry missing generate_document) →
//    partial_success with reason = "no_generate_document".
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime({ omitGenerateTool: true });
  const task = makeArtifactRequiredTask({ kind: "html" });
  const result = makeSuccessResult("Some content the user expected as html.");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "recovery unavailable: status = partial_success",
    out.status === "partial_success"
  );
  check(
    "recovery unavailable: artifact_recovery.applied = false",
    out.artifact_recovery?.applied === false
  );
  check(
    "recovery unavailable: reason = no_generate_document",
    out.artifact_recovery?.reason === "no_generate_document"
  );
  check(
    "recovery unavailable: contract_violations carries artifact_required_not_created",
    Array.isArray(out.contract_violations)
      && out.contract_violations.some((v) => v.kind === "artifact_required_not_created")
  );
  // INVARIANT: no email_send / connector_workflow_run / open_url
  // appears in any audit log or event under "recovery" — the safety
  // floor never lets recovery touch a side-effect tool.
  const sideEffectMentions = runtime.events.filter((e) =>
    /email_send|connector_workflow_run|open_url|account_send_email/.test(JSON.stringify(e.payload ?? {}))
  );
  check(
    "INVARIANT: no side-effect tool referenced in recovery events",
    sideEffectMentions.length === 0
  );
}

// ----------------------------------------------------------------------
// 3. Recovery exception (tool throws) → partial_success with reason
//    = "recovery_exception:<message>".
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime({
    generateImpl: async () => { throw new Error("disk_full"); }
  });
  const task = makeArtifactRequiredTask({ kind: "pptx" });
  const result = makeSuccessResult("Some content.");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "recovery exception: status = partial_success",
    out.status === "partial_success"
  );
  check(
    "recovery exception: reason starts with recovery_exception:",
    typeof out.artifact_recovery?.reason === "string"
      && out.artifact_recovery.reason.startsWith("recovery_exception:")
  );
  check(
    "recovery exception: error message preserved (disk_full)",
    out.artifact_recovery?.reason?.includes("disk_full") === true
  );
}

// ----------------------------------------------------------------------
// 4. Recovery returns success:false → partial_success with reason
//    = "recovery_failed:<observation>".
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime({
    generateImpl: async () => ({
      success: false,
      observation: "outline schema invalid",
      metadata: {}
    })
  });
  const task = makeArtifactRequiredTask({ kind: "xlsx" });
  const result = makeSuccessResult("Tabular content.");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "recovery failed (success:false): status = partial_success",
    out.status === "partial_success"
  );
  check(
    "recovery failed: reason starts with recovery_failed:",
    typeof out.artifact_recovery?.reason === "string"
      && out.artifact_recovery.reason.startsWith("recovery_failed:")
  );
}

// ----------------------------------------------------------------------
// 5. Empty final_text → recovery skipped with reason = "no_final_text".
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "html" });
  const result = makeSuccessResult("");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "no final_text: status = partial_success",
    out.status === "partial_success"
  );
  check(
    "no final_text: reason = no_final_text",
    out.artifact_recovery?.reason === "no_final_text"
  );
}

// ----------------------------------------------------------------------
// 6. Kind alias mapping: spec.artifact.kind = "word" → kind = "docx".
// ----------------------------------------------------------------------
{
  const captured = [];
  const runtime = createStubRuntime({
    generateImpl: async (args) => {
      captured.push(args);
      return {
        success: true,
        observation: "(stub) ok",
        metadata: {
          tool_id: "generate_document",
          kind: args.kind,
          path: `/tmp/stub.${args.kind}`,
          artifact_kind: args.kind
        }
      };
    }
  });
  const task = makeArtifactRequiredTask({ kind: "word" });
  const result = makeSuccessResult("Some doc body.");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "kind alias: 'word' → kind passed to generate_document was 'docx'",
    captured.length === 1 && captured[0].kind === "docx"
  );
  check(
    "kind alias: artifact_recovery.kind = docx",
    out.artifact_recovery?.kind === "docx"
  );
}

// ----------------------------------------------------------------------
// 7. Unknown kind defaults to html (don't fail; produce something).
// ----------------------------------------------------------------------
{
  const captured = [];
  const runtime = createStubRuntime({
    generateImpl: async (args) => {
      captured.push(args);
      return {
        success: true,
        observation: "(stub) ok",
        metadata: {
          tool_id: "generate_document",
          kind: args.kind,
          path: `/tmp/stub.${args.kind}`,
          artifact_kind: args.kind
        }
      };
    }
  });
  const task = makeArtifactRequiredTask({ kind: "markdown" });
  const result = makeSuccessResult("fallback content");
  await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "unknown kind 'markdown' defaults to html",
    captured.length === 1 && captured[0].kind === "html"
  );
}

// ----------------------------------------------------------------------
// 8. Direct attemptArtifactRecovery: bypass-friendly contract for tests.
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "html" });
  const recovery = await attemptArtifactRecovery({
    runtime,
    task,
    result: { final_text: "Hello world" }
  });
  check(
    "direct attemptArtifactRecovery: ok = true when registry has tool",
    recovery.ok === true
  );
  check(
    "direct attemptArtifactRecovery: kind = html",
    recovery.kind === "html"
  );
}

// ----------------------------------------------------------------------
// 9. Status != success → finaliser passes through unchanged (don't
//    spawn recovery on failed runs).
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "docx" });
  const result = { status: "failed", final_text: "x", transcript: [] };
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "non-success status: finaliser is a no-op",
    out === result
  );
  check(
    "non-success status: no recovery events emitted",
    runtime.events.length === 0
  );
}

// ----------------------------------------------------------------------
// 10. No artifact_required: finaliser is a no-op (don't recover when
//     contract didn't ask for an artifact).
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = {
    task_id: "task_no_artifact",
    user_command: "just answer me",
    task_spec: { goal: "qa", success_contract: {} }
  };
  const result = makeSuccessResult("Plain answer.");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "no artifact_required: status stays success",
    out.status === "success"
  );
  check(
    "no artifact_required: no recovery applied",
    out.artifact_recovery === undefined
  );
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
