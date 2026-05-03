import assert from "node:assert/strict";
import test from "node:test";

import {
  agenticToolResultHasSubstance,
  transcriptForValidator
} from "../../src/service/executors/agentic/validator-transcript.mjs";

test("agentic validator transcript keeps only tool results in validator shape", () => {
  const transcript = transcriptForValidator([
    { role: "system", content: "ignored" },
    { role: "assistant", content: "ignored" },
    {
      role: "tool",
      name: "web_search_fetch",
      success: true,
      observation: "found sources",
      metadata: { results: [{ title: "A", url: "https://example.test/a" }] },
      artifact_paths: ["E:/linxiDoc/out.md"]
    },
    {
      role: "tool",
      name: "write_file",
      success: false
    }
  ]);

  assert.deepEqual(transcript, [
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      observation: "found sources",
      metadata: { results: [{ title: "A", url: "https://example.test/a" }] },
      artifact_paths: ["E:/linxiDoc/out.md"]
    },
    {
      type: "tool_result",
      tool: "write_file",
      success: false,
      observation: "",
      metadata: {},
      artifact_paths: []
    }
  ]);
});

test("agentic substance detector treats real results and long observations as substantive", () => {
  assert.equal(agenticToolResultHasSubstance({ results: [{ title: "A" }] }), true);
  assert.equal(agenticToolResultHasSubstance({ sources: [{ url: "https://example.test" }] }), true);
  assert.equal(agenticToolResultHasSubstance({ metadata: { results: [{ title: "B" }] } }), true);
  assert.equal(
    agenticToolResultHasSubstance({
      observation: "This observation has enough concrete detail to count as substantive output."
    }),
    true
  );
  assert.equal(agenticToolResultHasSubstance({ nested: ["one"] }), true);
});

test("agentic substance detector rejects empty or shallow tool results", () => {
  assert.equal(agenticToolResultHasSubstance(null), false);
  assert.equal(agenticToolResultHasSubstance("not an object"), false);
  assert.equal(agenticToolResultHasSubstance({}), false);
  assert.equal(agenticToolResultHasSubstance({ results: [], sources: [] }), false);
  assert.equal(agenticToolResultHasSubstance({ observation: "too short" }), false);
  assert.equal(agenticToolResultHasSubstance({ metadata: { results: [] } }), false);
});
