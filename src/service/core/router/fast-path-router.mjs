/**
 * UCA-066 — Fast-Path Router
 *
 * Intercepts requests BEFORE the full intent-router → decomposer → LLM pipeline.
 * Deterministic actions (Tier 0) execute in < 200ms with zero LLM calls.
 * Lightweight tasks (Tier 1) use specialised APIs instead of the main LLM.
 *
 * CRITICAL BOUNDARY RULE:
 *   "打开微信"               → null    (let the normal planner decide app vs URL vs workflow)
 *   "打开Outlook写请假邮件"  → null    (compound — LLM needed for content generation)
 *                                       The launch_app step still exists as a tool,
 *                                       but we do not regex-short-circuit app opens.
 *
 * Returns null to signal "use normal pipeline".
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

// Sequential compound: "open/launch X, [then] do Y" — needs LLM for the Y part
const SEQUENTIAL_COMPOUND = /(?:打开|启动|open|launch|运行|run)\s*\S+\s*[，,、]\s*(?:帮我|帮|写|发|查|搜|做|生成|起草|draft|write|compose|search|find|create|analyze|分析)/i;

// Translation requests → Tier 1 (specialised API, not main LLM)
const TRANSLATION_REQUEST = /\b(翻译|translate|translation)\b/i;

// Clipboard copy request
const CLIPBOARD_REQUEST = /\b(复制|copy)\b/i;

// Notification / alert (no content generation needed)
const NOTIFY_REQUEST = /\b(提醒我|notify me|通知我)\b.*(?:[\d一二三四五六七八九十百千]|now|现在|立即)/i;

const APP_NAME_PATTERN = /(?:打开|启动|运行|launch|open|start|run)\s*([^\s，,。.!?！？\n]{2,30}?)(?:\s*$|[，,。.!?！？\n])/i;

// URL pattern
const URL_PATTERN = /\bhttps?:\/\/[^\s，。]+/i;
const WWW_PATTERN = /\bwww\.[^\s，。]+/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a URL from user command.
 * @param {string} text
 * @returns {string|null}
 */
function extractUrl(text) {
  const m = text.match(URL_PATTERN) ?? text.match(WWW_PATTERN);
  if (!m) return null;
  const raw = m[0].replace(/[,.!?]+$/g, "");
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

/**
 * Extract app name from a pure "open/launch X" command.
 * Returns null when the command has additional actions after the app name
 * (those need LLM to handle the subsequent steps).
 *
 * Generic: works for any app — Outlook, 微信, Chrome, VS Code, Notion, etc.
 * @param {string} text
 * @returns {string|null}
 */
export function extractPureLaunchApp(text) {
  // First, reject compound patterns
  if (SEQUENTIAL_COMPOUND.test(text)) return null;

  const m = text.match(APP_NAME_PATTERN);
  if (!m) return null;

  const candidate = m[1].trim()
    .replace(/^(一个|某个|这个|那个|应用|软件|程序|app|application)\s*/i, "")
    .trim();

  // Reject empty or generic words
  if (!candidate || /^(应用|软件|程序|app|application|文件|something)$/i.test(candidate)) {
    return null;
  }
  if (/(文档|文件|格式|\.docx|\.pptx|\.xlsx|\.pdf|^docx$|^pptx$|^xlsx$|^pdf$)/i.test(candidate)) {
    return null;
  }
  // Reject if candidate looks like a URL
  if (/https?:\/\/|www\./.test(candidate)) return null;

  return candidate;
}

/**
 * Detect whether the context has selected text suitable for clipboard copy.
 * @param {string} text
 * @param {Object} contextPacket
 */
function isClipboardCopy(text, contextPacket) {
  return CLIPBOARD_REQUEST.test(text)
    && typeof contextPacket?.text === "string"
    && contextPacket.text.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Try to resolve a fast-path execution plan.
 *
 * @param {string} userCommand
 * @param {Object} contextPacket
 * @returns {{ tier: number, tool: string, args: Object }|{ tier: number, executor: string, [key: string]: any }|null}
 */
export function tryFastPath(userCommand, contextPacket) {
  const cmd = String(userCommand ?? "").trim();
  if (!cmd) return null;

  // ── Tier 0 ──────────────────────────────────────────────────────────────

  // Open a URL directly
  const url = extractUrl(cmd);
  if (url) {
    return { tier: 0, tool: "open_url", args: { url } };
  }

  // Clipboard copy (user selected text + asked to copy)
  if (isClipboardCopy(cmd, contextPacket)) {
    return { tier: 0, tool: "copy_to_clipboard", args: { content: contextPacket.text } };
  }

  // ── Tier 1 ──────────────────────────────────────────────────────────────

  // Translation — use specialised API, not main LLM
  if (TRANSLATION_REQUEST.test(cmd)) {
    const textToTranslate = contextPacket?.text?.trim() || cmd;
    return { tier: 1, executor: "translation_fast", text: textToTranslate };
  }

  // ── No fast path matched ─────────────────────────────────────────────────
  return null;
}

/**
 * For use INSIDE the tool-agent loop (UCA-066 Tier 0 in-loop optimisation).
 *
 * On the very first iteration, if the user command clearly starts with a
 * deterministic URL open, return it immediately without calling the LLM
 * planner. App opens stay in the normal planner path so the model can use
 * higher-level judgment.
 *
 * Works generically for any app name or URL.
 *
 * @param {string} userCommand
 * @returns {{ tool: string, args: Object }|null}
 */
export function extractFirstTier0Action(userCommand) {
  const cmd = String(userCommand ?? "").trim();

  const url = extractUrl(cmd);
  if (url) return { tool: "open_url", args: { url } };

  return null;
}

/**
 * Check if user command contains a compound intent requiring LLM after a
 * deterministic first step.
 * e.g. "打开Outlook写邮件" → true (launch is instant; email draft needs LLM)
 *
 * @param {string} userCommand
 * @returns {boolean}
 */
export function hasCompoundIntent(userCommand) {
  return SEQUENTIAL_COMPOUND.test(String(userCommand ?? ""));
}
