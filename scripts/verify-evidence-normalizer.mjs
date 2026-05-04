#!/usr/bin/env node
/**
 * UCA-077 P4-RQ C3: post-loop evidence normalizer (audit-only).
 *
 * Asserts:
 *   1. extractEvidence on a transcript with 3 web_search_fetch hits
 *      across 3 distinct domains → distinct_domain_count: 3.
 *   2. extractEvidence on a single ScienceNet roundup
 *      (web_search_fetch with N internal sciencenet.cn URLs) →
 *      distinct_domain_count: 1 even when source_count > 1.
 *   3. Empty transcript / no web tool calls → 0 / 0.
 *   4. www. and trailing-slash variations → normalised to the same
 *      domain.
 *   5. Tool entries with success: false are excluded from counts.
 *   6. fetch_url_content's metadata.url is also picked up.
 *   7. registrableDomain handles known second-level public suffixes
 *      (.co.uk, .com.cn, .com.au).
 *   8. registrableDomain returns null for malformed URLs.
 *   9. Decision-trace EVIDENCE_SUMMARY stage is registered.
 *  10. Source-level lock-in: agent-loop wraps runToolAgentLoop with
 *      finaliseWithEvidence so every return path picks up the stamp.
 *
 * Run: node scripts/verify-evidence-normalizer.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractEvidence,
  registrableDomain
} from "../src/service/core/policy/evidence-normalizer.mjs";
import { normalizeSources } from "../src/service/core/evidence/source-envelope.mjs";
import {
  citationViolations,
  verifyCitations
} from "../src/service/core/evidence/citation-verifier.mjs";
import { FILE_EVIDENCE_COVERAGE } from "../src/service/core/file-evidence-coverage.mjs";
import { STAGES } from "../src/service/core/contracts/decision-trace.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    fail += 1;
  }
}

// ── extractEvidence ──────────────────────────────────────────────────
it("extract: 3 web_search_fetch hits across 3 distinct domains", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://nature.com/articles/abc", title: "x" },
        { url: "https://reuters.com/world/y", title: "y" },
        { url: "https://wired.com/story/z", title: "z" }
      ]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 3);
  assert.equal(ev.distinct_domain_count, 3);
  assert.deepEqual(ev.domains, ["nature.com", "reuters.com", "wired.com"]);
  assert.equal(ev.sources.length, 3);
  assert.ok(ev.sources.every((source) => source.kind === "web" && source.id.startsWith("w_")));
});

it("extract: ScienceNet roundup → many internal links but ONE domain", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://paper.sciencenet.cn/htmlnews/2026/4/563765.shtm", title: "..." },
        { url: "https://news.sciencenet.cn/htmlnews/2026/4/563766.shtm", title: "..." },
        { url: "https://blog.sciencenet.cn/post/123", title: "..." },
        { url: "https://www.sciencenet.cn/main", title: "..." }
      ]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 4);          // 4 distinct URLs
  assert.equal(ev.distinct_domain_count, 1); // all sciencenet.cn (com.cn would be different but this is .cn)
  assert.deepEqual(ev.domains, ["sciencenet.cn"]);
});

it("extract: empty transcript → 0 / 0", () => {
  const ev = extractEvidence([]);
  assert.equal(ev.source_count, 0);
  assert.equal(ev.distinct_domain_count, 0);
  assert.equal(ev.local_source_count, 0);
  assert.equal(ev.indexed_file_source_count, 0);
  assert.equal(ev.blended_source_count, 0);
  assert.equal(ev.blended_origin_count, 0);
  assert.deepEqual(ev.domains, []);
  assert.deepEqual(ev.urls, []);
  assert.deepEqual(ev.sources, []);
});

it("extract: source envelope provides stable ids for mixed evidence", () => {
  const transcript = [
    { type: "tool_result", tool: "read_file_text", success: true, observation: "Resume text", metadata: { path: "E:\\docs\\resume.md", coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT, content_extracted: true } },
    { type: "tool_result", tool: "search_file_content", success: true, metadata: { results: [{ path: "E:\\docs\\resume.md", text: "ML project", score: 0.9, char_start: 10, char_end: 40, coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT }] } }
  ];
  const first = transcript.flatMap((entry) => normalizeSources(entry));
  const second = transcript.flatMap((entry) => normalizeSources(entry));
  assert.deepEqual(second.map((source) => source.id), first.map((source) => source.id));
  const ev = extractEvidence(transcript);
  assert.equal(ev.sources.length, 2);
  assert.deepEqual(ev.sources.map((source) => source.kind), ["file", "chunk"]);
});

it("extract: citation verifier is advisory and structural", () => {
  const citations = verifyCitations("Uses one real [w_11111111] and one missing [f_deadbeef].", [
    { id: "w_11111111", kind: "web", locator: "https://example.test" }
  ]);
  assert.deepEqual(citations.claimed, ["w_11111111", "f_deadbeef"]);
  assert.deepEqual(citations.missing, ["f_deadbeef"]);
  assert.equal(citationViolations(citations)[0].kind, "citation_unresolved");
  assert.deepEqual(verifyCitations("No citation id here.", []).missing, []);
});

it("extract: non-array transcript tolerated (returns 0/0)", () => {
  const ev = extractEvidence(null);
  assert.equal(ev.source_count, 0);
});

it("extract: transcript with launch_app only (no web tools) → 0", () => {
  const ev = extractEvidence([
    { type: "tool_result", tool: "launch_app", success: true, observation: "launched 微信" }
  ]);
  assert.equal(ev.source_count, 0);
  assert.equal(ev.distinct_domain_count, 0);
});

it("extract: www. prefix and trailing slash normalised to same domain", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://www.example.com/a" },
        { url: "https://example.com/b/" },
        { url: "http://example.com/c" }
      ]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.distinct_domain_count, 1);
  assert.deepEqual(ev.domains, ["example.com"]);
});

it("extract: success: false entries excluded from coverage", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: false, metadata: {
      results: [{ url: "https://failed.example.com/x" }]
    } },
    { type: "tool_result", tool: "fetch_url_content", success: true, metadata: {
      url: "https://reuters.com/article"
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 1);
  assert.equal(ev.distinct_domain_count, 1);
  assert.deepEqual(ev.domains, ["reuters.com"]);
});

it("extract: fetch_url_content metadata.url picked up", () => {
  const transcript = [
    { type: "tool_result", tool: "fetch_url_content", success: true, metadata: {
      url: "https://en.wikipedia.org/wiki/Foo"
    } },
    { type: "tool_result", tool: "fetch_url_content", success: true, metadata: {
      url: "https://weather.gov/forecast"
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 2);
  assert.equal(ev.distinct_domain_count, 2);
});

it("extract: mixed web_search_fetch + fetch_url_content cross-tool dedupe", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://nature.com/articles/a" },
        { url: "https://reuters.com/x" }
      ]
    } },
    { type: "tool_result", tool: "fetch_url_content", success: true, metadata: {
      url: "https://nature.com/articles/a"   // same URL as above
    } },
    { type: "tool_result", tool: "fetch_url_content", success: true, metadata: {
      url: "https://wired.com/story/y"
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 3);          // 3 distinct URLs (nature dedup)
  assert.equal(ev.distinct_domain_count, 3); // nature.com / reuters.com / wired.com
});

it("extract: local file reads contribute blended evidence without changing web counts", () => {
  const transcript = [
    { type: "tool_result", tool: "read_file_text", success: true, metadata: {
      path: "E:\\docs\\resume.pdf",
      coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
      content_extracted: true,
      truncated: true
    } },
    { type: "tool_result", tool: "read_folder_text", success: true, metadata: {
      coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
      content_extracted: true,
      files: [
        { path: "E:\\docs\\notes\\a.md", success: true },
        { path: "E:\\docs\\notes\\b.md", success: true, truncated: true },
        { path: "E:\\docs\\notes\\failed.md", success: false }
      ]
    } },
    { type: "tool_result", tool: "list_files", success: true, metadata: {
      files: ["E:\\docs\\draft.docx"],
      coverage_scope: FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW,
      content_extracted: false
    } },
    { type: "tool_result", tool: "glob_files", success: true, metadata: {
      files: ["E:\\docs\\nested\\raw.csv"],
      coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE,
      content_extracted: false
    } },
    { type: "tool_result", tool: "stat_file", success: true, metadata: {
      path: "E:\\docs\\archive.zip",
      coverage_scope: FILE_EVIDENCE_COVERAGE.FILE_METADATA,
      content_extracted: false
    } },
    { type: "tool_result", tool: "vision_analyze", success: true, metadata: {
      image_paths: ["E:\\docs\\diagram.png"]
    } },
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [{ url: "https://reuters.com/article", title: "Article" }]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 1);
  assert.equal(ev.distinct_domain_count, 1);
  assert.equal(ev.local_source_count, 4);
  assert.equal(ev.local_text_source_count, 4);
  assert.equal(ev.local_deep_text_source_count, 2);
  assert.equal(ev.local_shallow_source_count, 3);
  assert.equal(ev.local_truncated_source_count, 2);
  assert.equal(ev.local_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT], 2);
  assert.equal(ev.local_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT], 2);
  assert.equal(ev.local_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW], 1);
  assert.equal(ev.local_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE], 1);
  assert.equal(ev.local_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.FILE_METADATA], 1);
  assert.equal(ev.blended_source_count, 5);
  assert.equal(ev.blended_origin_count, 5);
  assert.deepEqual(ev.local_sources, [
    "E:\\docs\\diagram.png",
    "E:\\docs\\notes\\a.md",
    "E:\\docs\\notes\\b.md",
    "E:\\docs\\resume.pdf"
  ]);
  assert.deepEqual(ev.local_shallow_sources, [
    "E:\\docs\\archive.zip",
    "E:\\docs\\draft.docx",
    "E:\\docs\\nested\\raw.csv"
  ]);
  assert.deepEqual(ev.local_truncated_sources, [
    "E:\\docs\\notes\\b.md",
    "E:\\docs\\resume.pdf"
  ]);
});

it("extract: indexed file hits are evidence but not fresh local reads", () => {
  const transcript = [
    { type: "tool_result", tool: "search_file_content", success: true, metadata: {
      results: [
        {
          id: "file_content_a",
          path: "E:\\docs\\indexed-a.md",
          coverage_scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
          truncated: true
        },
        {
          id: "file_content_b",
          path: "E:\\docs\\indexed-b.md",
          coverage_scope: FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
          truncated: false
        }
      ]
    } },
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [{ url: "https://reuters.com/article", title: "Article" }]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.source_count, 1);
  assert.equal(ev.local_source_count, 0);
  assert.equal(ev.local_text_source_count, 0);
  assert.equal(ev.indexed_file_source_count, 2);
  assert.equal(ev.indexed_file_truncated_source_count, 1);
  assert.equal(ev.indexed_file_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT], 1);
  assert.equal(ev.indexed_file_coverage_scope_counts[FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT], 1);
  assert.equal(ev.blended_source_count, 3);
  assert.equal(ev.blended_origin_count, 3);
  assert.deepEqual(ev.indexed_file_sources, [
    "E:\\docs\\indexed-a.md",
    "E:\\docs\\indexed-b.md"
  ]);
  assert.deepEqual(ev.indexed_file_truncated_sources, ["E:\\docs\\indexed-a.md"]);
});

// ── registrableDomain heuristic ──────────────────────────────────────
it("domain: typical .com extracted as last 2 labels", () => {
  assert.equal(registrableDomain("https://www.example.com/a/b"), "example.com");
  assert.equal(registrableDomain("https://blog.example.com/post"), "example.com");
});

it("domain: .co.uk treated as 2-part public suffix → last 3 labels", () => {
  assert.equal(registrableDomain("https://www.bbc.co.uk/news"), "bbc.co.uk");
  assert.equal(registrableDomain("https://news.bbc.co.uk/article"), "bbc.co.uk");
});

it("domain: .com.cn / .com.au similarly", () => {
  assert.equal(registrableDomain("https://www.sina.com.cn/"), "sina.com.cn");
  assert.equal(registrableDomain("https://news.sina.com.cn/x"), "sina.com.cn");
  assert.equal(registrableDomain("https://www.abc.net.au/"), "abc.net.au");
});

it("domain: malformed URL returns null", () => {
  assert.equal(registrableDomain("not a url"), null);
  assert.equal(registrableDomain(""), null);
  assert.equal(registrableDomain(null), null);
  assert.equal(registrableDomain(undefined), null);
});

it("domain: localhost / ip stays as-is (single-label)", () => {
  assert.equal(registrableDomain("http://localhost:3000/"), "localhost");
  assert.equal(registrableDomain("http://127.0.0.1/"), "127.0.0.1");
});

// ── Decision-trace stage registration ────────────────────────────────
it("STAGES: EVIDENCE_SUMMARY registered as decision-trace stage id", () => {
  assert.equal(STAGES.EVIDENCE_SUMMARY, "evidence-summary");
});

// ── P4-RQ D2: roundup / digest detection ─────────────────────────────
it("roundup: ScienceNet weekly-review titles + /htmlnews/ paths → is_single_roundup=true", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://paper.sciencenet.cn/htmlnews/2026/4/563765.shtm", title: "一周热闻回顾（4月3日-4月9日）" },
        { url: "https://news.sciencenet.cn/htmlnews/2026/4/563766.shtm", title: "..." },
        { url: "https://blog.sciencenet.cn/post/123", title: "..." }
      ]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.distinct_domain_count, 1);
  assert.equal(ev.is_single_roundup, true);
  assert.ok(ev.roundup_markers.length > 0, "expected at least one roundup_marker matched");
});
it("roundup: cross-domain transcript → is_single_roundup=false (single-domain check is the gate)", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://nature.com/news/weekly-digest", title: "Weekly digest of AI news" },
        { url: "https://reuters.com/world/x", title: "Article" }
      ]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.distinct_domain_count, 2);
  // Even though "weekly digest" matches, distinct_domain_count > 1 →
  // not a single-roundup. The single-domain gate is the prerequisite.
  assert.equal(ev.is_single_roundup, false);
});
it("roundup: single-domain non-roundup article → is_single_roundup=false", () => {
  const transcript = [
    { type: "tool_result", tool: "fetch_url_content", success: true, metadata: {
      url: "https://nature.com/articles/abc"
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.distinct_domain_count, 1);
  assert.equal(ev.is_single_roundup, false);
});
it("roundup: English 'AI weekly digest' title with single domain → is_single_roundup=true", () => {
  const transcript = [
    { type: "tool_result", tool: "web_search_fetch", success: true, metadata: {
      results: [
        { url: "https://example-blog.com/ai-weekly-digest-04", title: "AI Weekly Digest #04" },
        { url: "https://example-blog.com/posts/older", title: "..." }
      ]
    } }
  ];
  const ev = extractEvidence(transcript);
  assert.equal(ev.distinct_domain_count, 1);
  assert.equal(ev.is_single_roundup, true);
});
it("roundup: empty transcript → is_single_roundup=false", () => {
  const ev = extractEvidence([]);
  assert.equal(ev.is_single_roundup, false);
  assert.deepEqual(ev.roundup_markers, []);
});

// ── Source-level lock-in: agent-loop wraps runToolAgentLoop ─────────
it("lock-in: agent-loop wraps runToolAgentLoop with finaliseWithEvidence", () => {
  const src = readFileSync(
    new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /import\s+\{[^}]*\bextractEvidence\b[^}]*\}\s+from\s+["']\.\.\/\.\.\/core\/policy\/evidence-normalizer\.mjs["']/,
    "agent-loop must import extractEvidence");
  assert.match(src, /function\s+finaliseWithEvidence\s*\(/,
    "agent-loop must define finaliseWithEvidence wrapper");
  assert.match(src, /async\s+function\s+_runToolAgentLoopCore\s*\(/,
    "agent-loop must split core out of public runToolAgentLoop so the wrapper picks up every return path");
  assert.match(src, /finaliseWithEvidence\s*\(\s*result\s*,/,
    "public runToolAgentLoop must call finaliseWithEvidence(result, ...)");
});

it("lock-in: final composer receives structured evidence summary", () => {
  const src = readFileSync(
    new URL("../src/service/executors/tool_using/final-composer.mjs", import.meta.url),
    "utf8"
  );
  assert.match(src, /import\s+\{[^}]*\bextractEvidence\b[^}]*\}\s+from\s+["']\.\.\/\.\.\/core\/policy\/evidence-normalizer\.mjs["']/,
    "final composer must import extractEvidence");
  assert.match(src, /function\s+formatEvidenceSummaryForComposer\s*\(/,
    "final composer must format structured evidence for prompt and injected composers");
  assert.match(src, /evidence_summary:\s*evidenceSummary/,
    "injected final composers must receive evidence_summary");
  assert.match(src, /\[Evidence summary\]/,
    "provider final composer prompt must include compact evidence summary when evidence exists");
  assert.match(src, /locator evidence, not proof/,
    "final composer must distinguish indexed/listed locators from fresh file reads");
  assert.match(src, /renderEvidenceLedgerFromSummary/,
    "final composer must render the unified source ledger for synthesis");
  assert.match(src, /source_ledger:/,
    "final composer evidence block must expose addressable source ids");
});

it("lock-in: agentic planner refreshes evidence ledger before provider calls", () => {
  const promptBuilder = readFileSync(
    new URL("../src/service/executors/agentic/prompt-builder.mjs", import.meta.url),
    "utf8"
  );
  const planner = readFileSync(
    new URL("../src/service/executors/agentic/planner.mjs", import.meta.url),
    "utf8"
  );
  assert.match(promptBuilder, /## Evidence ledger/,
    "agentic prompt builder must have an evidence ledger section");
  assert.match(planner, /renderEvidenceLedger/,
    "agentic planner must render evidence ledger from transcript sources");
  assert.match(planner, /messages\[0\]\.content\s*=\s*buildSystemPrompt/,
    "agentic planner must refresh the system prompt before each provider call");
});

it("lock-in: finalizers attach advisory citation diagnostics", () => {
  const agentLoop = readFileSync(
    new URL("../src/service/executors/tool_using/agent-loop.mjs", import.meta.url),
    "utf8"
  );
  const agenticFinalization = readFileSync(
    new URL("../src/service/executors/agentic/finalization.mjs", import.meta.url),
    "utf8"
  );
  assert.match(agentLoop, /verifyCitations/,
    "tool_using finaliseWithEvidence must add citation diagnostics to evidence_summary");
  assert.match(agenticFinalization, /citationViolations/,
    "agentic finalization must record unresolved citations as advisory violations");
});

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
if (fail > 0) process.exit(1);
