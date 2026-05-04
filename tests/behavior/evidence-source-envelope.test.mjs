import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSources } from "../../src/service/core/evidence/source-envelope.mjs";
import { extractEvidence } from "../../src/service/core/policy/evidence-normalizer.mjs";
import { renderEvidenceLedger } from "../../src/service/executors/shared/evidence-ledger.mjs";

test("source envelope normalizes web, fresh file, indexed chunk, and shallow file sources", () => {
  const transcript = [
    {
      type: "tool_result",
      tool: "web_search_fetch",
      success: true,
      metadata: {
        results: [
          { title: "Forecast", url: "https://weather.gov/rah", snippet: "Sunny" }
        ]
      }
    },
    {
      type: "tool_result",
      tool: "read_file_text",
      success: true,
      observation: "Extracted text from E:\\docs\\resume.md\nResume body",
      metadata: {
        path: "E:\\docs\\resume.md",
        coverage_scope: "single_file_text",
        content_extracted: true
      }
    },
    {
      type: "tool_result",
      tool: "search_file_content",
      success: true,
      metadata: {
        results: [
          {
            path: "E:\\docs\\resume.md",
            text: "machine learning project",
            score: 0.83,
            char_start: 120,
            char_end: 240,
            coverage_scope: "single_file_text"
          }
        ]
      }
    },
    {
      type: "tool_result",
      tool: "list_files",
      success: true,
      metadata: {
        files: ["E:\\docs\\resume.md"],
        coverage_scope: "directory_listing_shallow",
        content_extracted: false
      }
    }
  ];

  const sources = transcript.flatMap((entry) => normalizeSources(entry));
  assert.equal(sources.length, 4);
  assert.deepEqual(sources.map((source) => source.kind), ["web", "file", "chunk", "file"]);
  assert.ok(sources.every((source) => /^[wfci]_[0-9a-f]{8}$/.test(source.id)));

  const rerun = transcript.flatMap((entry) => normalizeSources(entry));
  assert.deepEqual(rerun.map((source) => source.id), sources.map((source) => source.id));

  const evidence = extractEvidence(transcript);
  assert.equal(evidence.source_count, 1);
  assert.equal(evidence.local_source_count, 1);
  assert.equal(evidence.indexed_file_source_count, 1);
  assert.equal(evidence.local_shallow_source_count, 1);
  assert.equal(evidence.sources.length, 4);
});

test("evidence ledger renders source ids with evidence strength and scope", () => {
  const ledger = renderEvidenceLedger([
    {
      type: "tool_result",
      tool: "read_file_text",
      success: true,
      metadata: { path: "E:\\docs\\resume.md", coverage_scope: "single_file_text", content_extracted: true }
    },
    {
      type: "tool_result",
      tool: "search_file_content",
      success: true,
      metadata: { results: [{ path: "E:\\docs\\resume.md", text: "ML", score: 0.77, char_start: 5, char_end: 20 }] }
    }
  ]);

  assert.match(ledger, /\[f_[0-9a-f]{8}\] \| file \| resume\.md \| single_file_text/);
  assert.match(ledger, /\[c_[0-9a-f]{8}\] \| chunk \| resume\.md \| single_file_text \| chars 5-20 \| score=0\.77/);
});

test("source envelope skips failed tool results", () => {
  assert.deepEqual(normalizeSources({
    type: "tool_result",
    tool: "fetch_url_content",
    success: false,
    metadata: { url: "https://example.com" }
  }), []);
});
