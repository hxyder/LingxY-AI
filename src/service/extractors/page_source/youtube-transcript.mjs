// Fetch YouTube transcript segments from a caption-track baseUrl.
//
// YouTube exposes captions via a public timedtext endpoint. The content script
// can read the caption track list straight from `ytInitialPlayerResponse` in
// the page — we just need to ask timedtext for the actual segments.
//
// XML format used historically:
//   <transcript>
//     <text start="12.34" dur="3.4">Hello world</text>
//     ...
//   </transcript>
//
// Newer json3 format (when `&fmt=json3` is appended) is easier to parse — we
// prefer it when available and fall back to XML.

function decodeHtmlEntities(text) {
  if (typeof text !== "string") return "";
  return text.replace(/&(#x[0-9a-f]+|#\d+|nbsp|quot|#39|apos|lt|gt|amp);/gi, (_match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) return safeCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith("#")) return safeCodePoint(Number.parseInt(normalized.slice(1), 10));
    return {
      amp: "&",
      apos: "'",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: '"'
    }[normalized] ?? "";
  });
}

function safeCodePoint(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return "";
  try { return String.fromCodePoint(value); } catch { return ""; }
}

function parseXmlTranscript(xml) {
  const segments = [];
  if (typeof xml !== "string") return segments;
  const textTagRe = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = textTagRe.exec(xml)) !== null) {
    const attrs = match[1];
    const body = match[2];
    const startMatch = /start="([^"]+)"/.exec(attrs);
    const durMatch = /dur="([^"]+)"/.exec(attrs);
    const start = startMatch ? Number(startMatch[1]) : 0;
    const duration = durMatch ? Number(durMatch[1]) : 0;
    const text = decodeHtmlEntities(body).replace(/\s+/g, " ").trim();
    if (text) {
      segments.push({ start, duration, text });
    }
  }
  return segments;
}

function parseJson3Transcript(jsonText) {
  const segments = [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return segments;
  }
  const events = Array.isArray(parsed?.events) ? parsed.events : [];
  for (const event of events) {
    const segs = Array.isArray(event?.segs) ? event.segs : [];
    if (segs.length === 0) continue;
    const text = segs.map((s) => s?.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const start = typeof event.tStartMs === "number" ? event.tStartMs / 1000 : 0;
    const duration = typeof event.dDurationMs === "number" ? event.dDurationMs / 1000 : 0;
    segments.push({ start, duration, text });
  }
  return segments;
}

// Pick the "best" caption track: prefer user-provided over ASR auto-captions,
// prefer the user's language tag when one is supplied, then fall back to the
// first track. YouTube's tracklist has `kind: "asr"` on machine-generated ones.
export function pickCaptionTrack(tracks = [], preferredLangs = []) {
  const list = Array.isArray(tracks) ? tracks.filter((t) => t && t.baseUrl) : [];
  if (list.length === 0) return null;

  const userLangs = preferredLangs.map((l) => `${l ?? ""}`.toLowerCase()).filter(Boolean);
  const score = (track) => {
    let s = 0;
    if (track.kind !== "asr") s += 100;
    const lang = `${track.languageCode ?? ""}`.toLowerCase();
    const langPrefix = lang.split(/[-_]/)[0];
    if (userLangs.includes(lang)) s += 50;
    else if (userLangs.some((u) => u.split(/[-_]/)[0] === langPrefix)) s += 30;
    if (lang.startsWith("en")) s += 10;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0];
}

async function fetchWithFetch(url) {
  if (typeof fetch !== "function") {
    throw new Error("No global fetch available in this runtime.");
  }
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json, text/xml, */*",
      "User-Agent": "Mozilla/5.0 (UCA source extractor)"
    }
  });
  if (!response.ok) {
    throw new Error(`Caption fetch failed: HTTP ${response.status}`);
  }
  return response.text();
}

// Main entry — given a caption track baseUrl (from ytInitialPlayerResponse),
// return normalised segments. Tries json3 first (more robust), then XML.
export async function fetchTranscriptFromBaseUrl(baseUrl, {
  fetchImpl = fetchWithFetch
} = {}) {
  if (typeof baseUrl !== "string" || !baseUrl) {
    return { segments: [], format: "none" };
  }

  // Try JSON3 first — deterministic parse, skips HTML-entity mess.
  const json3Url = baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
  try {
    const body = await fetchImpl(json3Url);
    if (body && body.trim().startsWith("{")) {
      const segments = parseJson3Transcript(body);
      if (segments.length > 0) return { segments, format: "json3" };
    }
  } catch {
    // fall through to XML fallback
  }

  try {
    const xml = await fetchImpl(baseUrl);
    const segments = parseXmlTranscript(xml);
    return { segments, format: "xml" };
  } catch (error) {
    return { segments: [], format: "none", error: error.message ?? String(error) };
  }
}

// Parse a pre-fetched transcript body (e.g. captured by the browser extension
// using the user's own session). Avoids the empty-body problem YouTube returns
// for cookieless server-side fetches.
export function parseTranscriptBody({ body, format } = {}) {
  if (typeof body !== "string" || !body) return { segments: [], format: "none" };
  const normalised = (format ?? "").toLowerCase();
  if (normalised === "json3" || body.trim().startsWith("{")) {
    const segments = parseJson3Transcript(body);
    if (segments.length > 0) return { segments, format: "json3" };
  }
  if (normalised === "xml" || body.includes("<text")) {
    const segments = parseXmlTranscript(body);
    if (segments.length > 0) return { segments, format: "xml" };
  }
  return { segments: [], format: "none" };
}

// Expose internals for unit tests — parsing is pure so we can verify without
// network.
export const __test__ = {
  parseXmlTranscript,
  parseJson3Transcript,
  decodeHtmlEntities
};
