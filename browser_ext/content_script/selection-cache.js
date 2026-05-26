// ───────────────────────────────────────────────────────────────────────────
// Inline result frame — Apple-style floating card that displays UCA results
// directly on the page so the user never has to switch to the desktop overlay
// for translate / summarize / explain actions.
// ───────────────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  translate: "翻译",
  summarize: "总结",
  explain: "解释",
  "uca.fetch-link": "链接分析",
  "uca.inspect-image": "图片分析"
};

// UCA-057: Module-level request tracker for selection snapshot model.
// Each inline action click generates a unique requestId. When the async
// response arrives, we check whether this requestId is still the "current"
// one. If the user clicked on a different segment in the meantime, the
// old callback is silently discarded — preventing stale results from
// appearing in the newly-opened frame.
let _pendingActionRequestId = null;

function showInlineResultFrame({ action, rect, previewText = "", selectionState = {}, doc = document }) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-result-frame", "true");
  const root = host.attachShadow({ mode: "open" });
  const isLargeDialog = action === "uca.fetch-link" || action === "uca.inspect-image";

  const previewSnippet = (previewText ?? "").trim().slice(0, 80);

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .backdrop {
        position: fixed;
        inset: 0;
        background: ${isLargeDialog ? "rgba(15, 23, 42, 0.22)" : "transparent"};
        z-index: 2147483646;
        pointer-events: ${isLargeDialog ? "auto" : "none"};
      }
      .frame {
        position: fixed;
        z-index: 2147483647;
        max-width: ${isLargeDialog ? "min(820px, calc(100vw - 32px))" : "420px"};
        width: ${isLargeDialog ? "min(820px, calc(100vw - 32px))" : "auto"};
        min-width: ${isLargeDialog ? "min(620px, calc(100vw - 32px))" : "280px"};
        padding: 14px 16px;
        border-radius: ${isLargeDialog ? "12px" : "18px"};
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(28px) saturate(180%);
        -webkit-backdrop-filter: blur(28px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.6);
        box-shadow:
          0 22px 56px rgba(0, 0, 0, 0.18),
          0 4px 14px rgba(0, 0, 0, 0.05),
          inset 0 1px 0 rgba(255, 255, 255, 0.95);
        font-family: -apple-system, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", system-ui, sans-serif;
        font-size: 13px;
        color: #1c1c1e;
        animation: frame-in 280ms cubic-bezier(0.22, 1, 0.36, 1);
        pointer-events: auto;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .badge {
        font-size: 11px;
        padding: 2px 9px;
        border-radius: 999px;
        background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.18));
        color: #4338ca;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .source {
        font-size: 11px;
        color: rgba(28,28,30,0.55);
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .close {
        all: initial;
        cursor: pointer;
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: rgba(0,0,0,0.06);
        color: rgba(28,28,30,0.6);
        font-size: 12px;
        font-family: -apple-system, sans-serif;
        line-height: 1;
      }
      .close:hover { background: rgba(0,0,0,0.12); }
      .body {
        font-size: 13px;
        line-height: 1.6;
        max-height: ${isLargeDialog ? "min(70vh, 720px)" : "280px"};
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: keep-all;
        overflow-wrap: anywhere;
      }
      .body.loading {
        color: rgba(28,28,30,0.55);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .body.error {
        color: #b91c1c;
      }
      .body.streaming::after {
        content: "▋";
        display: inline-block;
        margin-left: 2px;
        color: #6366f1;
        animation: uca-blink 900ms steps(2, start) infinite;
      }
      @keyframes uca-blink { to { visibility: hidden; } }
      .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(99,102,241,0.25);
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
      }
      .actions {
        display: flex;
        gap: 6px;
        margin-top: 12px;
        opacity: 0;
        max-height: 0;
        overflow: hidden;
        transition: opacity 200ms ease, max-height 200ms ease;
      }
      .actions.visible {
        opacity: 1;
        max-height: 60px;
      }
      .actions button {
        all: initial;
        cursor: pointer;
        font-size: 11px;
        padding: 5px 12px;
        border-radius: 999px;
        background: rgba(99,102,241,0.1);
        color: #4338ca;
        font-family: inherit;
        font-weight: 500;
      }
      .actions button:hover { background: rgba(99,102,241,0.18); }
      .actions button.primary {
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: #fff;
      }
      @keyframes frame-in {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes spin {
        from { transform: rotate(0); }
        to   { transform: rotate(360deg); }
      }
    </style>
    <div class="backdrop"></div>
    <div class="frame">
      <div class="header">
        <span class="badge">LingxY · ${ACTION_LABELS[action] ?? action}</span>
        <span class="source">${escapeHtmlForChip(previewSnippet)}${previewSnippet.length === 80 ? "..." : ""}</span>
        <button class="close" type="button" title="关闭">&times;</button>
      </div>
      <div class="body loading"><span class="spinner"></span><span>正在处理...</span></div>
      <div class="actions">
        <button class="primary" data-action="copy" type="button">复制</button>
        <button data-action="open-overlay" type="button">在对话框打开</button>
      </div>
    </div>
  `;

  doc.documentElement.appendChild(host);

  // Position near the selection rect (fall back to top-right of the viewport)
  const frame = root.querySelector(".frame");
  if (isLargeDialog) {
    positionLargeDialog(frame);
  } else {
    positionFrameNear(frame, rect);
  }

  const bodyEl = root.querySelector(".body");
  const actionsEl = root.querySelector(".actions");
  const copyBtn = root.querySelector('[data-action="copy"]');
  const openOverlayBtn = root.querySelector('[data-action="open-overlay"]');
  const closeBtn = root.querySelector(".close");
  const backdropEl = root.querySelector(".backdrop");

  let resultText = "";
  let dismissTimer = null;

  function clearDismissTimer() {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
  }

  function scheduleDismiss(ms = 180_000) {
    clearDismissTimer();
    dismissTimer = setTimeout(() => {
      if (host.parentNode) api.close();
    }, ms);
  }

  const api = {
    setResult(text) {
      resultText = text ?? "";
      bodyEl.classList.remove("loading");
      bodyEl.classList.remove("error");
      bodyEl.classList.remove("streaming");
      bodyEl.textContent = resultText || "(无内容)";
      actionsEl.classList.add("visible");
      scheduleDismiss();
    },
    // Progressive update while streaming — keeps the loading class so the
    // spinner stays visible; once setResult fires the frame finalises.
    setStreaming(text) {
      resultText = text ?? "";
      bodyEl.classList.remove("error");
      bodyEl.classList.remove("loading");
      bodyEl.classList.add("streaming");
      bodyEl.textContent = resultText;
    },
    setError(message) {
      bodyEl.classList.remove("loading");
      bodyEl.classList.remove("streaming");
      bodyEl.classList.add("error");
      bodyEl.textContent = `处理失败：${message}`;
      actionsEl.classList.add("visible");
      scheduleDismiss();
    },
    close() {
      clearDismissTimer();
      try { host.__ucaDetachScroll?.(); } catch { /* ignore */ }
      host.remove();
    }
  };

  closeBtn.addEventListener("click", () => api.close());
  backdropEl?.addEventListener("click", () => api.close());

  copyBtn.addEventListener("click", async () => {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      copyBtn.textContent = "已复制";
      setTimeout(() => { copyBtn.textContent = "复制"; }, 1200);
    } catch {
      copyBtn.textContent = "复制失败";
    }
  });

  openOverlayBtn.addEventListener("click", () => {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
    const handoffSelectionState = {
      ...selectionState,
      text: selectionState?.text ?? previewText,
      selectionText: selectionState?.selectionText ?? selectionState?.text ?? previewText,
      url: selectionState?.url ?? window.location.href,
      pageTitle: selectionState?.pageTitle ?? doc.title,
      sourceType: selectionState?.sourceType ?? "text_selection"
    };
    sendRuntimeMessageSafely({
      type: "uca.result.openFollowup",
      action,
      selectionState: handoffSelectionState,
      displayLabel: `💬 ${ACTION_LABELS[action] ?? "结果"}：${previewText.slice(0, 80)}`,
      attached: previewText,
      priorResult: resultText || ""
    }, (response) => {
      if (response?.ok) {
        api.close();
        return;
      }
      api.setError(`无法打开对话框：${response?.error ?? response?.reason ?? "unknown"}`);
    });
  });

  // Auto-dismiss only after a completed result / error, not while loading.
  closeBtn.addEventListener("mouseenter", clearDismissTimer);
  closeBtn.addEventListener("mouseleave", () => {
    if (!bodyEl.classList.contains("loading") && !bodyEl.classList.contains("streaming")) {
      scheduleDismiss();
    }
  });

  bodyEl.addEventListener("mouseenter", clearDismissTimer);
  bodyEl.addEventListener("mouseleave", () => {
    if (!bodyEl.classList.contains("loading") && !bodyEl.classList.contains("streaming")) {
      scheduleDismiss();
    }
  });

  actionsEl.addEventListener("mouseenter", clearDismissTimer);
  actionsEl.addEventListener("mouseleave", () => {
    if (!bodyEl.classList.contains("loading") && !bodyEl.classList.contains("streaming")) {
      scheduleDismiss();
    }
  });

  // Auto-dismiss on Escape
  const onKey = (event) => {
    if (event.key === "Escape") {
      api.close();
      doc.removeEventListener("keydown", onKey);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target === openOverlayBtn) {
      event.preventDefault();
    }
  };
  doc.addEventListener("keydown", onKey);

  return api;
}

function openInlineQuickActionFrame(action, selectionState = {}) {
  return handleShowActionFrame({ action, selectionState }, () => {});
}

function positionLargeDialog(frameEl) {
  frameEl.style.left = "50%";
  frameEl.style.top = "50%";
  frameEl.style.transform = "translate(-50%, -50%)";
}

// Position the frame near a selection rect and keep it anchored to the
// document (scrolls with the page) even though the .frame uses
// position:fixed. Pure CSS position:absolute didn't work reliably on
// pages with exotic layout / transform ancestors (and shadow-DOM
// interactions made it worse), so we keep fixed and re-apply the delta
// on every scroll tick — tiny cost, robust everywhere.
function positionFrameNear(frameEl, rect) {
  const padding = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const scrollXAt = window.scrollX || window.pageXOffset || 0;
  const scrollYAt = window.scrollY || window.pageYOffset || 0;
  frameEl.style.left = "-9999px";
  frameEl.style.top = "-9999px";
  frameEl.style.visibility = "hidden";
  requestAnimationFrame(() => {
    const frameRect = frameEl.getBoundingClientRect();
    let leftVp = rect ? rect.left : viewportW - frameRect.width - padding;
    let topVp = rect ? rect.bottom + 8 : padding;
    if (leftVp + frameRect.width > viewportW - padding) {
      leftVp = viewportW - frameRect.width - padding;
    }
    if (leftVp < padding) leftVp = padding;
    if (topVp + frameRect.height > viewportH - padding) {
      topVp = (rect ? rect.top - frameRect.height - 8 : padding);
      if (topVp < padding) topVp = padding;
    }

    // Anchor in page coords (viewport + current scroll at positioning time).
    const anchorPageLeft = leftVp + scrollXAt;
    const anchorPageTop = topVp + scrollYAt;

    const applyFixedFromAnchor = () => {
      const curScrollX = window.scrollX || window.pageXOffset || 0;
      const curScrollY = window.scrollY || window.pageYOffset || 0;
      frameEl.style.left = `${Math.round(anchorPageLeft - curScrollX)}px`;
      frameEl.style.top = `${Math.round(anchorPageTop - curScrollY)}px`;
    };
    applyFixedFromAnchor();
    frameEl.style.visibility = "visible";

    // Follow scroll. Uses passive listener + rAF coalescing so it doesn't
    // slow the page's own scroll.
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        applyFixedFromAnchor();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Stash the cleanup on the host so whoever closes the frame can detach.
    const host = frameEl.getRootNode().host;
    if (host) {
      host.__ucaDetachScroll = () => {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      };
    }
  });
}

function escapeHtmlForChip(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isContextInvalidatedError(error) {
  const msg = `${error?.message ?? error ?? ""}`;
  return /Extension context invalidated|Receiving end does not exist|message port closed/i.test(msg);
}

function sendRuntimeMessageSafely(message, callback) {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    callback?.({ ok: false, error: "chrome.runtime.sendMessage not available", errorKind: "no_runtime" });
    return false;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      let runtimeError = null;
      try {
        runtimeError = chrome.runtime?.lastError ?? null;
      } catch (error) {
        runtimeError = error;
      }

      if (runtimeError) {
        const invalidated = isContextInvalidatedError(runtimeError);
        callback?.({
          ok: false,
          error: invalidated
            ? "扩展刚更新过，请刷新此页面"
            : (runtimeError.message ?? "runtime_error"),
          errorKind: invalidated ? "context_invalidated" : "runtime_error"
        });
        return;
      }

      callback?.(response);
    });
    return true;
  } catch (error) {
    const invalidated = isContextInvalidatedError(error);
    callback?.({
      ok: false,
      error: invalidated ? "扩展刚更新过，请刷新此页面" : (error.message ?? "runtime_error"),
      errorKind: invalidated ? "context_invalidated" : "runtime_error"
    });
    return false;
  }
}

// Map technical service-worker error codes to something a user can act on.
function humanizeQuickActionError(rawError = "") {
  const msg = `${rawError ?? ""}`;
  if (/^empty_selection$/i.test(msg)) return "请先选中要处理的文本，然后再点此按钮。";
  if (/^no_api_key$/i.test(msg)) return "还没配置 LLM API Key。右键扩展图标 → 选项 → 填一个 provider 的 key。";
  if (/^(unknown_provider|vision_unsupported_provider)/i.test(msg)) return "当前 provider 不支持这个操作，换一个 provider 再试。";
  if (/^network_error/i.test(msg)) return `网络错误，请检查代理 / 网络连接。\n（${msg}）`;
  if (/^empty_response$/i.test(msg)) return "模型返回了空结果。通常是当前 provider 的流式响应不稳定，重试一次或换个模型就会恢复。";
  if (/^(http|anthropic|openai|gemini|deepseek)_(4\d\d|5\d\d)/i.test(msg)) {
    return `LLM 接口返回错误：\n${msg.slice(0, 600)}\n请检查 API Key、model 名称、剩余额度。`;
  }
  if (/^stream_ended_without_terminal$/i.test(msg)) return "流式响应中断，请重试。";
  if (/^desktop_/i.test(msg)) return `桌面程序响应异常：${msg}。请确认桌面程序已启动，或在扩展设置改为 standalone 模式。`;
  if (/^timeout$/i.test(msg)) return "超时（30s 内未收到结果）。若使用 thinking 模式或大模型，请在扩展设置换更快的 model。";
  if (/扩展刚更新过/.test(msg)) return msg;
  return msg || "unknown error";
}

const BROWSER_CONTEXT_MAX_TEXT = 24000;
const BROWSER_CONTEXT_MAX_DESCRIPTION = 2000;
const BROWSER_CONTEXT_MAX_CAPTIONS = 1800;
const BROWSER_CONTEXT_REPORT_INTERVAL_MS = 10_000;

let browserContextTimer = null;
let browserContextLastKey = "";
let browserContextLastSentAt = 0;

function compactText(value = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", maxLength = 1000) {
  const text = compactText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function readMetaContent(doc, selector) {
  return doc.querySelector(selector)?.getAttribute("content")?.trim() ?? "";
}

function readLinkHref(doc, selector) {
  return doc.querySelector(selector)?.getAttribute("href")?.trim() ?? "";
}

function getFirstText(doc, selectors = []) {
  for (const selector of selectors) {
    const text = compactText(doc.querySelector(selector)?.textContent ?? "");
    if (text) return text;
  }
  return "";
}

function getJoinedText(doc, selectors = [], maxLength = 1000) {
  const seen = new Set();
  const chunks = [];
  for (const selector of selectors) {
    for (const node of doc.querySelectorAll(selector)) {
      const text = truncateText(node?.textContent ?? "", maxLength);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      chunks.push(text);
      if (chunks.join(" ").length >= maxLength) break;
    }
    if (chunks.join(" ").length >= maxLength) break;
  }
  return truncateText(chunks.join("\n"), maxLength);
}

function collectVisiblePageText(doc = document) {
  const preferredSelectors = [
    "article",
    "main",
    "[role='main']",
    "ytd-watch-metadata",
    "#description",
    "#contents"
  ];
  const chunks = [];
  const seen = new Set();
  for (const selector of preferredSelectors) {
    for (const node of doc.querySelectorAll(selector)) {
      const rect = typeof node.getBoundingClientRect === "function" ? node.getBoundingClientRect() : null;
      if (rect && rect.width === 0 && rect.height === 0) continue;
      const text = truncateText(node.innerText || node.textContent || "", 6000);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      chunks.push(text);
      if (chunks.join("\n").length >= BROWSER_CONTEXT_MAX_TEXT) break;
    }
    if (chunks.join("\n").length >= BROWSER_CONTEXT_MAX_TEXT) break;
  }

  if (!chunks.length) {
    chunks.push(truncateText(doc.body?.innerText ?? "", BROWSER_CONTEXT_MAX_TEXT));
  }

  return truncateText(chunks.filter(Boolean).join("\n\n"), BROWSER_CONTEXT_MAX_TEXT);
}

function collectYouTubeContext(doc = document, win = window) {
  const href = win.location?.href ?? "";
  let parsedUrl = null;
  try { parsedUrl = new URL(href); } catch { /* ignore */ }
  const hostname = parsedUrl?.hostname?.replace(/^www\./, "") ?? "";
  const isYouTube = hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtu.be";
  if (!isYouTube) return null;

  const title = getFirstText(doc, [
    "h1.ytd-watch-metadata",
    "ytd-watch-metadata h1",
    "h1.title",
    "h1"
  ]) || readMetaContent(doc, "meta[property='og:title']") || doc.title || "";

  const channel = getFirstText(doc, [
    "#owner #channel-name a",
    "ytd-video-owner-renderer ytd-channel-name a",
    "ytd-channel-name a"
  ]);

  const description = getFirstText(doc, [
    "#description-inline-expander",
    "ytd-watch-metadata #description",
    "#description",
    "ytd-text-inline-expander"
  ]) || readMetaContent(doc, "meta[name='description']");

  const visibleCaptions = getJoinedText(doc, [
    ".ytp-caption-segment",
    "ytd-transcript-segment-renderer",
    "yt-formatted-string.segment-text"
  ], BROWSER_CONTEXT_MAX_CAPTIONS);

  return {
    platform: "youtube",
    videoId: parsedUrl?.searchParams?.get("v") || (hostname === "youtu.be" ? parsedUrl?.pathname?.replace(/^\//, "") : "") || "",
    canonicalUrl: readLinkHref(doc, "link[rel='canonical']") || href,
    title: truncateText(title, 500),
    channel: truncateText(channel, 300),
    description: truncateText(description, BROWSER_CONTEXT_MAX_DESCRIPTION),
    visibleCaptions
  };
}

function buildBrowserContextSnapshot(doc = document, win = window) {
  const youtube = collectYouTubeContext(doc, win);
  const pageTitle = youtube?.title || doc.title || readMetaContent(doc, "meta[property='og:title']");
  const url = youtube?.canonicalUrl || win.location?.href || "";
  const text = collectVisiblePageText(doc);
  const rawText = compactText(doc.body?.innerText ?? "");
  return {
    sourceType: "web_page",
    browser: "chrome.exe",
    url,
    pageTitle: truncateText(pageTitle, 500),
    text,
    metadata: {
      capturedAt: new Date().toISOString(),
      platform: youtube?.platform ?? null,
      youtube: youtube ?? null,
      contentScope: "document_text_snapshot",
      textLength: rawText.length,
      textTruncated: rawText.length > BROWSER_CONTEXT_MAX_TEXT,
      description: truncateText(
        youtube?.description || readMetaContent(doc, "meta[name='description']"),
        BROWSER_CONTEXT_MAX_DESCRIPTION
      )
    }
  };
}

function publishBrowserContextSnapshot({ force = false } = {}) {
  if (docHidden(document) && !force) return;
  const snapshot = buildBrowserContextSnapshot(document, window);
  if (!snapshot.url && !snapshot.pageTitle) return;

  const textFingerprint = `${snapshot.text ?? ""}`.slice(0, 300);
  const captionFingerprint = `${snapshot.metadata?.youtube?.visibleCaptions ?? ""}`.slice(-300);
  const key = [
    snapshot.url,
    snapshot.pageTitle,
    textFingerprint,
    captionFingerprint
  ].join("|");

  const now = Date.now();
  if (!force && key === browserContextLastKey && now - browserContextLastSentAt < BROWSER_CONTEXT_REPORT_INTERVAL_MS) {
    return;
  }

  browserContextLastKey = key;
  browserContextLastSentAt = now;
  sendRuntimeMessageSafely({
    type: "uca.browser.contextSnapshot",
    context: snapshot
  });
}

function scheduleBrowserContextSnapshot(delayMs = 600, options = {}) {
  if (browserContextTimer) clearTimeout(browserContextTimer);
  browserContextTimer = setTimeout(() => {
    browserContextTimer = null;
    publishBrowserContextSnapshot(options);
  }, delayMs);
}

function docHidden(doc = document) {
  return doc.visibilityState && doc.visibilityState !== "visible";
}

function installBrowserContextReporter(doc = document, win = window) {
  scheduleBrowserContextSnapshot(900, { force: true });
  win.addEventListener("load", () => scheduleBrowserContextSnapshot(500, { force: true }), { passive: true });
  win.addEventListener("popstate", () => scheduleBrowserContextSnapshot(700, { force: true }), { passive: true });
  win.addEventListener("hashchange", () => scheduleBrowserContextSnapshot(700, { force: true }), { passive: true });
  win.addEventListener("yt-navigate-finish", () => scheduleBrowserContextSnapshot(900, { force: true }), { passive: true });
  doc.addEventListener("visibilitychange", () => {
    if (!docHidden(doc)) scheduleBrowserContextSnapshot(400, { force: true });
  });
  setInterval(() => scheduleBrowserContextSnapshot(500), BROWSER_CONTEXT_REPORT_INTERVAL_MS);
}

function createFloatingChipController(doc = document) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-floating-chip", "true");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host {
        all: initial;
      }
      .chip-shell {
        display: grid;
        gap: 8px;
        pointer-events: auto;
      }
      .chip-button {
        all: initial;
        box-sizing: border-box;
        min-width: 164px;
        padding: 10px 14px;
        border-radius: 999px;
        background:
          linear-gradient(135deg, rgba(184, 92, 42, 0.98), rgba(154, 74, 31, 0.98));
        color: #ffffff;
        font-family: "Inter", "Segoe UI Variable Text", "Segoe UI", sans-serif;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        cursor: pointer;
        box-shadow: 0 12px 26px rgba(10, 10, 10, 0.22);
      }
      .chip-button:hover {
        transform: translateY(-1px);
      }
      .chip-button:focus {
        outline: none;
      }
      .chip-preview {
        display: none;
        min-width: 220px;
        padding: 10px;
        border-radius: 10px;
        background: #ffffff;
        border: 1px solid #e2e2e2;
        box-shadow: 0 18px 38px rgba(10, 10, 10, 0.14);
        color: #0a0a0a;
        font-family: "Inter", "Segoe UI Variable Text", "Segoe UI", sans-serif;
      }
      .chip-preview[data-open="true"] {
        display: grid;
        gap: 8px;
      }
      .chip-actions {
        display: grid;
        gap: 6px;
      }
      .chip-action {
        all: initial;
        padding: 8px 10px;
        border-radius: 8px;
        background: #f7f7f7;
        color: #0a0a0a;
        cursor: pointer;
        font-family: "Inter", "Segoe UI Variable Text", "Segoe UI", sans-serif;
        font-size: 12px;
      }
      .chip-action:hover { background: #f5e5d8; }
      .chip-hint {
        font-size: 11px;
        color: #595959;
      }
    </style>
    <div class="chip-shell">
      <button class="chip-button" type="button" tabindex="-1">用 LingxY 总结</button>
      <div class="chip-preview" data-open="false">
        <div class="chip-actions">
          <button class="chip-action" type="button" data-action="summarize">总结</button>
          <button class="chip-action" type="button" data-action="translate">翻译</button>
          <button class="chip-action" type="button" data-action="explain">解释</button>
        </div>
        <div class="chip-hint">Esc 隐藏本轮，滚出视口自动收起</div>
      </div>
    </div>
  `;

  const button = root.querySelector(".chip-button");
  const preview = root.querySelector(".chip-preview");
  const actionButtons = [...root.querySelectorAll(".chip-action")];

  host.style.position = "fixed";
  host.style.display = "none";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  host.style.width = "max-content";
  host.style.height = "max-content";
  host.style.maxWidth = "calc(100vw - 24px)";
  host.style.overflow = "visible";
  host.style.contain = "layout style paint";
  doc.documentElement.appendChild(host);

  let previewOpen = false;
  let previewTimer = null;
  let currentSelectionKey = null;

  function clearPreviewTimer() {
    if (previewTimer) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function setPreviewOpen(nextOpen) {
    previewOpen = nextOpen;
    preview.dataset.open = nextOpen ? "true" : "false";
  }

  button.addEventListener("mouseenter", () => {
    const delay = Number(host.dataset.previewDelayMs ?? "300");
    clearPreviewTimer();
    previewTimer = setTimeout(() => setPreviewOpen(true), delay);
  });
  button.addEventListener("mouseleave", () => {
    clearPreviewTimer();
    if (!host.matches(":hover")) {
      setPreviewOpen(false);
    }
  });
  preview.addEventListener("mouseleave", () => {
    if (!host.matches(":hover")) {
      setPreviewOpen(false);
    }
  });
  preview.addEventListener("mouseenter", () => {
    clearPreviewTimer();
    setPreviewOpen(true);
  });

  for (const actionButton of actionButtons) {
    actionButton.addEventListener("click", () => {
      const state = captureSelectionState(doc);
      const action = actionButton.dataset.action;
      window.__ucaOverlayLastAction = {
        action,
        selectionKey: state.selectionKey ?? currentSelectionKey,
        ts: Date.now()
      };

      const selectionState = {
        ...state,
        sourceType: "text_selection",
        url: window.location.href,
        pageTitle: doc.title,
        tabId: null
      };

      // Inline-result actions: show a floating frame on the page,
      // run the task via the service-worker, and fill in the result.
      // The user never has to leave the webpage.
      if (action === "translate" || action === "summarize" || action === "explain") {
        // Diagnostic: confirms the in-page result frame path is the one running.
        // If you don't see this in DevTools after clicking the chip, the extension
        // wasn't reloaded after the source update — go to chrome://extensions and
        // click Reload, then refresh the page.
        console.info("[UCA] inline result frame path", action);

        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
          console.warn("[UCA] chrome.runtime.sendMessage not available; aborting");
          return;
        }

        // UCA-057: Immutable snapshot — capture text + rect at click time, not
        // at response time. Assign a unique requestId so that if the user clicks
        // on a different text segment before this response arrives, the stale
        // callback recognises the mismatch and discards itself.
        const requestId = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
        _pendingActionRequestId = requestId;

        const snapshot = {
          text: state.text,
          rect: state.rect,
          url: window.location.href,
          requestId
        };

        const frame = showInlineResultFrame({
          action,
          rect: snapshot.rect,
          previewText: snapshot.text,
          selectionState,
          doc
        });

        // UCA-167: open a streaming port so the inline frame fills in as the
        // LLM generates. Falls back to the legacy one-shot sendMessage if
        // ports are unavailable (very old Chrome, service worker gone).
        let streamingSettled = false;
        let streamingActive = false;
        const runLegacyFallback = () => {
          if (streamingSettled) return;
          streamingSettled = true;
          sendRuntimeMessageSafely({
            type: "uca.runtime.runQuickAction",
            action,
            selectionState,
            routePlan: selectionState?.routePlan ?? null,
            requestId: snapshot.requestId
          }, (response) => {
            if (snapshot.requestId !== _pendingActionRequestId) return;
            if (response?.ok) {
              frame.setResult(response.text ?? "(无内容)");
            } else {
              const human = humanizeQuickActionError(response?.error ?? "unknown error");
              if (response?.errorKind !== "context_invalidated") {
                console.warn("[UCA] runQuickAction fallback failed:", response?.error);
              }
              frame.setError(human);
            }
          });
        };
        try {
          const port = chrome.runtime.connect({ name: "uca.quickaction.stream" });
          streamingActive = true;
          port.onMessage.addListener((msg) => {
            if (snapshot.requestId !== _pendingActionRequestId) {
              try { port.disconnect(); } catch { /* ignore */ }
              return;
            }
            if (msg?.type === "start") {
              frame.setStreaming("");
            } else if (msg?.type === "chunk") {
              frame.setStreaming(msg.full ?? "");
            } else if (msg?.type === "done") {
              streamingSettled = true;
              frame.setResult(msg.text ?? "");
              try { port.disconnect(); } catch { /* ignore */ }
            } else if (msg?.type === "error") {
              streamingSettled = true;
              const human = humanizeQuickActionError(msg.error ?? "unknown");
              console.warn("[UCA] quick-action stream error:", msg.error);
              frame.setError(human);
              try { port.disconnect(); } catch { /* ignore */ }
            }
          });
          port.onDisconnect.addListener(() => {
            // If the port closed before we got a terminal message, fall back
            // to the legacy one-shot sendMessage path. Covers the case where
            // the service worker is running an older build that doesn't
            // register the streaming port handler (user hasn't reloaded the
            // extension yet), which otherwise leaves the frame stuck in
            // "loading" forever.
            if (!streamingSettled) {
              console.info("[UCA] stream port closed early, falling back to one-shot");
              runLegacyFallback();
            }
          });
          port.postMessage({
            type: "quickaction",
            action,
            selectionState,
            routePlan: selectionState?.routePlan ?? null
          });
        } catch {
          streamingActive = false;
          runLegacyFallback();
        }
        // No separate legacy path here — runLegacyFallback covers both
        // "port never opened" (catch) and "port opened but died before
        // settling" (onDisconnect).

        // Hide the chip — the inline frame replaces it
        host.style.display = "none";
        host.style.pointerEvents = "none";
        return;
      }

      // Fallback: fire-and-forget to the desktop overlay (legacy behavior)
      // for any other action ids that aren't translate/summarize/explain.
      console.info("[UCA] legacy overlay handoff path", action);
      sendRuntimeMessageSafely({
        type: "uca.overlay.captureSelection",
        action,
        selectionState
      });
    });
  }

  return {
    show({ position, label, selectionKey, previewDelayMs }) {
      currentSelectionKey = selectionKey;
      host.dataset.previewDelayMs = String(previewDelayMs ?? 300);
      button.textContent = label;
      host.style.left = `${position.left}px`;
      host.style.top = `${position.top}px`;
      host.style.display = "block";
      host.style.pointerEvents = "auto";
    },
    reposition(position) {
      host.style.left = `${position.left}px`;
      host.style.top = `${position.top}px`;
    },
    hide() {
      clearPreviewTimer();
      setPreviewOpen(false);
      currentSelectionKey = null;
      host.style.display = "none";
      host.style.pointerEvents = "none";
    },
    contains(node) {
      return host.contains(node) || root.contains(node);
    },
    isVisible() {
      return host.style.display !== "none";
    },
    getSelectionKey() {
      return currentSelectionKey;
    },
    isPreviewOpen() {
      return previewOpen;
    }
  };
}

