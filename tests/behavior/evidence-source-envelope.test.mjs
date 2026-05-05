import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSources } from "../../src/service/core/evidence/source-envelope.mjs";
import {
  browserContentEvidenceFromCapture,
  fileContentEvidenceFromContextPacket,
  imageContentEvidenceFromContextPacket,
  mergeContentEvidence
} from "../../src/service/core/evidence/content-evidence.mjs";
import {
  hasReadableTextEvidence,
  validateContentEvidenceGate
} from "../../src/service/core/evidence/content-evidence-gate.mjs";
import {
  citationViolations,
  verifyCitations
} from "../../src/service/core/evidence/citation-verifier.mjs";
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

test("citation verifier reports unresolved framework source ids without requiring citations", () => {
  const sources = [
    { id: "w_11111111", kind: "web", locator: "https://example.com" },
    { id: "f_22222222", kind: "file", locator: "E:\\docs\\resume.md" }
  ];
  const ok = verifyCitations("The answer cites one source [w_11111111].", sources);
  assert.deepEqual(ok.claimed, ["w_11111111"]);
  assert.deepEqual(ok.missing, []);
  assert.deepEqual(citationViolations(ok), []);

  const missing = verifyCitations("This cites a missing source [c_deadbeef].", sources);
  assert.deepEqual(missing.missing, ["c_deadbeef"]);
  assert.equal(citationViolations(missing)[0].kind, "citation_unresolved");

  const none = verifyCitations("No citation markers here.", sources);
  assert.deepEqual(none.claimed, []);
  assert.deepEqual(none.missing, []);
});

test("content evidence distinguishes captured page text from URL-only metadata", () => {
  const pageEvidence = browserContentEvidenceFromCapture({
    sourceType: "page_explanation",
    url: "https://example.com/article",
    pageTitle: "Article",
    text: "Article body"
  });
  assert.equal(pageEvidence[0].source_kind, "browser_page_text");
  assert.equal(pageEvidence[0].coverage_scope, "captured_page_text");
  assert.equal(pageEvidence[0].content_extracted, true);

  const metadataOnly = browserContentEvidenceFromCapture({
    sourceType: "webpage",
    url: "https://example.com/current",
    pageTitle: "Current",
    text: "URL: https://example.com/current",
    metadata: { hasPageContent: false }
  });
  assert.equal(metadataOnly[0].source_kind, "browser_page_metadata");
  assert.equal(metadataOnly[0].coverage_scope, "url_title_only");
  assert.equal(metadataOnly[0].content_extracted, false);
});

test("content evidence records file text, shallow directory listings, and image pixels separately", () => {
  const fileEvidence = fileContentEvidenceFromContextPacket({
    file_metadata: [
      { path: "E:\\docs\\resume.md", mime: "text/markdown", size: 1200, extraction_mode: "native_text" },
      { path: "E:\\docs", mime: "inode/directory", size: 0, extraction_mode: "directory_listing" },
      { path: "E:\\docs\\scan.pdf", mime: "application/pdf", size: 4000, extraction_mode: "pdf_ocr_unavailable" }
    ]
  });
  assert.deepEqual(fileEvidence.map((entry) => entry.coverage_scope), [
    "single_file_text",
    "directory_listing_shallow",
    "file_metadata"
  ]);
  assert.deepEqual(fileEvidence.map((entry) => entry.content_extracted), [true, false, false]);

  const imageEvidence = imageContentEvidenceFromContextPacket({
    image_paths: ["E:\\shots\\page.png"],
    image_metadata: { source: "screenshot", ocr_text: "visible words", ocr_engine: "paddle_ocr" }
  });
  assert.deepEqual(imageEvidence.map((entry) => entry.source_kind), [
    "screenshot_image",
    "screenshot_ocr_text"
  ]);
  assert.deepEqual(imageEvidence.map((entry) => entry.content_extracted), [false, true]);
  assert.equal(imageEvidence[0].pixels_available, true);
});

test("content evidence merge prefers concrete content over metadata-only entries", () => {
  const merged = mergeContentEvidence([
    {
      source_kind: "browser_page_metadata",
      coverage_scope: "url_title_only",
      locator: "https://example.com",
      content_extracted: false
    }
  ], [
    {
      source_kind: "browser_prefetch_text",
      coverage_scope: "fetched_page_text",
      locator: "https://example.com",
      content_extracted: true,
      char_length: 500
    }
  ]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((entry) => entry.content_extracted === true));
});

test("content evidence gate rejects current-page metadata-only analysis", () => {
  const result = validateContentEvidenceGate({
    taskSpec: {
      contract: { source_scope: "browser_page" }
    },
    contextPacket: {
      source_type: "webpage",
      selection_metadata: {
        content_evidence: [{
          source_kind: "browser_page_metadata",
          coverage_scope: "url_title_only",
          locator: "https://example.com/current",
          content_extracted: false
        }]
      }
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].kind, "browser_page_content_required");

  const forced = validateContentEvidenceGate({
    taskSpec: { contract: { source_scope: "none" } },
    contextPacket: {
      source_type: "webpage",
      selection_metadata: {
        content_evidence: [{
          source_kind: "browser_page_metadata",
          coverage_scope: "url_title_only",
          content_extracted: false
        }]
      }
    },
    requireReadableText: true
  });
  assert.equal(forced.ok, false);
  assert.equal(forced.violations[0].kind, "browser_page_content_required");
});

test("content evidence gate accepts browser text and keeps image pixels separate from readable text", () => {
  const readable = [{
    source_kind: "browser_page_text",
    coverage_scope: "captured_page_text",
    content_extracted: true
  }];
  assert.equal(hasReadableTextEvidence(readable), true);
  assert.equal(validateContentEvidenceGate({
    taskSpec: { contract: { source_scope: "browser_page" } },
    contextPacket: {
      source_type: "webpage",
      selection_metadata: { content_evidence: readable }
    }
  }).ok, true);

  const pixelsOnly = [{
    source_kind: "screenshot_image",
    coverage_scope: "image_pixels_available",
    pixels_available: true,
    content_extracted: false
  }];
  assert.equal(hasReadableTextEvidence(pixelsOnly), false);
  assert.equal(validateContentEvidenceGate({
    taskSpec: { contract: { source_scope: "browser_page" } },
    contextPacket: {
      source_type: "webpage",
      selection_metadata: { content_evidence: pixelsOnly }
    }
  }).ok, false);
});

test("content evidence gate can protect inline file contexts without blocking deferred tool readers", () => {
  const contextPacket = {
    source_type: "file",
    selection_metadata: {
      content_evidence: [{
        source_kind: "local_file_metadata",
        coverage_scope: "file_metadata",
        locator: "E:\\docs\\scan.pdf",
        extraction_mode: "pdf_ocr_unavailable",
        content_extracted: false
      }]
    }
  };
  const taskSpec = { contract: { source_scope: "uploaded_files" } };
  assert.equal(validateContentEvidenceGate({ taskSpec, contextPacket }).ok, true);
  const inlineOnly = validateContentEvidenceGate({ taskSpec, contextPacket, mode: "inline_context_only" });
  assert.equal(inlineOnly.ok, false);
  assert.equal(inlineOnly.violations[0].kind, "file_content_required");
});
