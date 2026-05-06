import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { extractPageContent } from "../../extractors/page_source/index.mjs";
import { setUserLocation, getUserLocation, clearUserLocation } from "../../utils/location.mjs";
import { refreshWindowsLocation } from "../../utils/windows-geolocator.mjs";
import { readJsonBody, sendJson } from "../http-helpers.mjs";

const RECENT_BROWSER_CONTEXT_LIMIT = 30;
const RECENT_BROWSER_CONTEXT_TTL_MS = 30 * 60 * 1000;

function persistUserLocation(runtime, location) {
  try {
    runtime?.configStore?.patch?.({
      location: {
        userLocation: location ? { ...location } : null
      }
    });
  } catch {
    // Location still works for the current process; persistence is best-effort.
  }
}

async function writeOverlayHandoff(body) {
  const handoffDir = path.join(os.homedir(), "AppData", "Local", "UCA", "handoffs", "explorer");
  await mkdir(handoffDir, { recursive: true });
  const handoffPath = path.join(handoffDir, `prompt-handoff-${crypto.randomUUID().replaceAll("-", "")}.json`);
  const payload = {
    schema_version: "1.0",
    targetWindow: "overlay",
    source_app: body.capture?.browser ?? body.source_app ?? "chrome.exe",
    capture_mode: body.captureMode ?? body.capture_mode ?? "browser_extension",
    userCommand: body.userCommand ?? "请处理当前网页上下文",
    capture: body.capture ?? null,
    // Optional: prior turn from an inline-result frame, so the overlay can
    // render the previous Q + A as conversation history and the user can
    // immediately type a follow-up.
    priorResult: body.priorResult ?? null,
    priorUserCommand: body.priorUserCommand ?? null,
    captured_at: new Date().toISOString()
  };
  await writeFile(handoffPath, `${JSON.stringify(payload)}\n`, "utf8");
  return {
    accepted: true,
    delivery: "overlay",
    handoffPath
  };
}

