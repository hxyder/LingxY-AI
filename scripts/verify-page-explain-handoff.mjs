// End-to-end verification of the /page/explain handler: feed it a video and
// article capture (shape the extension would send), confirm the service writes
// an overlay handoff file with the correct shape for the desktop to pick up.

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFile, readdir, rm } from "node:fs/promises";

import { handlePageExplain } from "../src/service/core/http-server.mjs";

const handoffDir = path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");

async function readHandoff(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

/* ── 1. YouTube video with DOM-scraped segments ─────────────────────────── */

{
  const capture = {
    url: "https://www.youtube.com/watch?v=demoV123",
    hostname: "www.youtube.com",
    kind: "video",
    platform: "youtube",
    lang: "en",
    youtube: {
      videoId: "demoV123",
      title: "Understanding Transformers",
      author: "Demo Channel",
      lengthSeconds: 780,
      captionTracks: [{ baseUrl: "irrelevant", languageCode: "en", kind: "" }],
      selectedCaption: { languageCode: "en", kind: "", name: "English" },
      transcriptBody: "",
      transcriptFormat: "dom",
      transcriptSegments: [
        { start: 0, duration: 0, text: "Welcome to the video." },
        { start: 12, duration: 0, text: "Today we look at transformers." },
        { start: 45, duration: 0, text: "The first key idea is attention." }
      ],
      transcriptError: null,
      transcriptSource: "dom"
    }
  };

  const result = await handlePageExplain({ capture });
  assert.equal(result.accepted, true);
  assert.equal(result.contentKind, "video");
  assert.equal(result.delivery, "overlay");
  assert.ok(result.handoffPath, "handoffPath missing");

  const handoff = await readHandoff(result.handoffPath);
  assert.equal(handoff.capture_mode, "explain_page");
  assert.equal(handoff.capture.sourceType, "page_explanation");
  assert.equal(handoff.capture.metadata.contentKind, "video");
  assert.equal(handoff.capture.metadata.platform, "youtube");
  assert.equal(handoff.capture.metadata.segmentCount, 3);
  assert.match(handoff.capture.text, /Understanding Transformers/);
  assert.match(handoff.capture.text, /\[00:00\] Welcome to the video/);
  assert.match(handoff.capture.text, /\[00:45\] The first key idea is attention/);
  // Language heuristic on lang=en picks English prompt
  assert.match(handoff.userCommand, /interactive explanation/i);

  await rm(result.handoffPath, { force: true });
}

/* ── 2. YouTube video with NO captions ──────────────────────────────────── */

{
  const capture = {
    url: "https://www.youtube.com/watch?v=silent01",
    hostname: "www.youtube.com",
    kind: "video",
    platform: "youtube",
    lang: "zh",
    youtube: {
      videoId: "silent01",
      title: "Silent Movie Remix",
      author: "Anon",
      lengthSeconds: 300,
      captionTracks: [],
      selectedCaption: null,
      transcriptBody: "",
      transcriptFormat: "none",
      transcriptSegments: [],
      transcriptError: "no_captions_available",
      transcriptSource: "none"
    }
  };

  const result = await handlePageExplain({ capture });
  assert.equal(result.accepted, true);
  assert.equal(result.contentKind, "video");

  const handoff = await readHandoff(result.handoffPath);
  assert.match(handoff.capture.text, /未能抓取到字幕/);
  assert.match(handoff.capture.text, /录音笔记/);
  assert.match(handoff.capture.text, /no_captions_available/);

  await rm(result.handoffPath, { force: true });
}

/* ── 3. Article page via HTML ───────────────────────────────────────────── */

{
  const bigParagraph = "The economics of GPU shortages fundamentally reshape cloud pricing strategies. ".repeat(30);
  const html = `<!doctype html><html lang="zh"><head><title>GPU 市场分析</title></head>
<body>
  <article>
    <h1>GPU 市场分析</h1>
    <p class="byline">王小明 撰稿</p>
    <p>${bigParagraph}</p>
    <p>${bigParagraph}</p>
  </article>
</body></html>`;

  const capture = {
    url: "https://example.com/gpu-analysis",
    hostname: "example.com",
    kind: "article",
    platform: "generic",
    lang: "zh",
    youtube: null,
    html,
    title: "GPU 市场分析"
  };

  const result = await handlePageExplain({ capture });
  assert.equal(result.accepted, true);
  assert.ok(["article", "fallback"].includes(result.contentKind));

  const handoff = await readHandoff(result.handoffPath);
  assert.match(handoff.capture.text, /GPU 市场分析/);
  assert.match(handoff.capture.text, /economics of GPU shortages/);
  // Chinese lang → Chinese prompt
  assert.match(handoff.userCommand, /结构化/);
  assert.match(handoff.userCommand, /分段讲解/);

  await rm(result.handoffPath, { force: true });
}

console.log("Page explain handoff verification passed.");
