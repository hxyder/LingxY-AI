/**
 * Launch-boundary helpers.
 *
 * The old zero-LLM fast path has been retired. These helpers only provide
 * structural evidence to the normal LLM-first pipeline; they do not execute
 * tools or choose an executor.
 */

const APP_NAME_PATTERN = /(?:打开|启动|运行|launch|open|start|run)\s*([^\s，,。.!?！？\n]{2,30}?)(?:\s*$|[，,。.!?！？\n])/i;

const COMPOUND_LAUNCH = /(?:打开|启动|open|launch|运行|run)\s*\S+\s*[，,、]/i;

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
  if (COMPOUND_LAUNCH.test(text)) return null;

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