function captureSelectionState(doc = document) {
  const selection = doc.getSelection();
  const text = selection?.toString().trim() ?? "";
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect?.();
  const overlay = globalThis.__ucaOverlay ?? {};
  const selectionKey = overlay.createSelectionKey?.({
    text,
    rect
  }) ?? text;

  // capture surrounding DOM text (not the selection itself)
  let contextBefore = "";
  let contextAfter = "";
  if (range) {
    try {
      const container = range.startContainer?.parentElement ?? range.commonAncestorContainer;
      if (container) {
        const fullText = container.textContent ?? "";
        const selStart = fullText.indexOf(text);
        if (selStart >= 0) {
          contextBefore = fullText.slice(Math.max(0, selStart - 100), selStart).trim();
          contextAfter = fullText.slice(selStart + text.length, selStart + text.length + 100).trim();
        }
      }
    } catch { /* DOM access failed */ }
  }

  const anchor = selectedAnchorForRange(range);
  const selectedAnchorUrl = normalizeSelectedAnchorUrl(anchor?.href ?? "");

  return {
    text,
    contextBefore,
    contextAfter,
    selectedAnchorUrl,
    anchorText: anchor ? (anchor.textContent ?? "").trim().slice(0, 200) : "",
    rect: rect
      ? {
          top: rect.top,
          left: rect.left,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }
      : null,
    selectionKey
  };
}

