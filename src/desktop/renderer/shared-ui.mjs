// Small renderer-only helpers shared by overlay.js and console.js.
// Keep this file DOM-adapter level: no product state, no network calls.

export function createBottomPinController(scrollEl, { button = null, threshold = 24 } = {}) {
  if (!scrollEl) {
    return {
      maybeScrollToBottom() {},
      scrollToBottom() {},
      refresh() {},
      isPinned: () => true
    };
  }

  let pinned = true;
  const isNearBottom = () => (
    scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop <= threshold
  );
  const updateButton = () => {
    if (!button) return;
    button.hidden = pinned;
  };
  const refresh = () => {
    pinned = isNearBottom();
    updateButton();
  };
  const refreshSoon = () => {
    try { requestAnimationFrame(refresh); } catch { setTimeout(refresh, 0); }
  };

  scrollEl.addEventListener("scroll", refresh, { passive: true });
  scrollEl.addEventListener("wheel", refreshSoon, { passive: true });
  scrollEl.addEventListener("touchmove", refreshSoon, { passive: true });
  scrollEl.addEventListener("keyup", refreshSoon);

  const scrollToBottom = () => {
    scrollEl.scrollTop = scrollEl.scrollHeight;
    pinned = true;
    updateButton();
  };
  const maybeScrollToBottom = () => {
    if (!pinned) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  };

  try {
    new MutationObserver(maybeScrollToBottom).observe(scrollEl, {
      childList: true, subtree: true, characterData: true
    });
  } catch { /* observer is optional */ }
  try {
    new ResizeObserver(maybeScrollToBottom).observe(scrollEl);
  } catch { /* fallback: explicit calls still run */ }

  if (button) {
    button.hidden = true;
    button.addEventListener("click", scrollToBottom);
  }
  return { maybeScrollToBottom, scrollToBottom, refresh, isPinned: () => pinned };
}

export function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatDateTime(value, {
  locale = "zh-CN",
  options = { hour12: false },
  timeOnly = false,
  invalidFallback = "input"
} = {}) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return invalidFallback === "empty" ? "" : value;
  const resolvedLocale = locale === null ? undefined : locale;
  if (timeOnly) {
    return options ? date.toLocaleTimeString(resolvedLocale, options) : date.toLocaleTimeString(resolvedLocale);
  }
  return options ? date.toLocaleString(resolvedLocale, options) : date.toLocaleString(resolvedLocale);
}

const DEFAULT_ARTIFACT_LABELS = [
  [[".md"], "Markdown"],
  [[".txt"], "Text"],
  [[".html", ".htm"], "HTML"],
  [[".json"], "JSON"],
  [[".csv"], "CSV"],
  [[".docx"], "Word"]
];

export function formatArtifactLabel(artifactPath = "", {
  labels = {},
  codeExtensions = []
} = {}) {
  const p = `${artifactPath}`.toLowerCase();
  for (const [extensions, label] of DEFAULT_ARTIFACT_LABELS) {
    if (extensions.some((ext) => p.endsWith(ext))) return label;
  }
  for (const [extension, label] of Object.entries(labels)) {
    if (p.endsWith(String(extension).toLowerCase())) return label;
  }
  for (const extension of codeExtensions) {
    const ext = String(extension).toLowerCase();
    if (p.endsWith(ext)) return `Code ${ext.replace(".", "")}`;
  }
  return "File";
}

export function artifactIconClass(extension = "") {
  const ext = String(extension).toLowerCase().replace(/^\./, "");
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp") return "png";
  if (ext === "txt" || ext === "log") return "txt";
  if (ext === "docx" || ext === "doc" || ext === "xlsx" || ext === "xls" || ext === "pptx" || ext === "ppt") return "doc";
  return "txt";
}

export function artifactExtension(artifactPath = "") {
  return (`${artifactPath}`.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "").toLowerCase();
}

export function artifactIconText(artifactPath = "") {
  return (artifactExtension(artifactPath) || "FILE").toUpperCase().slice(0, 3);
}

const ARTIFACT_STATUS_LABELS = new Map([
  ["available", "Available"],
  ["missing", "Missing"],
  ["unknown", "Unknown"]
]);

export function artifactStatusInfo(status = "") {
  const raw = String(status ?? "").trim().toLowerCase();
  if (!raw || raw === "available") return null;
  const safeClass = /^[a-z0-9_-]+$/.test(raw) ? raw : "unknown";
  return {
    className: `artifact-status--${safeClass}`,
    label: ARTIFACT_STATUS_LABELS.get(raw) ?? raw.replaceAll("_", " ")
  };
}

export function formatRelativeTime(value) {
  if (!value) return "";
  const ts = typeof value === "number" ? value : new Date(value).getTime();
  if (Number.isNaN(ts)) return "";
  const ms = Date.now() - ts;
  if (ms < 0) return "刚刚";
  if (ms < 60_000) return "刚刚";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}
