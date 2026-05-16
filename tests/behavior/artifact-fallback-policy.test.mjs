import test from "node:test";
import assert from "node:assert/strict";

import {
  artifactRecoveryBlockedReason,
  createFileGenerationAttemptState,
  recordArtifactGenerated,
  recordFileGenerationToolEvent,
  shouldSynthesizeRequestedFallbackArtifact
} from "../../src/service/core/artifact-fallback-policy.mjs";

const pdfFormat = { id: "pdf", extensions: [".pdf"] };

test("artifact fallback policy blocks synthetic files after a required generator fails", () => {
  const fileGeneration = createFileGenerationAttemptState();
  recordFileGenerationToolEvent(fileGeneration, {
    tool_id: "generate_document",
    success: false
  });

  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [],
    task: { task_spec: { artifact: { required: true, kind: "pdf" } } },
    fileGeneration
  }), false);
});

test("artifact fallback policy preserves legacy fallback when no file generator was attempted", () => {
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [],
    task: { task_spec: { artifact: { required: true, kind: "pdf" }, success_contract: { tool_called: false } } },
    fileGeneration: createFileGenerationAttemptState()
  }), true);
});

test("artifact fallback policy allows synthetic files when current executor cannot generate files", () => {
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [],
    task: {
      task_spec: {
        artifact: { required: true, kind: "pdf" },
        success_contract: { artifact_created: true, tool_called: true }
      }
    },
    fileGeneration: createFileGenerationAttemptState(),
    fileGenerationToolCapability: false
  }), true);
});

test("artifact fallback policy blocks synthetic files when a capable executor never called a generator", () => {
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [],
    task: {
      task_spec: {
        artifact: { required: true, kind: "pdf" },
        success_contract: { artifact_created: true, tool_called: true }
      }
    },
    fileGeneration: createFileGenerationAttemptState(),
    fileGenerationToolCapability: true
  }), false);
});

test("artifact fallback policy skips fallback when an artifact already exists", () => {
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [{ path: "E:/linxiDoc/task/result.pdf" }],
    task: { task_spec: { artifact: { required: true, kind: "pdf" } } },
    fileGeneration: createFileGenerationAttemptState()
  }), false);
});

test("artifact fallback policy skips conversational and edit-existing-file tasks", () => {
  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: { id: "conversational" },
    generatedArtifacts: [],
    task: { task_spec: { artifact: { required: true } } },
    fileGeneration: createFileGenerationAttemptState()
  }), false);

  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [],
    task: { task_spec: { goal: "transform_existing_file", artifact: { required: true } } },
    fileGeneration: createFileGenerationAttemptState()
  }), false);
});

test("artifact fallback policy treats artifact creation as generator success", () => {
  const fileGeneration = createFileGenerationAttemptState();
  recordFileGenerationToolEvent(fileGeneration, {
    tool_id: "generate_document",
    success: false
  });
  recordArtifactGenerated(fileGeneration);

  assert.equal(shouldSynthesizeRequestedFallbackArtifact({
    requestedFormat: pdfFormat,
    generatedArtifacts: [],
    task: { task_spec: { artifact: { required: true, kind: "pdf" } } },
    fileGeneration
  }), true);
});

test("artifact fallback policy tracks vector graphics as file generation", () => {
  const fileGeneration = createFileGenerationAttemptState();
  recordFileGenerationToolEvent(fileGeneration, {
    tool_id: "render_svg",
    success: false
  });

  assert.equal(fileGeneration.attempted, true);
  assert.equal(fileGeneration.succeeded, false);
});

test("artifact fallback policy blocks single-file deterministic recovery for multi-kind requests", () => {
  assert.equal(artifactRecoveryBlockedReason({
    artifact: { required: true, kind: "json", required_kinds: ["json", "csv", "md"] },
    success_contract: { artifact_created: true }
  }), "multi_artifact_required_kinds_need_explicit_tool_calls");
});
