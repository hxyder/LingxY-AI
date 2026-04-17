// Validates the page-source extraction pipeline without network / live pages.
//
// Covers:
//   • URL detection (YouTube watch, shorts, youtu.be, article)
//   • YouTube caption parsing (XML + json3) — pure transcript parsers
//   • YouTube orchestration with a stubbed fetch
//   • Article extraction via linkedom + Readability
//   • Fallback when page isn't reader-friendly

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectPageSource } from "../src/service/extractors/page_source/detector.mjs";
import { extractArticleFromHtml } from "../src/service/extractors/page_source/article-reader.mjs";
import {
  fetchTranscriptFromBaseUrl,
  pickCaptionTrack,
  __test__ as ytInternals
} from "../src/service/extractors/page_source/youtube-transcript.mjs";
import { extractPageContent } from "../src/service/extractors/page_source/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── 1. Detector ─────────────────────────────────────────────────────────── */

{
  const yt = detectPageSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share");
  assert.equal(yt.kind, "video");
  assert.equal(yt.platform, "youtube");
  assert.equal(yt.videoId, "dQw4w9WgXcQ");
  assert.ok(yt.canonicalUrl.includes("dQw4w9WgXcQ"));

  const shorts = detectPageSource("https://youtube.com/shorts/abc123XYZ");
  assert.equal(shorts.kind, "video");
  assert.equal(shorts.videoId, "abc123XYZ");

  const short = detectPageSource("https://youtu.be/zzzYYY111");
  assert.equal(short.kind, "video");
  assert.equal(short.videoId, "zzzYYY111");

  const article = detectPageSource("https://example.com/blog/hello-world");
  assert.equal(article.kind, "article");

  const invalid = detectPageSource("not a url");
  assert.equal(invalid.kind, "unknown");
  assert.equal(invalid.reason, "invalid_url");
}

/* ── 2. Caption parsing (pure) ───────────────────────────────────────────── */

