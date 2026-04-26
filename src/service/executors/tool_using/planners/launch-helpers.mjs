/**
 * UCA-077 P3-01: Launch-app + URL helpers, lifted out of agent-loop.mjs.
 *
 * These are pure string utilities used by:
 *   - planDeterministicToolCall  (deciding `launch_app` / `open_url`)
 *   - repairToolArgs             (back-filling launch_app's `app` argument
 *                                  when the LLM emitted a placeholder)
 *
 * Splitting them out makes the planner module cleaner and lets us unit-
 * test extraction independently of the planner's flow.
 */

/**
 * Pull an HTTP/HTTPS URL out of free-form text.
 * Returns null when no URL is found.
 *
 * @param {string} value
 * @returns {string|null}
 */
export function extractUrl(value = "") {
  const text = String(value ?? "");
  const match = text.match(/\bhttps?:\/\/[^\s，。]+/i)
    ?? text.match(/\bwww\.[^\s，。]+/i);
  if (!match) return null;
  const raw = match[0].replace(/[,.!?]+$/g, "");
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

/**
 * Best-effort extract of "what app did the user ask to launch" from a
 * Chinese / English instruction. Returns null when nothing convincing
 * surfaces (we want the LLM planner to take over rather than launch a
 * random word).
 *
 * @param {string} value
 * @returns {string|null}
 */
export function extractLaunchAppName(value = "") {
  const text = String(value ?? "").trim();
  const patterns = [
    /(?:启动|打开|运行)\s*(?:一下|下)?\s*(?:应用|软件|程序|app)?\s*([^，。,.!?]+)/i,
    /\b(?:launch|open|start|run)\s+(?:the\s+)?(?:app\s+|application\s+)?([^,.!?]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.trim()
      ?.replace(/^(一个|某个|这个|那个|应用|软件|程序|app|application)\s*/i, "")
      ?.trim();
    if (candidate
      && !/^(一个)?(应用|软件|程序|app|application)$/i.test(candidate)
      && !extractUrl(candidate)
      && !/(网页|网站|链接|网址|url|web\s*page|website)$/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Same as extractLaunchAppName but returns every distinct candidate so
 * compound instructions ("打开微信和钉钉") get all the apps they asked for.
 *
 * @param {string} value
 * @returns {string[]}
 */
export function extractLaunchAppCandidates(value = "") {
  const text = String(value ?? "");
  const patterns = [
    /(?:启动|打开|运行)\s*(?:一下|下)?\s*(?:应用|软件|程序|app)?\s*([^，,。.!?]+)/gi,
    /\b(?:launch|open|start|run)\s+(?:the\s+)?(?:app\s+|application\s+)?([^,.!?]+)/gi
  ];
  const candidates = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = match?.[1]?.trim()
        ?.replace(/^(一个|某个|这个|那个|应用|软件|程序|app|application)\s*/i, "")
        ?.trim();
      if (candidate
        && !/^(一个)?(应用|软件|程序|app|application)$/i.test(candidate)
        && !extractUrl(candidate)
        && !/(网页|网站|链接|网址|url|web\s*page|website)$/i.test(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return [...new Set(candidates)];
}

/**
 * Coerce whatever shape the LLM emitted (string / array / undefined) into
 * a single trimmed string for `launch_app.args.app`.
 *
 * @param {*} value
 * @returns {string}
 */
export function normalizeLaunchAppArg(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).find(Boolean) ?? "";
  }
  return String(value ?? "").trim();
}

/**
 * Compare two app names by their canonical form so we don't relaunch the
 * same app twice in a compound action chain.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeLaunchAppKey(value = "") {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\.exe$/i, "")
    .replace(/\s+/g, "");
}
