// ───────────────────────────────────────────────────────────────────────────
// Inline result frame — Apple-style floating card that displays UCA results
// directly on the page so the user never has to switch to the desktop overlay
// for translate / summarize / explain actions.
// ───────────────────────────────────────────────────────────────────────────

const ACTION_LABELS = {
  translate: "翻译",
  summarize: "总结",
  explain: "解释"
};

// UCA-057: Module-level request tracker for selection snapshot model.
// Each inline action click generates a unique requestId. When the async
// response arrives, we check whether this requestId is still the "current"
// one. If the user clicked on a different segment in the meantime, the
// old callback is silently discarded — preventing stale results from
// appearing in the newly-opened frame.
let _pendingActionRequestId = null;

function showInlineResultFrame({ action, rect, previewText = "", doc = document }) {
  const host = doc.createElement("div");
  host.setAttribute("data-uca-result-frame", "true");
  const root = host.attachShadow({ mode: "open" });

  const previewSnippet = (previewText ?? "").trim().slice(0, 80);

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .frame {
        position: fixed;
        z-index: 2147483647;
        max-width: 420px;
        min-width: 280px;
        padding: 14px 16px;
        border-radius: 18px;
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
        max-height: 280px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
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
  positionFrameNear(frame, rect);

  const bodyEl = root.querySelector(".body");
  const actionsEl = root.querySelector(".actions");
  const copyBtn = root.querySelector('[data-action="copy"]');
  const openOverlayBtn = root.querySelector('[data-action="open-overlay"]');
  const closeBtn = root.querySelector(".close");

  let resultText = "";

  const api = {
    setResult(text) {
      resultText = text ?? "";
      bodyEl.classList.remove("loading");
      bodyEl.classList.remove("error");
      bodyEl.textContent = resultText || "(无内容)";
      actionsEl.classList.add("visible");
    },
    setError(message) {
      bodyEl.classList.remove("loading");
      bodyEl.classList.add("error");
      bodyEl.textContent = `处理失败：${message}`;
      actionsEl.classList.add("visible");
    },
    close() {
      host.remove();
    }
  };

  closeBtn.addEventListener("click", () => api.close());

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
    const selectionState = {
      text: previewText,
      url: window.location.href,
      pageTitle: doc.title,
      sourceType: "text_selection"
    };
    if (resultText) {
      // Carry the already-generated result into the desktop overlay so the
      // user can ask follow-up questions without re-running the task.
      sendRuntimeMessageSafely({
        type: "uca.overlay.openWithResult",
        action,
        selectionState,
        priorResult: resultText
      });
    } else {
      // Result not ready yet — fall back to plain capture handoff
      sendRuntimeMessageSafely({
        type: "uca.overlay.captureSelection",
        action,
        selectionState
      });
    }
    api.close();
  });

  // Auto-dismiss on Escape
  const onKey = (event) => {
    if (event.key === "Escape") {
      api.close();
      doc.removeEventListener("keydown", onKey);
    }
  };
  doc.addEventListener("keydown", onKey);

  // Auto-dismiss after 30 seconds of being idle
  setTimeout(() => {
    if (host.parentNode) api.close();
  }, 60_000);

  return api;
}

function positionFrameNear(frameEl, rect) {
  const padding = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  // hide off-screen first to measure
  frameEl.style.left = "-9999px";
  frameEl.style.top = "-9999px";
  frameEl.style.visibility = "hidden";
  requestAnimationFrame(() => {
    const frameRect = frameEl.getBoundingClientRect();
    let left = rect ? rect.left : viewportW - frameRect.width - padding;
    let top = rect ? rect.bottom + 8 : padding;
    if (left + frameRect.width > viewportW - padding) {
      left = viewportW - frameRect.width - padding;
    }
    if (left < padding) left = padding;
    if (top + frameRect.height > viewportH - padding) {
      top = (rect ? rect.top - frameRect.height - 8 : padding);
      if (top < padding) top = padding;
    }
    frameEl.style.left = `${Math.round(left)}px`;
    frameEl.style.top = `${Math.round(top)}px`;
    frameEl.style.visibility = "visible";
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

function sendRuntimeMessageSafely(message, callback) {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    callback?.({ ok: false, error: "chrome.runtime.sendMessage not available" });
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
        callback?.({
          ok: false,
          error: runtimeError.message ?? "Extension context invalidated. Refresh this page and try again."
        });
        return;
      }

      callback?.(response);
    });
    return true;
  } catch (error) {
    callback?.({
      ok: false,
      error: error.message ?? "Extension context invalidated. Refresh this page and try again."
    });
    return false;
  }
}

const BROWSER_CONTEXT_MAX_TEXT = 6000;
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
      const text = truncateText(node.innerText || node.textContent || "", 2500);
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
          doc
        });
        sendRuntimeMessageSafely({
          type: "uca.runtime.runQuickAction",
          action,
          selectionState,
          requestId: snapshot.requestId
        }, (response) => {
          // UCA-057: Discard response if a newer request has superseded this one.
          if (snapshot.requestId !== _pendingActionRequestId) {
            console.info("[UCA] discarding stale response for requestId", snapshot.requestId);
            return;
          }
          if (response?.ok) {
            frame.setResult(response.text ?? "(无内容)");
          } else {
            const message = response?.error ?? "unknown error";
            console.warn("[UCA] runQuickAction sendMessage failed:", message);
            frame.setError(`${message}\n\n请刷新此页面；如果刚重新加载过扩展，也请刷新页面后再试。`);
          }
        });
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

  return {
    text,
    contextBefore,
    contextAfter,
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

  function showHoverChip(el) {
    removeActiveChip();

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const tagName = el.tagName.toUpperCase();
    const hasBgUrl = Boolean(el.__ucaBgUrl);
    const isImage = tagName === "IMG" || hasBgUrl;
    const isLink = tagName === "A" && !isImage;
    const href = el.href ?? el.src ?? el.srcset?.split(/\s/)?.[0] ?? el.dataset?.src ?? el.dataset?.lazySrc ?? el.__ucaBgUrl ?? "";
    if (!href || href.startsWith("javascript:") || href === "#") return;

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
    host.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;";
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
      sendRuntimeMessageSafely({
        type: "uca.overlay.captureSelection",
        action: action,
        selectionState: state
      });
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

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.__ucaSelectionApi = {
    captureSelectionState,
    installSelectionObserver,
    buildBrowserContextSnapshot
  };
  installSelectionObserver(document, window);
  installBrowserContextReporter(document, window);
  installHoverObserver(document);
}
