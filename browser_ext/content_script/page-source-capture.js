// Browser-side capture of page source content so the service can turn it into
// an "explain this page / video" task.
//
// IMPORTANT: this file is injected into the page's MAIN world (see manifest
// `world: "MAIN"`). That means it has no access to chrome.* APIs, but it CAN
// read page globals like `ytInitialPlayerResponse` that YouTube defines on
// the real window, AND it can fetch() with the user's real session cookies.
// The latter matters: YouTube's timedtext endpoint returns an empty 200 for
// bare server-side GETs — in-browser it works fine.
//
// Exposed API:
//   await window.__ucaPageSourceCapture()  ->  payload object
//
// Payload shape:
//   { url, hostname,
//     kind: "video" | "article",
//     platform: "youtube" | "generic",
//     youtube: { videoId, title, author, lengthSeconds,
//                captionTracks[], selectedCaption,
//                transcriptBody, transcriptFormat, transcriptError } | null,
//     html: string,     // outerHTML for non-video pages, empty for video
//     title, lang,
//     capturedAt: ISO string }
//
// The HTML is deliberately sanitised (script/style/noscript stripped) before
// serialisation so sensitive inline secrets never leave the page.

(function installPageSourceCapture() {
  if (typeof window === "undefined") return;
  if (typeof window.__ucaPageSourceCapture === "function") return; // idempotent

  const YOUTUBE_HOSTS = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com"
  ]);

  function detectYouTubeVideoId(url) {
    try {
      const u = new URL(url);
      if (YOUTUBE_HOSTS.has(u.hostname)) {
        if (u.pathname === "/watch") {
          return u.searchParams.get("v") || null;
        }
        if (u.pathname.startsWith("/shorts/")) {
          return u.pathname.split("/")[2] ?? null;
        }
        if (u.pathname.startsWith("/embed/")) {
          return u.pathname.split("/")[2] ?? null;
        }
      }
      if (u.hostname === "youtu.be") {
        return u.pathname.replace(/^\//, "").split("/")[0] || null;
      }
    } catch {
      /* invalid URL — fall through */
    }
    return null;
  }

  function readYouTubePlayerResponse() {
    if (typeof window.ytInitialPlayerResponse === "object" && window.ytInitialPlayerResponse) {
      return window.ytInitialPlayerResponse;
    }
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent ?? "";
      const idx = text.indexOf("ytInitialPlayerResponse");
      if (idx === -1) continue;
      const afterEq = text.indexOf("=", idx);
      if (afterEq === -1) continue;
      const start = text.indexOf("{", afterEq);
      if (start === -1) continue;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
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
              return JSON.parse(text.slice(start, i + 1));
            } catch {
              return null;
            }
          }
        }
      }
    }
    return null;
  }

  // Pick the best caption track. Prefer human-authored over ASR; prefer a
  // language that matches the page's <html lang> or English fallback.
  function pickCaptionTrack(tracks) {
    const list = tracks.filter((t) => t && t.baseUrl);
    if (list.length === 0) return null;

    const pageLang = `${document.documentElement?.lang ?? ""}`.toLowerCase();
    const hints = [];
    if (pageLang) hints.push(pageLang);
    hints.push("en");

    const score = (track) => {
      let s = 0;
      if (track.kind !== "asr") s += 100;
      const lang = `${track.languageCode ?? ""}`.toLowerCase();
      const pref = lang.split(/[-_]/)[0];
      if (hints.includes(lang)) s += 50;
      else if (hints.some((h) => h.split(/[-_]/)[0] === pref)) s += 30;
      if (lang.startsWith("en")) s += 10;
      return s;
    };
    return [...list].sort((a, b) => score(b) - score(a))[0];
  }

  async function fetchTranscriptBody(baseUrl) {
    if (typeof baseUrl !== "string" || !baseUrl) {
      return { body: "", format: "none", error: "no_baseurl" };
    }

    // Prefer json3 — deterministic parsing, no HTML-entity surprises. Falls
    // back to the default XML only if json3 returns empty. Both are liable to
    // return `HTTP 200 empty-body` on modern YouTube (PoT anti-bot); the
    // orchestrator falls back to DOM scraping in that case.
    const json3Url = baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
    try {
      const response = await fetch(json3Url, { credentials: "include" });
      const body = await response.text();
      if (response.ok && body && body.trim().startsWith("{")) {
        return { body, format: "json3", error: null };
      }
    } catch {
      /* fall through to xml attempt */
    }

    try {
      const response = await fetch(baseUrl, { credentials: "include" });
      const body = await response.text();
      if (response.ok && body) {
        return { body, format: "xml", error: null };
      }
      return { body: "", format: "none", error: `http_${response.status}_empty` };
    } catch (err) {
      return { body: "", format: "none", error: err?.message ?? String(err) };
    }
  }

  // Parse a "MM:SS" or "HH:MM:SS" timestamp string used in YouTube's
  // transcript panel back into seconds.
  function parseTimestampString(s) {
    const parts = `${s ?? ""}`.trim().split(":").map((n) => parseInt(n, 10) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  function readTranscriptSegmentsFromDom() {
    const nodes = document.querySelectorAll(
      "ytd-transcript-segment-renderer, " +
      "ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer"
    );
    if (nodes.length === 0) return [];
    const segments = [];
    for (const node of nodes) {
      const timeEl = node.querySelector(".segment-timestamp, div.segment-timestamp, #timestamp, [class*='timestamp']");
      const textEl = node.querySelector(".segment-text, yt-formatted-string.segment-text, #segment-text, [class*='segment-text']");
      if (!timeEl || !textEl) continue;
      const timeStr = (timeEl.textContent ?? "").trim();
      const text = (textEl.textContent ?? "").trim().replace(/\s+/g, " ");
      if (!text) continue;
      segments.push({
        start: parseTimestampString(timeStr),
        duration: 0,
        text
      });
    }
    return segments;
  }

  async function waitForTranscriptSegments(deadlineMs = 5000) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      const segments = readTranscriptSegmentsFromDom();
      if (segments.length > 0) return segments;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return [];
  }

  // Language-tolerant matcher for "Show transcript" across layouts.
  const TRANSCRIPT_LABEL_RE = /transcript|文字稿|转录|逐字稿|字幕稿|script|transkript|transcrip|문자 전사|스크립트|字幕|字幕起こし|文字起こし|文字起し/i;

  function isTranscriptLabel(value) {
    return typeof value === "string" && TRANSCRIPT_LABEL_RE.test(value);
  }

  function findShowTranscriptButton() {
    const candidates = document.querySelectorAll(
      "button, yt-button-shape button, tp-yt-paper-button, ytd-button-renderer button, " +
      "ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, " +
      "yt-formatted-string[role='button']"
    );
    for (const el of candidates) {
      if (!(el instanceof HTMLElement)) continue;
      if (isTranscriptLabel(el.getAttribute("aria-label"))) return el;
      if (isTranscriptLabel(el.textContent)) return el;
      const inner = el.querySelector("[aria-label]");
      if (inner && isTranscriptLabel(inner.getAttribute("aria-label"))) return el;
    }
    return null;
  }

  function findMoreActionsMenuButton() {
    // The video "more actions" button that reveals the ... menu. YouTube
    // names it differently across locales; cover the common ones.
    const selectors = [
      "#menu ytd-menu-renderer yt-icon-button button",
      "ytd-menu-renderer yt-button-shape button",
      "#actions-inner ytd-menu-renderer button"
    ];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const label = (node.getAttribute("aria-label") ?? "").toLowerCase();
        if (/more|更多|その他|더보기|mais|más/i.test(label)) return node;
      }
    }
    return null;
  }

  async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // YouTube's Polymer buttons don't react reliably to bare `.click()` — dispatch
  // a full pointer+mouse event sequence so the Polymer gesture detectors see
  // a genuine-looking click. Also bubble, so parent event listeners fire.
  function trustedClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
    try { el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", button: 0 })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("mousedown", { ...base, button: 0 })); } catch { /* ignore */ }
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", button: 0 })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("mouseup", { ...base, button: 0 })); } catch { /* ignore */ }
    try { el.dispatchEvent(new MouseEvent("click", { ...base, button: 0 })); } catch { /* ignore */ }
    try { if (typeof el.click === "function") el.click(); } catch { /* ignore */ }
  }

  // Directly flip the engagement panel's visibility attribute. YouTube renders
  // panels based on this attribute; forcing it EXPANDED usually reveals the
  // transcript even when button clicks fail (common on Polymer-hydration
  // edge cases).
  function forceTranscriptPanelExpanded() {
    const panels = document.querySelectorAll("ytd-engagement-panel-section-list-renderer");
    let changed = false;
    for (const panel of panels) {
      const target = panel.getAttribute("target-id") ?? "";
      if (!/transcript/i.test(target)) continue;
      try {
        panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
        panel.removeAttribute("hidden");
        // Polymer observers sometimes need a nudge — fire a tiny event.
        panel.dispatchEvent(new Event("visibility-changed", { bubbles: true }));
        changed = true;
      } catch { /* ignore */ }
    }
    return changed;
  }

  // Fallback when timedtext returns empty: scrape YouTube's own transcript
  // panel. Now with 4 strategies that actually work on 2026-era YouTube:
  //   1) existing open panel  (cheap, free win when user pre-opened it)
  //   2) click all visible "Show transcript" buttons with full event sequence
  //   3) force-flip the panel's visibility attribute directly
  //   4) diagnostic fallback with a list of what we tried
  async function scrapeTranscriptFromDom() {
    let segments = readTranscriptSegmentsFromDom();
    if (segments.length > 0) return { segments, format: "dom", error: null };

    const tried = [];

    // Strategy 1: ensure description is expanded (button may be inside it)
    const expandSelectors = [
      "tp-yt-paper-button#expand",
      "#description-inline-expander tp-yt-paper-button",
      "#description-inline-expander",
      "ytd-text-inline-expander #expand",
      "ytd-watch-metadata [id='description-inline-expander']"
    ];
    for (const sel of expandSelectors) {
      const node = document.querySelector(sel);
      if (node instanceof HTMLElement) {
        try { node.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
        try { node.click(); } catch { /* ignore */ }
        await sleep(200);
        break;
      }
    }
    segments = readTranscriptSegmentsFromDom();
    if (segments.length > 0) return { segments, format: "dom", error: null };

    // Strategy 2: collect every "Show transcript" match, prefer visible ones,
    // and dispatch a full event sequence. Bare .click() is not enough on
    // Polymer — it's why the previous attempt saw 4 buttons but none reacted.
    const RE = TRANSCRIPT_LABEL_RE;
    const candidates = [...document.querySelectorAll(
      "button, yt-button-shape button, tp-yt-paper-button, ytd-button-renderer button, " +
      "ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, " +
      "ytd-video-description-transcript-section-renderer, [role='button']"
    )].filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      return RE.test(el.getAttribute("aria-label") ?? "") || RE.test(el.textContent ?? "");
    });
    // Prefer visible ones (offset > 0); fall back to hidden ones.
    candidates.sort((a, b) => {
      const aVis = a.offsetHeight > 0 ? 1 : 0;
      const bVis = b.offsetHeight > 0 ? 1 : 0;
      return bVis - aVis;
    });

    if (candidates.length > 0) {
      tried.push(`click(${candidates.length})`);
      for (const btn of candidates) {
        try { btn.scrollIntoView({ block: "center", inline: "nearest" }); } catch { /* ignore */ }
        trustedClick(btn);
        await sleep(150);
        segments = readTranscriptSegmentsFromDom();
        if (segments.length > 0) return { segments, format: "dom", error: null };
      }
      // Buttons clicked but no segments yet — give YouTube a moment to hydrate.
      segments = await waitForTranscriptSegments(4000);
      if (segments.length > 0) return { segments, format: "dom", error: null };
    }

    // Strategy 3: force the engagement panel's visibility attribute to
    // EXPANDED. YouTube's transcript panel element is already in the DOM
    // (we observed visibility=HIDDEN). Toggling the attribute often works
    // when Polymer gesture detectors won't respond to simulated clicks.
    if (forceTranscriptPanelExpanded()) {
      tried.push("force_panel");
      segments = await waitForTranscriptSegments(5000);
      if (segments.length > 0) return { segments, format: "dom", error: null };
    }

    // Strategy 4: open "..." overflow menu and retry clicks.
    const moreBtn = findMoreActionsMenuButton();
    if (moreBtn) {
      tried.push("overflow");
      trustedClick(moreBtn);
      const menuDeadline = Date.now() + 1500;
      let found = null;
      while (Date.now() < menuDeadline) {
        await sleep(100);
        found = findShowTranscriptButton();
        if (found) break;
      }
      if (found) {
        trustedClick(found);
        segments = await waitForTranscriptSegments(5000);
        if (segments.length > 0) return { segments, format: "dom", error: null };
      }
    }

    const suffix = tried.length > 0 ? `(tried:${tried.join(",")})` : "(no_button_found)";
    return { segments: [], format: "none", error: `transcript_unavailable ${suffix}` };
  }

  async function captureYouTube() {
    const videoId = detectYouTubeVideoId(window.location.href);
    if (!videoId) return null;

    const player = readYouTubePlayerResponse();
    const details = player?.videoDetails ?? {};
    const captionList = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

    const captionTracks = captionList.map((track) => ({
      baseUrl: track.baseUrl ?? "",
      languageCode: track.languageCode ?? "",
      kind: track.kind ?? "",
      name: track.name?.simpleText ?? track.name?.runs?.[0]?.text ?? ""
    })).filter((t) => t.baseUrl);

    const result = {
      videoId,
      title: details.title ?? document.title ?? "",
      author: details.author ?? "",
      lengthSeconds: Number(details.lengthSeconds) || 0,
      thumbnailUrl: details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ?? "",
      captionTracks,
      selectedCaption: null,
      transcriptBody: "",
      transcriptFormat: "none",
      transcriptSegments: [],
      transcriptError: null,
      transcriptSource: "none"
    };

    // Step 1 — try the timedtext API when we have a baseUrl. Fast path when
    // YouTube hasn't PoT-gated the request.
    if (captionTracks.length > 0) {
      const chosen = pickCaptionTrack(captionTracks);
      if (chosen) {
        result.selectedCaption = {
          languageCode: chosen.languageCode,
          kind: chosen.kind,
          name: chosen.name
        };
        const fetched = await fetchTranscriptBody(chosen.baseUrl);
        if (fetched.body) {
          result.transcriptBody = fetched.body;
          result.transcriptFormat = fetched.format;
          result.transcriptError = null;
          result.transcriptSource = "timedtext";
          return result;
        }
        result.transcriptError = fetched.error;
      } else {
        result.transcriptError = "no_selectable_caption";
      }
    } else {
      result.transcriptError = "no_captions_available";
    }

    // Step 2 — DOM fallback. Works even when timedtext returns 200-empty
    // (which is YouTube's current default for anonymous sessions on many
    // videos). Opens YouTube's own "Show transcript" panel and scrapes it.
    const dom = await scrapeTranscriptFromDom();
    if (dom.segments.length > 0) {
      result.transcriptSegments = dom.segments;
      result.transcriptFormat = "dom";
      result.transcriptError = null;
      result.transcriptSource = "dom";
      return result;
    }
    // DOM also failed — preserve the prior error, but enrich it.
    result.transcriptError = result.transcriptError
      ? `${result.transcriptError}; dom:${dom.error ?? "unknown"}`
      : (dom.error ?? "unknown");
    return result;
  }

  function serializeDocumentHtml() {
    const clone = document.documentElement.cloneNode(true);
    const drop = clone.querySelectorAll("script,style,noscript,iframe,svg");
    drop.forEach((el) => el.remove());
    return `<!doctype html>\n${clone.outerHTML}`;
  }

  function captureArticle() {
    return {
      html: serializeDocumentHtml(),
      title: document.title ?? "",
      lang: document.documentElement.lang ?? ""
    };
  }

  async function capturePageSource() {
    const url = window.location.href;
    const hostname = window.location.hostname;
    const youtube = await captureYouTube();
    if (youtube) {
      return {
        url,
        hostname,
        kind: "video",
        platform: "youtube",
        youtube,
        html: "",
        title: youtube.title,
        lang: document.documentElement.lang ?? "",
        capturedAt: new Date().toISOString()
      };
    }
    const article = captureArticle();
    return {
      url,
      hostname,
      kind: "article",
      platform: "generic",
      youtube: null,
      html: article.html,
      title: article.title,
      lang: article.lang,
      capturedAt: new Date().toISOString()
    };
  }

  window.__ucaPageSourceCapture = capturePageSource;

  // Main-world ↔ isolated-world bridge: isolated-world scripts dispatch a
  // CustomEvent("uca:capture-page-source") with `{ detail: { requestId } }`;
  // we respond with the same requestId on "uca:capture-page-source:result".
  window.addEventListener("uca:capture-page-source", async (event) => {
    const requestId = event?.detail?.requestId ?? null;
    let payload = null;
    let error = null;
    try {
      payload = await capturePageSource();
    } catch (err) {
      error = err?.message ?? String(err);
    }
    window.dispatchEvent(new CustomEvent("uca:capture-page-source:result", {
      detail: { requestId, payload, error }
    }));
  });
})();
