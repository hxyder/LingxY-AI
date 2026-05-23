// Pure URL-level source detection. Takes a URL string and returns a classification
// so downstream code can pick an extractor (YouTube captions vs. article Readability
// vs. generic fallback) without touching a DOM.
//
// Keep this file DOM-free so the same logic can be reused in service-side tests,
// the content script, and the service router.

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com"
]);

function safeParseUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function detectPageSource(rawUrl) {
  const url = safeParseUrl(rawUrl);
  if (!url) return { kind: "unknown", reason: "invalid_url" };

  if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === "/watch") {
      const videoId = url.searchParams.get("v");
      if (videoId) {
        return {
          kind: "video",
          platform: "youtube",
          videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
        };
      }
    }
    if (url.pathname.startsWith("/shorts/")) {
      const videoId = url.pathname.split("/")[2] ?? "";
      if (videoId) {
        return {
          kind: "video",
          platform: "youtube",
          videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
        };
      }
    }
    if (url.hostname === "youtu.be" || url.pathname === "/embed") {
      // youtu.be short link or embedded player
      const videoId = url.pathname.replace(/^\//, "").split("/")[0];
      if (videoId) {
        return {
          kind: "video",
          platform: "youtube",
          videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
        };
      }
    }
  }

  if (url.hostname === "youtu.be") {
    const videoId = url.pathname.replace(/^\//, "").split("/")[0];
    if (videoId) {
      return {
        kind: "video",
        platform: "youtube",
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`
      };
    }
  }

  // Default: assume article / generic web page. The caller will run Readability
  // and decide whether the page is actually readable.
  return { kind: "article", platform: "generic", url: url.toString() };
}