// Turn a raw page-source capture (from the browser extension) into a normalised
// capture packet + user command that the overlay can run through the standard
// context-submission pipeline. Keeps the extension dumb (it only knows "this is
// what's on the page") and centralises all prompt / routing logic here.
function buildExplainPagePayload(capturePayload, extraction) {
  const userLang = `${capturePayload?.lang ?? ""}`.toLowerCase();
  const isEnglish = userLang.startsWith("en");

  let userCommand;
  let captureText;

  if (extraction.kind === "video") {
    if (!extraction.text) {
      // Captions missing entirely — translate the raw error code into a
      // human suggestion so the user has a clear next step.
      const reason = extraction.reason ?? "unknown";
      let userHint;
      if (/transcript_unavailable|transcript_button_not_found/.test(reason)) {
        userHint = "LingxY 无法自动打开这个视频的「显示转录 / Show transcript」面板。你可以：\n1) 手动展开视频描述，点击「显示转录」按钮，然后重试 Ctrl+Shift+E；\n2) 或切换到 LingxY「录音笔记」模式录制 2-3 分钟音频做转写。";
      } else if (/transcript_panel_timeout/.test(reason)) {
        userHint = "字幕面板打开了但加载超时。请手动确认面板已出现后重试 Ctrl+Shift+E，或改用录音笔记。";
      } else if (/no_captions_available/.test(reason)) {
        userHint = "该视频没有上传官方字幕，YouTube 也没有生成自动字幕。建议使用 LingxY「录音笔记」录制视频音频再转写。";
      } else if (/http_200_empty|caption_fetch_empty/.test(reason)) {
        userHint = "YouTube 拒绝了字幕接口（PoT 反爬），DOM 抓取也没成功。手动展开描述并点一下「显示转录」后重试 Ctrl+Shift+E，或改用录音笔记。";
      } else {
        userHint = "抓取字幕失败。可手动打开视频下方的「显示转录」面板后重试，或使用 LingxY 录音笔记。";
      }
      captureText = [
        `视频标题：${extraction.title ?? ""}`,
        `作者：${extraction.author ?? ""}`,
        `时长：${extraction.lengthSeconds}s`,
        `链接：${extraction.url ?? ""}`,
        "",
        `⚠️ 未能抓取到字幕（${reason}）`,
        "",
        userHint
      ].join("\n");
      userCommand = "请以清晰、友好的中文把下方的错误原因和建议告诉用户，不要尝试推测视频内容。";
    } else {
      captureText = [
        `视频标题：${extraction.title ?? ""}`,
        `作者：${extraction.author ?? ""}`,
        `时长：${Math.round((extraction.lengthSeconds ?? 0) / 60)} 分钟`,
        `来源：${extraction.url ?? ""}`,
        "",
        "带时间戳的完整字幕：",
        extraction.text
      ].join("\n");
      userCommand = isEnglish
        ? "Give a structured, interactive explanation of this video. Output in markdown:\n" +
          "## 一句话\n<one-sentence summary>\n\n" +
          "## 要点\n- 3 to 5 bullets covering the core ideas\n\n" +
          "## 分段讲解\n" +
          "For each logical section of the video, use `### [MM:SS] 标题`, then a paragraph that lets the reader skip the video. Preserve the speaker's key claims, numbers and examples."
        : "请对这个视频做一次结构化、可互动的完整讲解，markdown 格式：\n" +
          "## 一句话\n<一句话概括>\n\n" +
          "## 要点\n- 3–5 条覆盖核心观点\n\n" +
          "## 分段讲解\n" +
          "每个主题段落用 `### [MM:SS] 小标题`，然后一段能让读者跳过视频的详细讲解，保留说话者的关键主张、数据和例子。";
    }
  } else if (extraction.kind === "article" || extraction.kind === "fallback") {
    const title = extraction.title ?? "";
    const byline = extraction.byline ?? "";
    const siteName = extraction.siteName ?? "";
    captureText = [
      `文章标题：${title}`,
      byline ? `作者：${byline}` : "",
      siteName ? `站点：${siteName}` : "",
      `链接：${extraction.url ?? ""}`,
      "",
      "正文内容：",
      extraction.text ?? ""
    ].filter(Boolean).join("\n");
    userCommand = isEnglish
      ? "Give a structured, interactive explanation of this article. Output in markdown:\n" +
        "## 一句话\n<one-sentence summary>\n\n" +
        "## 要点\n- 3 to 5 bullets\n\n" +
        "## 分段讲解\n" +
        "Follow the article's own sections with `### 小标题` headings; each section one paragraph that preserves claims, data, examples."
      : "请对这篇文章做一次结构化、可互动的完整讲解，markdown 格式：\n" +
        "## 一句话\n<一句话概括>\n\n" +
        "## 要点\n- 3–5 条\n\n" +
        "## 分段讲解\n" +
        "按文章的结构用 `### 小标题` 分段；每段一个完整段落，保留关键主张、数据、例子。";
  } else {
    captureText = `无法识别页面类型（${extraction.kind ?? "unknown"}）。URL: ${capturePayload?.url ?? ""}`;
    userCommand = "请告知用户当前页面无法被抽取成视频或文章，建议手动复制内容再提问。";
  }

  return {
    userCommand,
    capture: {
      sourceType: "page_explanation",
      text: captureText,
      url: capturePayload?.url ?? "",
      pageTitle: extraction.title ?? capturePayload?.title ?? "",
      browser: capturePayload?.browser ?? "chrome.exe",
      metadata: {
        contentKind: extraction.kind,
        platform: extraction.platform ?? capturePayload?.platform ?? "generic",
        captionFormat: extraction.captionFormat ?? null,
        captionLang: extraction.captionLang ?? null,
        segmentCount: Array.isArray(extraction.segments) ? extraction.segments.length : 0,
        lengthChars: extraction.lengthChars ?? null,
        lengthSeconds: extraction.lengthSeconds ?? null
      }
    }
  };
}

