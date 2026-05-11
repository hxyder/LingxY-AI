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
          const stubPath = `${ctx?.outputDir ?? "/tmp"}/stub.${args.kind}`;
          return {
            success: true,
            observation: `(stub) generated ${args.kind}`,
            metadata: {
              tool_id: "generate_document",
              kind: args.kind,
              path: stubPath,
              artifact_kind: args.kind
            },
            artifact_paths: [stubPath]
          };
        }
        return generateImpl(args, ctx);
      }
    }
  ];
  return {
    list() { return tools; },
    get(toolId) {
      return tools.find((tool) => tool?.id === toolId) ?? null;
    },
    async call(toolId, args, ctx) {
      const tool = tools.find((t) => t?.id === toolId);
      if (!tool) throw new Error(`Unknown tool: ${toolId}`);
      return tool.execute(args, ctx);
    }
  };
}

function createStubRuntime({ generateImpl, omitGenerateTool = false, toolOutputDir = "/tmp/task_workspace" } = {}) {
  const events = [];
  const audit = [];
  const registry = omitGenerateTool
    ? {
      list() { return []; },
      get() { return null; },
      async call() { throw new Error("no tools"); }
    }
    : createStubRegistry({ generateImpl });
  return {
    actionToolRegistry: registry,
    toolContext: {},
    toolOutputDir,
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
  // codex round-1: the recovered transcript entry MUST carry
  // artifact_paths so collectArtifactPathsFromTranscript surfaces
  // the recovered file in the success event, task artifact index,
  // and Files UI. Also exposed on the artifact_recovery summary
  // so the executor's terminal artifact_paths can include it.
  check(
    "recovery success: transcript entry carries artifact_paths",
    out.transcript.some((entry) =>
      entry?.tool === "generate_document"
      && Array.isArray(entry?.artifact_paths)
      && entry.artifact_paths.length > 0
    )
  );
  check(
    "recovery success: artifact_recovery.artifact_paths is non-empty",
    Array.isArray(out.artifact_recovery?.artifact_paths)
      && out.artifact_recovery.artifact_paths.length > 0
  );
  // codex round-1: outputDir must come from runtime.toolOutputDir,
  // not from generate_document's Desktop fallback. The stub appends
  // ctx.outputDir into its synthetic path, so the test workspace
  // path must appear in the recovered artifact.
  check(
    "recovery success: file lands in runtime.toolOutputDir, not Desktop fallback",
    out.artifact_recovery.artifact_paths.some((p) => p.includes("/tmp/task_workspace"))
  );
  // synthetic flag tells downstream code these entries weren't
  // planner-driven (codex round-1 future-proofing).
  check(
    "recovery success: transcript entry tagged synthetic:true",
    out.transcript.some((entry) =>
      entry?.tool === "generate_document" && entry?.synthetic === true
    )
  );
  check(
    "recovery success: kind_default_applied is false when spec has docx",
    out.artifact_recovery?.kind_default_applied === false
  );
  check(
    "recovery success: raw_kind preserved",
    out.artifact_recovery?.raw_kind === "docx"
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
  const task = makeArtifactRequiredTask({ kind: "docx" });
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
// 7. Unsupported rawKind ('markdown') → recovery is SKIPPED with a
//    single-reason "unsupported_kind:<rawKind>" instead of silently
//    substituting html. codex round-1: silent substitution would
//    produce a kind-mismatch shadow downstream that confuses the user.
// ----------------------------------------------------------------------
{
  const captured = [];
  const runtime = createStubRuntime({
    generateImpl: async (args) => {
      captured.push(args);
      return { success: true, observation: "(stub) ok", metadata: {}, artifact_paths: [] };
    }
  });
  const task = makeArtifactRequiredTask({ kind: "markdown" });
  const result = makeSuccessResult("fallback content");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "unsupported kind 'markdown': recovery skipped (tool not invoked)",
    captured.length === 0
  );
  check(
    "unsupported kind 'markdown': status = partial_success",
    out.status === "partial_success"
  );
  check(
    "unsupported kind 'markdown': reason = unsupported_kind:markdown",
    out.artifact_recovery?.reason === "unsupported_kind:markdown"
  );
}

// ----------------------------------------------------------------------
// 7b. Empty rawKind → kind defaults to html with kind_default_applied
//     = true on both the artifact_recovery shape and the event payload.
//     This separates "user didn't specify" (legitimate default) from
//     "user specified but unsupported" (handled in test 7).
// ----------------------------------------------------------------------
{
  const captured = [];
  const runtime = createStubRuntime({
    generateImpl: async (args) => {
      captured.push(args);
      const stubPath = `/tmp/task_workspace/stub.${args.kind}`;
      return {
        success: true,
        observation: "(stub) ok",
        metadata: { tool_id: "generate_document", kind: args.kind, path: stubPath },
        artifact_paths: [stubPath]
      };
    }
  });
  // Empty kind in the spec — common when the planner forgot to set
  // it but artifact.required is true.
  const task = {
    task_id: "task_no_kind",
    user_command: "make a doc",
    task_spec: {
      goal: "generate_document",
      artifact: { required: true },
      success_contract: { artifact_created: true, required_policy_groups: ["artifact_generation"] }
    }
  };
  const result = makeSuccessResult("fallback content");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "empty kind: defaults to html (tool called with kind=html)",
    captured.length === 1 && captured[0].kind === "html"
  );
  check(
    "empty kind: kind_default_applied = true on artifact_recovery",
    out.artifact_recovery?.kind_default_applied === true
  );
  check(
    "empty kind: emitted event payload carries kind_default_applied=true + raw_kind=''",
    runtime.events.some((e) =>
      e.name === "artifact_recovery_succeeded"
      && e.payload?.kind_default_applied === true
      && e.payload?.raw_kind === ""
    )
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
// 8b. Malformed generate_document proposals are still recoverable.
//     No artifact-producing tool actually ran, so deterministic recovery
//     may safely materialise final_text via the artifact_generation group.
//     A real generate_document tool_result remains non-recoverable below.
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "docx" });
  // Two prior generate_document validation_errors in the transcript.
  const transcript = [
    { type: "validation_error", tool: "generate_document", error: "kind missing" },
    { type: "validation_error", tool: "generate_document", error: "outline missing" }
  ];
  const result = makeSuccessResult("Doc body in plaintext.", transcript);
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "LLM malformed generate_document validation_error: deterministic recovery applies",
    out.status === "success"
      && out.artifact_recovery?.applied === true
      && out.artifact_recovery?.kind === "docx"
  );
}