function elementForSelectionNode(node = null) {
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) return node;
  return node.parentElement ?? null;
}

function selectedAnchorForRange(range = null) {
  if (!range) return null;
  const candidates = [
    elementForSelectionNode(range.startContainer),
    elementForSelectionNode(range.endContainer),
    elementForSelectionNode(range.commonAncestorContainer)
  ].filter(Boolean);
  for (const candidate of candidates) {
    const direct = candidate.closest?.("a[href]");
    if (direct?.href) return direct;
  }
  const common = elementForSelectionNode(range.commonAncestorContainer);
  if (!common?.querySelectorAll) return null;
  const anchors = [...common.querySelectorAll("a[href]")];
  return anchors.find((anchor) => {
    try {
      return range.intersectsNode(anchor);
    } catch {
      return false;
    }
  }) ?? null;
}

function normalizeSelectedAnchorUrl(value = "") {
  try {
    const parsed = new URL(String(value ?? ""), window.location.href);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function getOverlaySettings() {
  const overlay = globalThis.__ucaOverlay ?? {};
  return overlay.mergeOverlaySettings?.(window.__ucaOverlaySettings ?? {}) ?? {
    enabled: true,
    displayMode: "smart",
    minLength: 5,
    longSelectionMinLength: 32,
    autoHideMs: 5000,
    previewDelayMs: 300,
    debounceMs: 150,
    stabilityMs: 200,
    blockedDomains: []
  };
}

function getOverlayEnvironment(doc = document) {
  return {
    presenterMode: Boolean(window.__ucaOverlaySecurityState?.presenterMode),
    hostname: window.location.hostname,
    activeElement: doc.activeElement
  };
}

function installSelectionObserver(doc = document, win = window) {
  const overlay = globalThis.__ucaOverlay ?? {};
  const chip = createFloatingChipController(doc);
  const dismissedSelections = new Set();
  let currentState = null;
  let selectionDebounce = null;
  let autoHideTimer = null;
  let rafPending = false;

  function clearAutoHide() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function hideChip() {
    clearAutoHide();
    chip.hide();
  }

  function maybeAutoHide() {
    clearAutoHide();
    const settings = getOverlaySettings();
    autoHideTimer = setTimeout(() => {
      if (!chip.isPreviewOpen()) {
        hideChip();
      }
    }, settings.autoHideMs);
  }

  function showChip(state) {
    const settings = getOverlaySettings();
    const position = overlay.computeFloatingChipPlacement?.(state.rect) ?? {
      left: state.rect.left,
      top: state.rect.bottom + 8
    };
    chip.show({
      position,
      label: settings.displayMode === "long_selection_only" ? "用 LingxY 深入处理" : "用 LingxY 总结",
      selectionKey: state.selectionKey,
      previewDelayMs: settings.previewDelayMs
    });
    maybeAutoHide();
  }

  function reevaluateCurrentSelection() {
    if (!currentState?.rect || !chip.isVisible()) {
      return;
    }

    const decision = overlay.shouldShowFloatingChip?.({
      state: currentState,
      settings: getOverlaySettings(),
      environment: getOverlayEnvironment(doc),
      dismissedKeys: dismissedSelections,
      isVisibleRect: (rect) => overlay.isRectVisible?.(rect) ?? true
    }) ?? { show: true };

    if (!decision.show) {
      hideChip();
      return;
    }

    if (!(overlay.isRectVisible?.(currentState.rect) ?? true)) {
      hideChip();
      return;
    }

    chip.reposition(overlay.computeFloatingChipPlacement(currentState.rect));
  }

  const watcher = (overlay.createStabilityWatcher?.({
    stabilityMs: getOverlaySettings().stabilityMs,
    onStable(state) {
      currentState = state;
      const decision = overlay.shouldShowFloatingChip?.({
        state,
        settings: getOverlaySettings(),
        environment: getOverlayEnvironment(doc),
        dismissedKeys: dismissedSelections,
        isVisibleRect: (rect) => overlay.isRectVisible?.(rect) ?? true
      }) ?? { show: true };

      window.__ucaSelectionState = state;
      window.__ucaOverlayLastDecision = decision;

      if (!decision.show) {
        hideChip();
        return;
      }

      showChip(state);
    },
    onReset() {
      hideChip();
    }
  })) ?? {
    observe() {},
    dismiss() {}
  };

  function scheduleReposition() {
    if (rafPending) {
      return;
    }
    rafPending = true;
    win.requestAnimationFrame(() => {
      rafPending = false;
      reevaluateCurrentSelection();
    });
  }

  function onSelectionChange() {
    if (selectionDebounce) {
      clearTimeout(selectionDebounce);
    }

    selectionDebounce = setTimeout(() => {
      const state = captureSelectionState(doc);
      window.__ucaSelectionState = state;
      if (!state.text || !state.rect) {
        watcher.dismiss();
        hideChip();
        return;
      }

      watcher.observe(state);
    }, getOverlaySettings().debounceMs);
  }

  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("pointerdown", (event) => {
    if (chip.isVisible() && !chip.contains(event.target)) {
      hideChip();
    }
  }, true);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && chip.isVisible()) {
      const key = chip.getSelectionKey();
      if (key) {
        dismissedSelections.add(key);
      }
      hideChip();
    }
  }, true);
  win.addEventListener("scroll", scheduleReposition, true);
  win.addEventListener("resize", scheduleReposition, true);
  win.visualViewport?.addEventListener("resize", scheduleReposition);
  win.visualViewport?.addEventListener("scroll", scheduleReposition);

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["ucaOverlaySettings", "ucaOverlaySecurityState"], (data) => {
      window.__ucaOverlaySettings = data.ucaOverlaySettings ?? {};
      window.__ucaOverlaySecurityState = data.ucaOverlaySecurityState ?? { presenterMode: false };
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local") {
        return;
      }
      if (changes.ucaOverlaySettings) {
        window.__ucaOverlaySettings = changes.ucaOverlaySettings.newValue ?? {};
      }
      if (changes.ucaOverlaySecurityState) {
        window.__ucaOverlaySecurityState = changes.ucaOverlaySecurityState.newValue ?? { presenterMode: false };
      }
      reevaluateCurrentSelection();
    });
  }
}