export async function handlePageExplain(body) {
  const capturePayload = body?.capture ?? body ?? {};
  const extraction = await extractPageContent({
    url: capturePayload.url ?? "",
    html: capturePayload.html ?? "",
    youtubeCaptionTracks: capturePayload?.youtube?.captionTracks ?? null,
    videoMetadata: capturePayload?.youtube ? {
      title: capturePayload.youtube.title,
      author: capturePayload.youtube.author,
      lengthSeconds: capturePayload.youtube.lengthSeconds,
      url: capturePayload.url ?? ""
    } : null,
    preferredLangs: capturePayload.lang ? [capturePayload.lang] : [],
    preFetchedTranscript: capturePayload?.youtube ? {
      segments: capturePayload.youtube.transcriptSegments ?? [],
      body: capturePayload.youtube.transcriptBody ?? "",
      format: capturePayload.youtube.transcriptFormat ?? "none",
      error: capturePayload.youtube.transcriptError ?? null
    } : null,
    selectedCaption: capturePayload?.youtube?.selectedCaption ?? null
  });

  if (!extraction || extraction.ok === false) {
    return { accepted: false, reason: extraction?.reason ?? "extraction_failed" };
  }

  const shell = buildExplainPagePayload(capturePayload, extraction);
  const handoffResult = await writeOverlayHandoff({
    source_app: capturePayload.browser ?? "chrome.exe",
    captureMode: "explain_page",
    userCommand: shell.userCommand,
    capture: shell.capture
  });

  return {
    accepted: true,
    contentKind: extraction.kind,
    delivery: handoffResult.delivery,
    handoffPath: handoffResult.handoffPath,
    reason: extraction.reason ?? null
  };
}

