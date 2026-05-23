/**
 * Launch-boundary helpers.
 *
 * The old zero-LLM fast path has been retired. These helpers only provide
 * structural evidence to the normal LLM-first pipeline; they do not execute
 * tools or choose an executor.
 */

const LAUNCH_VERB = "(?:打开|启动|运行|launch|open|start|run)";
const LAUNCH_REQUEST_PREFIX = "(?:请|帮我|帮忙|麻烦|可以|能不能|能否|能帮我|我要|我想|想要|please|can\\s+you|could\\s+you|would\\s+you)?";
const LAUNCH_INTENT_PREFIX = `^\\s*${LAUNCH_REQUEST_PREFIX}\\s*(?:一下|下)?\\s*`;
const APP_NAME_PATTERN = new RegExp(`${LAUNCH_INTENT_PREFIX}${LAUNCH_VERB}\\s*([^\\s，,。.!?！？\\n]{2,30}?)(?:\\s*$|[，,。.!?！？\\n])`, "i");

const COMPOUND_LAUNCH = new RegExp(`${LAUNCH_INTENT_PREFIX}(?:打开|启动|open|launch|运行|run)\\s*\\S+\\s*[，,、]`, "i");
const LAUNCH_LIST_SHAPE = new RegExp(`${LAUNCH_INTENT_PREFIX}(?:打开|启动|运行|launch|open|start|run)[^。.!?！？\\n]*(?:[，,、]|(?:\\s+和\\s+)|(?:\\s+and\\s+)|(?:打开|启动|运行|launch|open|start|run))`, "i");
const LAUNCH_LIST_PATTERN = new RegExp(`${LAUNCH_INTENT_PREFIX}${LAUNCH_VERB}\\s*([^。.!?！？\\n]+)`, "i");
const NON_APP_LAUNCH_TARGET = /^(?:模型|大模型|算法|接口|api|服务|代码|脚本|命令|函数|程序代码|这个|那个|它|这个模型|那个模型)$/i;

function cleanupLaunchTarget(value = "") {
  const candidate = String(value ?? "")
    .trim()
    .replace(new RegExp(`^${LAUNCH_VERB}\\s*(?:一下|下)?\\s*(?:应用|软件|程序|app|application)?\\s*`, "i"), "")
    .replace(/^(一个|某个|这个|那个|应用|软件|程序|app|application)\s*/i, "")
    .replace(/[吗么呢吧呀]$/u, "")
    .trim();
  if (!candidate || /^(一个)?(应用|软件|程序|app|application|文件|文档|something)$/i.test(candidate)) {
    return "";
  }
  if (NON_APP_LAUNCH_TARGET.test(candidate)) return "";
  if (/(网页|网站|链接|网址|url|web\s*page|website|文档|文件|格式|\.docx|\.pptx|\.xlsx|\.pdf|\.html|^docx$|^pptx$|^xlsx$|^pdf$|^html$)/i.test(candidate)) {
    return "";
  }
  if (/https?:\/\/|www\./i.test(candidate)) return "";
  return candidate;
}

function splitLaunchTargets(chunk = "") {
  return String(chunk ?? "")
    .split(/(?:[，,、]|(?:\s*和\s*)|(?:\s+and\s+)|(?:\s*&\s*))/i)
    .map(cleanupLaunchTarget)
    .filter(Boolean);
}

export function extractLaunchAppCandidates(text) {
  const raw = String(text ?? "");
  const pure = extractPureLaunchApp(raw);
  if (pure) return [pure];
  if (!LAUNCH_LIST_SHAPE.test(raw)) return [];
  const match = raw.match(LAUNCH_LIST_PATTERN);
  const chunk = match?.[1] ?? "";
  return [...new Set(splitLaunchTargets(chunk))];
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
  if (COMPOUND_LAUNCH.test(text)) return null;

  const m = text.match(APP_NAME_PATTERN);
  if (!m) return null;

  const candidate = m[1].trim()
    .replace(/^(一个|某个|这个|那个|应用|软件|程序|app|application)\s*/i, "")
    .replace(/[吗么呢吧呀]$/u, "")
    .trim();

  // Reject empty or generic words
  if (!candidate || /^(应用|软件|程序|app|application|文件|something)$/i.test(candidate)) {
    return null;
  }
  if (NON_APP_LAUNCH_TARGET.test(candidate)) return null;
  if (/(文档|文件|格式|\.docx|\.pptx|\.xlsx|\.pdf|\.html|^docx$|^pptx$|^xlsx$|^pdf$|^html$)/i.test(candidate)) {
    return null;
  }
  // Reject if candidate looks like a URL
  if (/https?:\/\/|www\./.test(candidate)) return null;

  return candidate;
}
