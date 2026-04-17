// Live end-to-end test of the page-source extractor against real YouTube and
// article pages. Hits the network — run manually when you need to confirm
// the pipeline still works against the current internet.
//
// Usage:  node scripts/probe-page-source-live.mjs [videoUrl] [articleUrl]
//
// Simulates what the browser content script would produce so we can also
// validate the YouTube ytInitialPlayerResponse scraper against today's HTML,
// not just against a fixture.

import { extractPageContent } from "../src/service/extractors/page_source/index.mjs";
import { extractArticleFromHtml } from "../src/service/extractors/page_source/article-reader.mjs";

const DEFAULT_VIDEO_URL = "https://www.youtube.com/watch?v=aircAruvnKk"; // 3Blue1Brown NN
const DEFAULT_ARTICLE_URL = "https://en.wikipedia.org/wiki/Electron_(software_framework)";

const videoUrl = process.argv[2] || DEFAULT_VIDEO_URL;
const articleUrl = process.argv[3] || DEFAULT_ARTICLE_URL;

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9"
    },
    redirect: "follow"
  });
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  return response.text();
}

// Port of the brace-walking parser from the content script — extracts
// ytInitialPlayerResponse from the server-rendered HTML so Node can reach the
// same payload a MAIN-world content script would see.
function extractYtInitialPlayerResponseFromHtml(html) {
  const key = "ytInitialPlayerResponse";
  const idx = html.indexOf(key);
  if (idx === -1) return null;
  const afterEq = html.indexOf("=", idx);
  if (afterEq === -1) return null;
  const start = html.indexOf("{", afterEq);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function bannerLine(s) {
  return `\n─── ${s} ${"─".repeat(Math.max(3, 76 - s.length))}`;
}

async function testVideo() {
  console.log(bannerLine(`YouTube video: ${videoUrl}`));
  let html;
  try {
    html = await fetchPage(videoUrl);
  } catch (err) {
    console.log(`  ❌ fetch failed: ${err.message}`);
    return;
  }
  console.log(`  fetched HTML: ${html.length} bytes`);

  const player = extractYtInitialPlayerResponseFromHtml(html);
  if (!player) {
    console.log("  ❌ could not find ytInitialPlayerResponse in HTML");
    return;
  }
  const details = player.videoDetails ?? {};
  const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  console.log(`  title       : ${details.title ?? "(none)"}`);
  console.log(`  author      : ${details.author ?? "(none)"}`);
  console.log(`  length      : ${details.lengthSeconds ?? "?"} s`);
  console.log(`  tracks      : ${tracks.length}`);
  if (tracks.length === 0) {
    console.log("  ⚠️ no caption tracks on this video");
    return;
  }
  for (const t of tracks.slice(0, 6)) {
    console.log(`    - ${t.languageCode ?? "?"} (${t.kind || "human"}) ${t.name?.simpleText ?? ""}`);
  }

  const result = await extractPageContent({
    url: videoUrl,
    youtubeCaptionTracks: tracks.map((t) => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      kind: t.kind,
      name: t.name?.simpleText ?? ""
    })),
    videoMetadata: {
      title: details.title,
      author: details.author,
      lengthSeconds: Number(details.lengthSeconds) || 0,
      url: videoUrl
    },
    preferredLangs: ["en"]
  });

  if (!result.ok) {
    console.log(`  ❌ extractPageContent ok=false reason=${result.reason}`);
    return;
  }
  console.log(`  chosen lang : ${result.captionLang} (${result.captionKind || "human"}) — format ${result.captionFormat}`);
  console.log(`  segments    : ${result.segments.length}`);
  if (result.segments.length > 0) {
    console.log("  first 3 segments:");
    for (const seg of result.segments.slice(0, 3)) {
      console.log(`    [${seg.start.toFixed(1)}s] ${seg.text.slice(0, 80)}`);
    }
    console.log(`  transcript preview (600 chars):`);
    console.log(`    ${result.text.slice(0, 600).replace(/\n/g, "\n    ")}`);
    console.log("  ✅ video extraction works end-to-end");
  } else {
    console.log("  ❌ segments list came back empty — YouTube may be blocking the fetch");
  }
}

async function testArticle() {
  console.log(bannerLine(`Article: ${articleUrl}`));
  let html;
  try {
    html = await fetchPage(articleUrl);
  } catch (err) {
    console.log(`  ❌ fetch failed: ${err.message}`);
    return;
  }
  console.log(`  fetched HTML: ${html.length} bytes`);

  const result = extractArticleFromHtml({ html, url: articleUrl });
  if (!result.ok) {
    console.log(`  ❌ extraction reason=${result.reason}`);
    return;
  }
  console.log(`  kind        : ${result.kind}`);
  console.log(`  title       : ${result.title}`);
  console.log(`  byline      : ${result.byline ?? "(none)"}`);
  console.log(`  siteName    : ${result.siteName ?? "(none)"}`);
  console.log(`  lang        : ${result.lang ?? "(none)"}`);
  console.log(`  lengthChars : ${result.lengthChars}`);
  console.log(`  text preview (400 chars):`);
  console.log(`    ${result.text.slice(0, 400).replace(/\n/g, "\n    ")}`);
  if (result.kind === "article" && result.lengthChars > 500) {
    console.log("  ✅ article extraction works end-to-end");
  } else {
    console.log(`  ⚠️ fell back to "${result.kind}" — not an article or Readability rejected`);
  }
}

await testVideo();
await testArticle();
console.log("");