function truncateString(value = "", maxLength = 1000) {
  const text = `${value ?? ""}`.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeMatchText(value = "") {
  return `${value ?? ""}`
    .toLowerCase()
    .replace(/\s+-\s+(youtube|google chrome|microsoft edge|mozilla firefox).*$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrlHost(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeBrowserContextPayload(body = {}) {
  const raw = body.context ?? body;
  const metadata = raw?.metadata && typeof raw.metadata === "object" ? raw.metadata : {};
  const youtube = metadata.youtube && typeof metadata.youtube === "object" ? metadata.youtube : null;
  const capturedAt = metadata.capturedAt || raw.capturedAt || new Date().toISOString();

  return {
    sourceType: truncateString(raw.sourceType ?? raw.source_type ?? "web_page", 80),
    browser: truncateString(raw.browser ?? "chrome.exe", 80),
    url: truncateString(raw.url ?? youtube?.canonicalUrl ?? "", 2000),
    pageTitle: truncateString(raw.pageTitle ?? raw.title ?? youtube?.title ?? "", 500),
    text: truncateString(raw.text ?? "", 8000),
    metadata: {
      capturedAt,
      platform: truncateString(metadata.platform ?? youtube?.platform ?? "", 80) || null,
      description: truncateString(metadata.description ?? youtube?.description ?? "", 2000),
      youtube: youtube ? {
        platform: "youtube",
        videoId: truncateString(youtube.videoId ?? "", 100),
        canonicalUrl: truncateString(youtube.canonicalUrl ?? raw.url ?? "", 2000),
        title: truncateString(youtube.title ?? raw.pageTitle ?? "", 500),
        channel: truncateString(youtube.channel ?? "", 300),
        description: truncateString(youtube.description ?? "", 2000),
        visibleCaptions: truncateString(youtube.visibleCaptions ?? "", 2400)
      } : null
    }
  };
}

function rememberBrowserContext(recentBrowserContexts, context) {
  const now = Date.now();
  const contextUrl = context.url || context.metadata?.youtube?.canonicalUrl || "";
  const next = {
    ...context,
    receivedAt: new Date(now).toISOString()
  };

  const existingIndex = contextUrl
    ? recentBrowserContexts.findIndex((item) => item.url === contextUrl || item.metadata?.youtube?.canonicalUrl === contextUrl)
    : -1;
  if (existingIndex >= 0) {
    recentBrowserContexts.splice(existingIndex, 1);
  }

  recentBrowserContexts.unshift(next);
  const cutoff = now - RECENT_BROWSER_CONTEXT_TTL_MS;
  for (let index = recentBrowserContexts.length - 1; index >= 0; index -= 1) {
    const received = Date.parse(recentBrowserContexts[index].receivedAt ?? recentBrowserContexts[index].metadata?.capturedAt ?? "") || 0;
    if (recentBrowserContexts.length > RECENT_BROWSER_CONTEXT_LIMIT || received < cutoff) {
      recentBrowserContexts.splice(index, 1);
    }
  }
  return next;
}

function scoreBrowserContext(context, { url = "", title = "" } = {}) {
  let score = 0;
  const contextUrl = context.url || context.metadata?.youtube?.canonicalUrl || "";
  const contextTitle = context.pageTitle || context.metadata?.youtube?.title || "";
  const normalizedTitle = normalizeMatchText(title);
  const normalizedContextTitle = normalizeMatchText(contextTitle);

  if (url && contextUrl) {
    if (contextUrl === url) score += 100;
    else if (safeUrlHost(contextUrl) && safeUrlHost(contextUrl) === safeUrlHost(url)) score += 18;
  }

  if (normalizedTitle && normalizedContextTitle) {
    if (normalizedTitle.includes(normalizedContextTitle) || normalizedContextTitle.includes(normalizedTitle)) {
      score += 55;
    } else {
      const titleTokens = new Set(normalizedTitle.split(" ").filter((token) => token.length > 2));
      const contextTokens = normalizedContextTitle.split(" ").filter((token) => token.length > 2);
      const overlap = contextTokens.filter((token) => titleTokens.has(token)).length;
      score += Math.min(40, overlap * 6);
    }
  }

  const receivedAt = Date.parse(context.receivedAt ?? context.metadata?.capturedAt ?? "") || 0;
  if (receivedAt) score += Math.max(0, 20 - Math.floor((Date.now() - receivedAt) / 60_000));
  return score;
}

function listRecentBrowserContexts(recentBrowserContexts, query = {}) {
  const limit = Math.max(1, Math.min(10, Number(query.limit ?? 3) || 3));
  return recentBrowserContexts
    .map((context) => ({ context, score: scoreBrowserContext(context, query) }))
    .filter((item) => !query.url && !query.title ? true : item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({ ...item.context, score: item.score }));
}

export async function tryHandleBrowserContextRoute({ request, response, method, url, runtime, recentBrowserContexts }) {
  // /location — browser extension pushes fresh fixes here after the user grants
  // the Chrome geolocation prompt. GET returns the current cached fix; DELETE
  // wipes it. The task submission path can also refresh the same cache.
  if (method === "GET" && url.pathname === "/location") {
    sendJson(response, 200, { ok: true, location: getUserLocation() });
    return true;
  }

  if (method === "POST" && url.pathname === "/location") {
    const body = await readJsonBody(request);
    const stored = setUserLocation(body?.location ?? body);
    if (!stored) {
      sendJson(response, 400, { ok: false, error: "invalid_location" });
      return true;
    }
    persistUserLocation(runtime, stored);
    sendJson(response, 200, { ok: true, location: stored });
    return true;
  }

  if (method === "DELETE" && url.pathname === "/location") {
    clearUserLocation();
    persistUserLocation(runtime, null);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (method === "POST" && url.pathname === "/location/windows") {
    const result = await refreshWindowsLocation();
    if (result.ok) persistUserLocation(runtime, result.location);
    const status = result.ok ? 200 : 400;
    sendJson(response, status, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/overlay/handoff") {
    const body = await readJsonBody(request);
    const result = await writeOverlayHandoff(body);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/page/explain") {
    const body = await readJsonBody(request);
    const result = await handlePageExplain(body);
    sendJson(response, 200, result);
    return true;
  }

  if (method === "POST" && url.pathname === "/browser/context") {
    const body = await readJsonBody(request);
    const context = normalizeBrowserContextPayload(body);
    const saved = rememberBrowserContext(recentBrowserContexts, context);
    sendJson(response, 200, { ok: true, context: saved });
    return true;
  }

  if (method === "GET" && url.pathname === "/browser/context/recent") {
    const contexts = listRecentBrowserContexts(recentBrowserContexts, {
      url: url.searchParams.get("url") ?? "",
      title: url.searchParams.get("title") ?? "",
      limit: url.searchParams.get("limit") ?? "3"
    });
    sendJson(response, 200, { ok: true, contexts });
    return true;
  }

  return false;
}