function installHoverObserver(doc) {
  let hoverTimer = null;
  let hoverTarget = null;
  let activeChipHost = null;
  let chipAutoHideTimer = null;
  const HOVER_DELAY = 500;

  function getHoverCandidate(element) {
    if (!element || element === doc.body || element === doc.documentElement) return null;

    // direct img match (including lazy-load variants)
    const img = element.closest("img");
    if (img && (img.src || img.srcset || img.dataset?.src || img.dataset?.lazySrc)) return img;

    // picture > source + img
    const picture = element.closest("picture");
    if (picture) {
      const innerImg = picture.querySelector("img");
      if (innerImg) return innerImg;
    }

    // link
    const link = element.closest("a[href]");
    if (link) return link;

    // div/span with background-image (common on news sites, cards)
    const bgEl = element.closest("[style*='background-image'], [style*='background:']");
    if (bgEl) {
      const bg = getComputedStyle(bgEl).backgroundImage;
      if (bg && bg !== "none" && bg.startsWith("url(")) {
        bgEl.__ucaBgUrl = bg.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
        return bgEl;
      }
    }

    return null;
  }

  function removeActiveChip() {
    if (activeChipHost && activeChipHost.parentNode) {
      activeChipHost.remove();
    }
    activeChipHost = null;
    clearTimeout(chipAutoHideTimer);
  }

  function isInspectableUrl(value) {
    try {
      const parsed = new URL(String(value ?? ""), doc.baseURI);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function showHoverChip(el) {
    removeActiveChip();

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const tagName = el.tagName.toUpperCase();
    const hasBgUrl = Boolean(el.__ucaBgUrl);
    const isImage = tagName === "IMG" || hasBgUrl;
    const isLink = tagName === "A" && !isImage;
    const href = el.href ?? el.src ?? el.srcset?.split(/\s/)?.[0] ?? el.dataset?.src ?? el.dataset?.lazySrc ?? el.__ucaBgUrl ?? "";
    if (!href || href === "#" || !isInspectableUrl(href)) return;

    const label = isImage ? "\u{1F50D} Analyze image" : "\u{1F517} Analyze link";
    const action = isImage ? "uca.inspect-image" : "uca.fetch-link";
    const sourceType = isImage ? "image" : "link";

    const state = {
      text: isLink ? (el.textContent || "").trim().slice(0, 200) : (el.alt || el.title || "").trim().slice(0, 200),
      url: isLink ? el.href : (doc.location?.href ?? ""),
      imageUrl: isImage ? (el.src || el.srcset?.split(/\s/)?.[0] || el.dataset?.src || el.__ucaBgUrl || "") : "",
      pageTitle: doc.title ?? "",
      anchorText: isLink ? (el.textContent || "").trim().slice(0, 200) : "",
      sourceType,
      rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    };

    window.__ucaSelectionState = state;

    // Use Shadow DOM for style isolation
    const host = doc.createElement("uca-hover-chip");
    host.style.cssText = [
      "all:initial",
      "position:fixed",
      "display:block",
      "width:max-content",
      "height:max-content",
      "max-width:calc(100vw - 24px)",
      "overflow:visible",
      "contain:layout style paint",
      "z-index:2147483647",
      "pointer-events:none"
    ].join(";");
    host.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 40)}px`;
    host.style.left = `${Math.min(rect.left, window.innerWidth - 160)}px`;

    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        :host { font-family: system-ui, -apple-system, sans-serif; }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 6px 14px;
          border-radius: 10px;
          background: rgba(255,255,255,0.94);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(0,0,0,0.08);
          box-shadow: 0 4px 16px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);
          font-size: 12px;
          font-weight: 600;
          color: #4f46e5;
          cursor: pointer;
          pointer-events: auto;
          white-space: nowrap;
          transition: transform 120ms ease, box-shadow 120ms ease;
          animation: fadeIn 160ms ease;
        }
        .chip:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.06);
          background: rgba(255,255,255,1);
        }
        @keyframes fadeIn {
          from { opacity:0; transform:translateY(4px); }
          to { opacity:1; transform:translateY(0); }
        }
      </style>
      <div class="chip">${label}</div>
    `;

    shadow.querySelector(".chip").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeActiveChip();
      openInlineQuickActionFrame(action, state);
    });

    doc.body.appendChild(host);
    activeChipHost = host;
    chipAutoHideTimer = setTimeout(removeActiveChip, 4000);
  }

  doc.addEventListener("pointerover", (e) => {
    const candidate = getHoverCandidate(e.target);
    if (!candidate) {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; hoverTarget = null; }
      return;
    }
    if (candidate === hoverTarget) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTarget = candidate;
    hoverTimer = setTimeout(() => {
      if (hoverTarget === candidate) showHoverChip(candidate);
      hoverTimer = null;
    }, HOVER_DELAY);
  });

  doc.addEventListener("pointerout", (e) => {
    const related = e.relatedTarget;
    // don't dismiss if moved to the chip itself
    if (activeChipHost && (activeChipHost === related || activeChipHost.contains(related))) return;

    const candidate = getHoverCandidate(e.target);
    if (candidate === hoverTarget) {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      hoverTarget = null;
      // delay removal slightly so user can click the chip
      setTimeout(() => {
        if (!hoverTarget) removeActiveChip();
      }, 600);
    }
  });

  // also remove on scroll
  window.addEventListener("scroll", removeActiveChip, { passive: true });
}

