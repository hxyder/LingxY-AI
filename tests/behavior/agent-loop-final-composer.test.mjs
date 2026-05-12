import test from "node:test";
import assert from "node:assert/strict";

import {
  composeFinalAnswer,
  formatEvidenceSummaryForComposer
} from "../../src/service/executors/tool_using/final-composer.mjs";

test("agent final composer uses injected composer and emits timing events", async () => {
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "summarize the tool result",
      task_spec: { goal: "answer" }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "A useful result."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async ({ reason }) => `composed:${reason}`
    },
    reason: "unit_test"
  });

  assert.equal(text, "composed:unit_test");
  assert.equal(events[0]?.event_type, "final_composer_started");
  assert.ok(events.some((entry) =>
    entry.event_type === "phase_timing"
    && entry.payload?.phase === "final_composer"
    && entry.payload?.reason === "unit_test"
  ));
});

test("agent final composer falls back to collected tool observations when composition throws", async () => {
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "What did the tool find?",
      task_spec: { goal: "answer" }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "The collected answer is 42."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async () => {
        throw new Error("composer unavailable");
      }
    },
    reason: "composer_error"
  });

  assert.match(text, /The collected answer is 42/);
  assert.doesNotMatch(text, /composer unavailable/);
  assert.ok(events.some((entry) => entry.event_type === "phase_timing"));
});

test("agent final composer passes structured local and web evidence to injected composer", async () => {
  let seenEvidence = null;
  const text = await composeFinalAnswer({
    task: {
      user_command: "Combine my local brief with current web evidence.",
      task_spec: { goal: "answer" }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "read_file_text",
        success: true,
        observation: "Fresh local brief.",
        metadata: {
          path: "E:\\docs\\brief.md",
          content_extracted: true,
          coverage_scope: "single_file_text"
        }
      },
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "External source.",
        metadata: {
          results: [
            { url: "https://example.com/report", title: "Report" }
          ]
        }
      },
      {
        type: "tool_result",
        tool: "list_files",
        success: true,
        observation: "Listed files.",
        metadata: {
          files: ["E:\\docs\\candidate.md"],
          content_extracted: false,
          coverage_scope: "directory_listing_shallow"
        }
      }
    ],
    runtime: {
      emitTaskEvent() {},
      finalAnswerComposer: async ({ evidence_summary }) => {
        seenEvidence = evidence_summary;
        return "combined answer";
      }
    },
    reason: "unit_test"
  });

  assert.equal(text, "combined answer");
  assert.equal(seenEvidence?.source_count, 1);
  assert.equal(seenEvidence?.local_source_count, 1);
  assert.equal(seenEvidence?.local_shallow_source_count, 1);
  assert.deepEqual(seenEvidence?.domains, ["example.com"]);
  assert.deepEqual(seenEvidence?.local_sources, ["E:\\docs\\brief.md"]);
});

test("agent final composer evidence prompt distinguishes fresh, indexed, and shallow file evidence", () => {
  const block = formatEvidenceSummaryForComposer({
    source_count: 1,
    distinct_domain_count: 1,
    domains: ["example.com"],
    urls: ["https://example.com/report"],
    local_source_count: 1,
    local_sources: ["E:\\docs\\brief.md"],
    indexed_file_source_count: 1,
    indexed_file_sources: ["E:\\docs\\indexed.md"],
    local_shallow_source_count: 1,
    local_shallow_sources: ["E:\\docs\\folder"],
    blended_source_count: 3
  });

  assert.match(block, /fresh_local_text_sources: E:\\docs\\brief\.md/);
  assert.match(block, /indexed_file_hits_locator_only: E:\\docs\\indexed\.md/);
  assert.match(block, /listed_only_local_paths_not_content: E:\\docs\\folder/);
  assert.match(block, /locator evidence, not proof/);
});

test("agent final reviewer stays disabled by default even for high-risk answers", async () => {
  let reviewCalls = 0;
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "Summarize the research.",
      task_spec: {
        goal: "answer",
        research_quality: { profile: "multi_source_research" }
      }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "Research result."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async () => "candidate answer",
      finalAnswerReviewer: async () => {
        reviewCalls += 1;
        return { verdict: "reject", reason: "should not run" };
      }
    },
    reason: "unit_test"
  });

  assert.equal(text, "candidate answer");
  assert.equal(reviewCalls, 0);
  assert.equal(events.some((event) => event.event_type === "final_reviewer_started"), false);
});

test("agent final reviewer appends visible trace note instead of silently rewriting", async () => {
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "Write up the research.",
      reviewer_loop: { enabled: true },
      task_spec: {
        goal: "answer",
        research_quality: { profile: "multi_source_research" }
      }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "web_search_fetch",
        success: true,
        observation: "One source says the launch is delayed."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async () => "The launch is delayed.",
      finalAnswerReviewer: async () => ({
        verdict: "revise",
        confidence: 0.82,
        reason: "The answer cites a launch delay but does not identify the source date.",
        corrections: ["Add source date before treating the delay as current."]
      })
    },
    reason: "unit_test"
  });

  assert.match(text, /^The launch is delayed\./);
  assert.match(text, /Reviewer note:/);
  assert.match(text, /source date/);
  const completed = events.find((event) => event.event_type === "final_reviewer_completed");
  assert.equal(completed?.payload?.status, "completed");
  assert.equal(completed?.payload?.verdict, "revise");
  assert.equal(completed?.payload?.visible_note_applied, true);
});

test("agent final reviewer degrades gracefully on reviewer failure", async () => {
  const events = [];
  const text = await composeFinalAnswer({
    task: {
      user_command: "Summarize connector results.",
      reviewer_loop: { enabled: true },
      task_spec: {
        goal: "answer",
        connector_domain: "email",
        success_contract: { required_policy_groups: ["email_send"] }
      }
    },
    transcript: [
      {
        type: "tool_result",
        tool: "connector_workflow_run",
        success: true,
        observation: "Message prepared."
      }
    ],
    runtime: {
      emitTaskEvent: (event_type, payload) => events.push({ event_type, payload }),
      finalAnswerComposer: async () => "The email draft is prepared.",
      finalAnswerReviewer: async () => {
        throw new Error("reviewer unavailable");
      }
    },
    reason: "unit_test"
  });

  assert.equal(text, "The email draft is prepared.");
  const completed = events.find((event) => event.event_type === "final_reviewer_completed");
  assert.equal(completed?.payload?.status, "failed");
});