{
  // LLM successfully called generate_document but with wrong KIND.
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "docx" });
  const transcript = [
    {
      type: "tool_result",
      tool: "generate_document",
      success: true,
      observation: "(test) generated pdf",
      metadata: { kind: "pdf", path: "/tmp/wrong.pdf" },
      artifact_paths: ["/tmp/wrong.pdf"]
    }
  ];
  const result = makeSuccessResult("A PDF was generated.", transcript);
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "LLM tried with wrong kind: recovery skipped (user sees the kind-mismatch failure)",
    out.status === "partial_success"
      && out.artifact_recovery?.applied === false
      && out.artifact_recovery?.reason === "llm_already_attempted_artifact"
  );
}

// ----------------------------------------------------------------------
// 9. partial_success still recovers artifact_required. Phase/error gates can
//    downgrade before the artifact finalizer runs; the outer submission
//    boundary must still receive artifact_paths instead of hard-failing.
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "docx" });
  const result = { ...makeSuccessResult("Partial but usable body."), status: "partial_success" };
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "partial_success recovery: status stays partial_success",
    out.status === "partial_success"
  );
  check(
    "partial_success recovery: artifact_recovery.applied = true",
    out.artifact_recovery?.applied === true
  );
  check(
    "partial_success recovery: transcript carries artifact_paths",
    out.transcript.some((entry) =>
      entry?.tool === "generate_document"
      && Array.isArray(entry.artifact_paths)
      && entry.artifact_paths.length > 0
    )
  );
}

// ----------------------------------------------------------------------
// 10. failed status → finaliser passes through unchanged (don't spawn
//     recovery on already-failed runs).
// ----------------------------------------------------------------------
{
  const runtime = createStubRuntime();
  const task = makeArtifactRequiredTask({ kind: "docx" });
  const result = { status: "failed", final_text: "x", transcript: [] };
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "failed status: finaliser is a no-op",
    out === result
  );
  check(
    "failed status: no recovery events emitted",
    runtime.events.length === 0
  );
}

// ----------------------------------------------------------------------
// 11. No artifact_required: finaliser is a no-op (don't recover when
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

// ----------------------------------------------------------------------
// 12. transform_existing_file requires edit_file. Deterministic recovery
//     must not turn the assistant's final reply into a brand-new document.
// ----------------------------------------------------------------------
{
  const captured = [];
  const runtime = createStubRuntime({
    generateImpl: async (args) => {
      captured.push(args);
      return {
        success: true,
        observation: "(stub) incorrectly generated a new file",
        metadata: { tool_id: "generate_document", kind: args.kind, path: `/tmp/stub.${args.kind}` },
        artifact_paths: [`/tmp/stub.${args.kind}`]
      };
    }
  });
  const task = {
    task_id: "task_transform_existing_file",
    user_command: "把刚才那个文件转成 PPT",
    task_spec: {
      goal: "transform_existing_file",
      artifact: { required: true, kind: "pptx" },
      success_contract: {
        artifact_created: true,
        required_tool_names: ["edit_file"],
        required_policy_groups: ["artifact_generation"]
      }
    }
  };
  const result = makeSuccessResult("我已经帮你转换好了，内容如下：这是会话回复，不是源文件内容。");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "transform_existing_file recovery: generate_document was not called",
    captured.length === 0
  );
  check(
    "transform_existing_file recovery: status = partial_success",
    out.status === "partial_success"
  );
  check(
    "transform_existing_file recovery: reason = goal_transform_existing_file_requires_edit_file",
    out.artifact_recovery?.reason === "goal_transform_existing_file_requires_edit_file"
  );
}

// Codex round-1: required_tool_names block (goal is NOT transform_existing_file)
{
  const captured = [];
  const runtime = createStubRuntime({
    generateImpl: async (args) => {
      captured.push({ toolId, args });
      if (toolId === "generate_document") throw new Error("should not call generate_document");
      return {
        success: true,
        observation: `mock ${toolId} result`,
        artifact_paths: [`/tmp/stub.${args.kind}`]
      };
    }
  });
  const task = {
    task_id: "task_required_edit_file",
    user_command: "clean up the report file",
    task_spec: {
      goal: "summarize_document",
      artifact: { required: true, kind: "docx" },
      success_contract: {
        artifact_created: true,
        required_tool_names: ["edit_file"],
        required_policy_groups: ["artifact_generation"]
      }
    }
  };
  const result = makeSuccessResult("我已经帮你整理好了报告内容。");
  const out = await finaliseWithArtifactContract(result, { runtime, task });
  check(
    "required_tool_edit_file_not_called: generate_document was not called",
    captured.length === 0
  );
  check(
    "required_tool_edit_file_not_called: status = partial_success",
    out.status === "partial_success"
  );
  check(
    "required_tool_edit_file_not_called: reason = required_tool_edit_file_not_called",
    out.artifact_recovery?.reason === "required_tool_edit_file_not_called"
  );
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