// UCA-173: when the service worker asks us to show a result frame for a
// right-click action (fetch-link, inspect-image, summarize-selection,
// translate-selection), render it inline on the page with the streaming
// port. The frame appears near the top-right of the viewport when there's
// no usable selection rect (right-click on link/image has no selection).
function handleShowActionFrame(message, sendResponse) {
  try {
    const { action, selectionState = {}, tabInfo = {}, routePlan = null } = message;

    // Prefer the live selection rect when we have actual selection text.
    let rect = null;
    try {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const r = range.getBoundingClientRect();
        if (r && (r.width || r.height)) rect = r;
      }
    } catch { /* ignore */ }

    const frame = showInlineResultFrame({
      action,
      rect,
      previewText: action === "uca.inspect-image"
        ? `图片：${selectionState.imageUrl?.slice(0, 80) ?? ""}`
        : action === "uca.fetch-link"
          ? `链接：${selectionState.url?.slice(0, 80) ?? ""}`
          : (selectionState.text ?? "").slice(0, 80),
      selectionState,
      doc: document
    });

    // Open a streaming port and pipe chunks to the frame.
    let streamingSettled = false;
    try {
      const port = chrome.runtime.connect({ name: "uca.quickaction.stream" });
      port.onMessage.addListener((msg) => {
        if (msg?.type === "start") {
          frame.setStreaming("");
        } else if (msg?.type === "chunk") {
          frame.setStreaming(msg.full ?? "");
        } else if (msg?.type === "done") {
          streamingSettled = true;
          frame.setResult(msg.text ?? "");
          try { port.disconnect(); } catch { /* ignore */ }
        } else if (msg?.type === "error") {
          streamingSettled = true;
          const human = humanizeQuickActionError(msg.error ?? "unknown");
          frame.setError(human);
          try { port.disconnect(); } catch { /* ignore */ }
        }
      });
      port.onDisconnect.addListener(() => {
        if (!streamingSettled) {
          frame.setError("连接意外断开，请重试");
        }
      });
      port.postMessage({ type: "quickaction", action, selectionState, routePlan });
    } catch (error) {
      frame.setError(`连接失败：${error?.message ?? error}`);
    }

    sendResponse?.({ ok: true });
  } catch (error) {
    console.warn("[UCA] showActionFrame failed:", error?.message ?? error);
    sendResponse?.({ ok: false, error: error?.message ?? String(error) });
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.__ucaSelectionApi = {
    captureSelectionState,
    installSelectionObserver,
    buildBrowserContextSnapshot
  };
  installSelectionObserver(document, window);
  installBrowserContextReporter(document, window);
  installHoverObserver(document);

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "uca.content.showActionFrame") {
        handleShowActionFrame(message, sendResponse);
        return true; // async response
      }
      return false;
    });
  }
}
