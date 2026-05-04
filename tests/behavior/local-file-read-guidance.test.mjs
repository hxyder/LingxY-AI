import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocalFileTextReadGuidance,
  extractIndexedFileCandidates,
  planLocalFileTextReadGuidance
} from "../../src/service/executors/shared/local-file-read-guidance.mjs";

function stepGate(kind = "local_file_text_read_required_not_called") {
  return {
    satisfied: false,
    next_action: "continue",
    violations: [{ kind, message: "fresh local file text is still required" }]
  };
}

function indexedTranscript({ path = "E:/linxi/docs/brief.md" } = {}) {
  return [
    {
      type: "tool_result",
      tool: "search_file_content",
      success: true,
      observation: "Found indexed file content.",
      metadata: {
        results: [
          { path, score: 0.91, coverage_scope: "single_file_text" },
          { path, score: 0.88, coverage_scope: "single_file_text" }
        ]
      }
    }
  ];
}

test("local file read guidance extracts bounded deduped indexed candidates", () => {
  const candidates = extractIndexedFileCandidates(indexedTranscript());

  assert.deepEqual(candidates.map((candidate) => candidate.path), ["E:/linxi/docs/brief.md"]);
  assert.equal(candidates[0].score, 0.91);
});

test("local file read guidance caps repeated nudges", () => {
  const out = planLocalFileTextReadGuidance({
    stepGate: stepGate(),
    transcript: indexedTranscript(),
    taskSpec: {},
    iteration: 0,
    maxIterations: 5,
    guidanceCount: 2
  });

  assert.equal(out, null);
});

test("local file read guidance skips the final iteration", () => {
  const out = planLocalFileTextReadGuidance({
    stepGate: stepGate(),
    transcript: indexedTranscript(),
    taskSpec: {},
    iteration: 4,
    maxIterations: 5,
    guidanceCount: 0
  });

  assert.equal(out, null);
});

test("local file read guidance handles empty candidate lists without auto-reading", () => {
  const out = buildLocalFileTextReadGuidance({
    stepGate: stepGate(),
    transcript: [],
    taskSpec: {}
  });

  assert.ok(out);
  assert.match(out.instruction, /No reliable indexed path/);
  assert.match(out.instruction, /attached\/local file paths from Resources/);
});

test("deep local file read guidance points to folder extraction", () => {
  const out = buildLocalFileTextReadGuidance({
    stepGate: stepGate("local_file_text_read_required_deep_insufficient"),
    transcript: indexedTranscript({ path: "E:/linxi/docs" }),
    taskSpec: { file_read: { depth: "deep" } }
  });

  assert.ok(out);
  assert.equal(out.deep, true);
  assert.match(out.instruction, /read_folder_text/);
  assert.match(out.instruction, /deep local-file coverage/);
});
