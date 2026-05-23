// Orchestrates page source extraction across the three shapes we currently
// handle: YouTube video (caption-driven), general article (Readability), and
// fallback plain-text.
//
// Inputs usually arrive from the browser extension: URL, HTML snapshot, and
// optionally a YouTube caption track list pulled from `ytInitialPlayerResponse`.
// The service never has to decide how to reach into the live page — the content
// script does the DOM work and we reason over its payload.

import { detectPageSource } from "./detector.mjs";
import { extractArticleFromHtml } from "./article-reader.mjs";
import {
  fetchTranscriptFromBaseUrl,
  pickCaptionTrack,
  parseTranscriptBody
} from "./youtube-transcript.mjs";

function formatSecondsTimestamp(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function buildTranscriptText(segments) {
  return segments
    .map((seg) => `[${formatSecondsTimestamp(seg.start)}] ${seg.text}`)
    .join("\n");
}

async function extractYouTubeInternal({
  videoMetadata = {},
  captionTracks = [],
  preferredLangs = [],
  preFetchedTranscript = null,
  selectedCaption = null,
  fetchImpl
}) {
  const baseResponse = {
    ok: true,
    kind: "video",
    platform: "youtube",
    title: videoMetadata.title ?? "",
    author: videoMetadata.author ?? "",
    lengthSeconds: videoMetadata.lengthSeconds ?? 0,
    url: videoMetadata.url ?? ""
  };

  // Browser-extension DOM path: content script scraped the transcript panel
  // directly (works even when YouTube's timedtext endpoint is PoT-gated).
  // Segments arrive pre-parsed.
  if (preFetchedTranscript && Array.isArray(preFetchedTranscript.segments) && preFetchedTranscript.segments.length > 0) {
    const segments = preFetchedTranscript.segments;
    return {
      ...baseResponse,
      captionLang: selectedCaption?.languageCode ?? "",
      captionKind: selectedCaption?.kind ?? "",
      captionFormat: preFetchedTranscript.format ?? "dom",
      segments,
      text: buildTranscriptText(segments),
      reason: null
    };
  }

  // Browser-extension fast path: content script already fetched the transcript
  // using the user's session cookies. We just parse whatever body it handed us.
  if (preFetchedTranscript && preFetchedTranscript.body) {
    const { segments, format } = parseTranscriptBody(preFetchedTranscript);
    return {
      ...baseResponse,
      captionLang: selectedCaption?.languageCode ?? "",
      captionKind: selectedCaption?.kind ?? "",
      captionFormat: format,
      segments,
      text: buildTranscriptText(segments),
      reason: segments.length === 0 ? "transcript_body_empty" : null
    };
  }

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    return {
      ...baseResponse,
      captionLang: "",
      text: "",
      segments: [],
      reason: preFetchedTranscript?.error
        ? `capture_transcript_error:${preFetchedTranscript.error}`
        : "no_captions_available"
    };
  }

  // Browser already attempted and failed — server-side retry won't succeed
  // (YouTube's timedtext refuses cookieless requests and DOM scraping needs
  // the live tab). Surface the browser's actual error instead of another
  // generic one, so the UI can guide the user to a useful fallback.
  if (preFetchedTranscript?.error) {
    return {
      ...baseResponse,
      captionLang: selectedCaption?.languageCode ?? "",
      text: "",
      segments: [],
      reason: `capture_transcript_error:${preFetchedTranscript.error}`
    };
  }

  const chosen = pickCaptionTrack(captionTracks, preferredLangs);
  if (!chosen?.baseUrl) {
    return {
      ...baseResponse,
      captionLang: "",
      text: "",
      segments: [],
      reason: "no_caption_baseurl"
    };
  }

  const { segments, format } = await fetchTranscriptFromBaseUrl(chosen.baseUrl, { fetchImpl });
  return {
    ...baseResponse,
    captionLang: chosen.languageCode ?? "",
    captionKind: chosen.kind ?? "",
    captionFormat: format,
    segments,
    text: buildTranscriptText(segments),
    reason: segments.length === 0 ? "caption_fetch_empty" : null
  };
}

export async function extractPageContent({
  url,
  html = "",
  youtubeCaptionTracks = null,
  videoMetadata = null,
  preferredLangs = [],
  preFetchedTranscript = null,
  selectedCaption = null,
  fetchImpl = undefined
} = {}) {
  const detection = detectPageSource(url);

  if (detection.kind === "video" && detection.platform === "youtube") {
    return extractYouTubeInternal({
      videoMetadata: {
        url: detection.canonicalUrl,
        ...(videoMetadata ?? {})
      },
      captionTracks: youtubeCaptionTracks ?? [],
      preferredLangs,
      preFetchedTranscript,
      selectedCaption,
      fetchImpl
    });
  }

  // Article / fallback — we need html from the content script.
  if (!html) {
    return {
      ok: false,
      kind: "unknown",
      url: url ?? "",
      reason: "html_required_for_article"
    };
  }

  const article = extractArticleFromHtml({ html, url: url ?? "" });
  return article;
}

export { detectPageSource } from "./detector.mjs";
export { extractArticleFromHtml } from "./article-reader.mjs";
export {
  fetchTranscriptFromBaseUrl,
  pickCaptionTrack
} from "./youtube-transcript.mjs";