{
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
<text start="0.0" dur="2.5">Hello &amp; welcome</text>
<text start="2.6" dur="3.1">Today we &#39;re covering&#32;caching</text>
<text start="5.8" dur="1.0"></text>
</transcript>`;
  const segs = ytInternals.parseXmlTranscript(xml);
  assert.equal(segs.length, 2, "empty <text> should be dropped");
  assert.equal(segs[0].text, "Hello & welcome");
  assert.match(segs[1].text, /caching/);
  assert.equal(segs[0].start, 0);
  assert.equal(segs[1].duration, 3.1);

  const json3 = JSON.stringify({
    events: [
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "First" }, { utf8: " line" }] },
      { tStartMs: 3500, dDurationMs: 1500, segs: [{ utf8: "Second line" }] },
      { tStartMs: 5000, dDurationMs: 1000, segs: [{ utf8: "" }] }
    ]
  });
  const j3 = ytInternals.parseJson3Transcript(json3);
  assert.equal(j3.length, 2);
  assert.equal(j3[0].text, "First line");
  assert.equal(j3[0].start, 1);
  assert.equal(j3[1].duration, 1.5);
}

/* ── 3. Caption track picking ────────────────────────────────────────────── */

{
  const tracks = [
    { baseUrl: "u1", languageCode: "es", kind: "asr" },
    { baseUrl: "u2", languageCode: "en", kind: "asr" },
    { baseUrl: "u3", languageCode: "en", kind: "" },   // human-authored English
    { baseUrl: "u4", languageCode: "fr", kind: "" }
  ];
  const chosen = pickCaptionTrack(tracks, ["en-US"]);
  assert.equal(chosen.baseUrl, "u3", "prefer human-authored English match");

  const chosenNoPref = pickCaptionTrack(tracks, []);
  assert.ok(["u3", "u4"].includes(chosenNoPref.baseUrl), "prefer non-ASR when no language hint");

  assert.equal(pickCaptionTrack([], ["en"]), null, "empty tracks → null");
}

/* ── 4. YouTube orchestrator with stubbed fetch ──────────────────────────── */

{
  const captionPayload = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: "Intro text" }] },
      { tStartMs: 3200, dDurationMs: 2500, segs: [{ utf8: "Main point" }] }
    ]
  });
  const fakeFetch = async () => captionPayload;

  const result = await fetchTranscriptFromBaseUrl("https://example/timedtext?v=abc", {
    fetchImpl: fakeFetch
  });
  assert.equal(result.format, "json3");
  assert.equal(result.segments.length, 2);

  const orchestrated = await extractPageContent({
    url: "https://www.youtube.com/watch?v=testvid001",
    youtubeCaptionTracks: [
      { baseUrl: "https://example/timedtext?v=testvid001", languageCode: "en", kind: "" }
    ],
    videoMetadata: { title: "Test Video", author: "Channel X", lengthSeconds: 360 },
    fetchImpl: fakeFetch
  });
  assert.equal(orchestrated.ok, true);
  assert.equal(orchestrated.kind, "video");
  assert.equal(orchestrated.segments.length, 2);
  assert.match(orchestrated.text, /\[00:00\] Intro text/);
  assert.equal(orchestrated.title, "Test Video");
}

{
  const noCaps = await extractPageContent({
    url: "https://www.youtube.com/watch?v=nocap",
    youtubeCaptionTracks: [],
    videoMetadata: { title: "Silent Film" }
  });
  assert.equal(noCaps.kind, "video");
  assert.equal(noCaps.reason, "no_captions_available");
  assert.equal(noCaps.text, "");
}

/* ── 4c. DOM-scraped transcript segments (Youtube transcript panel) ────── */

{
  const out = await extractPageContent({
    url: "https://www.youtube.com/watch?v=domPath01",
    videoMetadata: { title: "DOM Path Test" },
    preFetchedTranscript: {
      segments: [
        { start: 0, duration: 0, text: "Welcome back to the channel" },
        { start: 5, duration: 0, text: "Today we're covering" }
      ],
      format: "dom",
      error: null
    },
    selectedCaption: { languageCode: "en", kind: "" }
  });
  assert.equal(out.kind, "video");
  assert.equal(out.captionFormat, "dom");
  assert.equal(out.segments.length, 2);
  assert.match(out.text, /\[00:00\] Welcome back to the channel/);
  assert.match(out.text, /\[00:05\] Today we're covering/);
}

/* ── 4b. Pre-fetched transcript body (browser session path) ────────────── */

{
  const json3Body = JSON.stringify({
    events: [
      { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Session-fetched" }] },
      { tStartMs: 2500, dDurationMs: 2000, segs: [{ utf8: "caption text" }] }
    ]
  });
  const out = await extractPageContent({
    url: "https://www.youtube.com/watch?v=session001",
    youtubeCaptionTracks: [{ baseUrl: "irrelevant", languageCode: "en", kind: "" }],
    videoMetadata: { title: "Session Test", author: "User" },
    preFetchedTranscript: { body: json3Body, format: "json3", error: null },
    selectedCaption: { languageCode: "en", kind: "" }
  });
  assert.equal(out.kind, "video");
  assert.equal(out.segments.length, 2, "pre-fetched body should be parsed into segments");
  assert.match(out.text, /Session-fetched/);
  assert.equal(out.captionLang, "en");
  assert.equal(out.captionFormat, "json3");
}

{
  // When content script reports a fetch error AND has no tracks, the reason
  // should surface the capture-level error for telemetry.
  const out = await extractPageContent({
    url: "https://www.youtube.com/watch?v=err001",
    youtubeCaptionTracks: [],
    preFetchedTranscript: { body: "", format: "none", error: "http_200_empty" }
  });
  assert.equal(out.reason, "capture_transcript_error:http_200_empty");
}

/* ── 5. Article extraction (Readability + linkedom) ─────────────────────── */

{
  const bigParagraph = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(40);
  const html = `<!doctype html><html lang="en"><head><title>Great Article</title></head>
<body>
  <header><nav>Home | About</nav></header>
  <article>
    <h1>Great Article</h1>
    <p class="byline">By Jane Doe</p>
    <p>${bigParagraph}</p>
    <p>${bigParagraph}</p>
  </article>
  <footer>Copyright notice irrelevant to readers.</footer>
</body></html>`;

  const article = extractArticleFromHtml({ html, url: "https://example.com/great" });
  assert.equal(article.ok, true);
  assert.equal(article.kind, "article");
  assert.equal(article.url, "https://example.com/great");
  assert.match(article.title, /Great Article/);
  assert.ok(article.lengthChars > 100, "expected substantial extracted length");
  assert.match(article.text, /Lorem ipsum/);
  // Should not include nav / footer chrome
  assert.doesNotMatch(article.text, /Copyright notice/);
}

/* ── 6. Fallback when page is not reader-friendly ───────────────────────── */

{
  const tiny = `<!doctype html><html><head><title>Login</title></head>
<body><button>Sign in</button></body></html>`;
  const fb = extractArticleFromHtml({ html: tiny, url: "https://example.com/login" });
  assert.equal(fb.ok, true);
  assert.equal(fb.kind, "fallback");
  assert.equal(fb.title, "Login");
}

/* ── 7. Orchestrator routes article path correctly ──────────────────────── */

{
  const bigParagraph = "Sample prose content. ".repeat(120);
  const html = `<!doctype html><html lang="en"><head><title>Routed</title></head>
<body><article><h1>Routed</h1><p>${bigParagraph}</p></article></body></html>`;
  const out = await extractPageContent({
    url: "https://example.com/article/routed",
    html
  });
  assert.equal(out.ok, true);
  assert.equal(out.kind, "article");
  assert.match(out.text, /Sample prose content/);
}

/* ── 8. Orchestrator handles missing HTML for article path ─────────────── */

{
  const out = await extractPageContent({ url: "https://example.com/empty" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "html_required_for_article");
}

console.log("Page source extractor verification passed.");
