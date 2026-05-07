// C15 (UPGRADE_PLAN.md §C15): network-class failure classifier.
//
// R wrote: "离线时也不要假装不能做，而是明确提示'这个任务需要联网
// /需要配置 provider'，本地可做部分继续做."
//
// This module reads a tool failure (error string + observation +
// tool id) and classifies it into one of:
//
//   - "network_unreachable": offline, DNS failed, TCP refused/timeout
//   - "provider_missing":    custom_provider not configured / API key absent
//   - "auth_missing":        connected account missing / OAuth expired
//                            (the tool itself worked but the user
//                            hasn't connected their Google/Microsoft
//                            account, or the token expired)
//   - "rate_limited":        429 / "rate limit" / quota exhausted
//   - "other":               anything else; caller composes a generic message
//
// Classification is heuristic on error + observation strings — there
// is no canonical error envelope across providers + connector
// libraries. Heuristics are class-level patterns (regex on common
// strings); no per-tool / per-prompt branches. Constitution check
// (CADRE C):
//   - 不打补丁: classifier is a pure function on (error, observation,
//     toolId). No hidden state, no per-task carve-outs.
//   - 不针对特定提问: regex patterns are domain-shaped (DNS-class
//     errors, HTTP-status-class errors, "no account" / "not connected"
//     phrasing) — they generalise across the entire tool surface.

const NETWORK_UNREACHABLE_PATTERNS = [
  // Node fetch / undici / native errors
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EHOSTUNREACH/i,
  /ENETUNREACH/i,
  /\bfetch failed\b/i,
  /\bnetwork (request )?failed\b/i,
  /getaddrinfo\b/i,
  /AbortError.*timeout/i,
  /timed out/i,
  // jsdelivr / CDN-style hint
  /\boffline\b/i,
  /\bno internet\b/i
];

const PROVIDER_MISSING_PATTERNS = [
  /no (api[_ ]?key|provider configured)/i,
  /\bapi[_ ]?key (is )?(missing|not (set|configured))/i,
  /\bprovider not configured/i,
  /custom_provider.*missing/i,
  /no usable provider/i,
  /未配置.{0,4}(provider|模型|api)/iu,
  /没有.{0,4}(provider|模型|api)/iu
];

const AUTH_MISSING_PATTERNS = [
  /\bno connected account/i,
  /\baccount not connected/i,
  /\baccount.*not authoriz/i,
  /\b401\b.*Unauthor/i,
  /\bUnauthorized\b/i,
  /\binvalid_grant\b/i,
  /token (has )?expired/i,
  /please (connect|sign in|authenticate)/i,
  /未连接(账户|邮箱|账号)/iu,
  /账户未连接/iu,
  /\bOAuth\b.*expir/i
];

const RATE_LIMIT_PATTERNS = [
  /\b429\b/,
  /\brate[_ -]?limit/i,
  /quota.*exceed/i,
  /too many requests/i,
  /\bratelimited\b/i,
  /频率限制/u,
  /配额.*耗尽/u,
  /配额.*达上限/u
];

const NETWORK_TOOL_IDS = new Set([
  "web_search",
  "web_search_fetch",
  "fetch_url_content",
  "open_url",
  "send_email_smtp",
  "translate_text",
  "account_send_email",
  "account_create_event",
  "account_upload_file",
  "account_list_emails",
  "account_list_events",
  "account_list_files",
  "account_search_drive",
  "connector_workflow_run"
]);

const NETWORK_TOOL_PREFIXES = [/^account_/, /^connector_/, /^google\./, /^microsoft\./];

export function isNetworkClassTool(toolId) {
  if (typeof toolId !== "string" || !toolId) return false;
  if (NETWORK_TOOL_IDS.has(toolId)) return true;
  return NETWORK_TOOL_PREFIXES.some((re) => re.test(toolId));
}

function matchesAny(text, patterns) {
  if (!text) return false;
  return patterns.some((re) => re.test(text));
}

/**
 * Classify a single tool failure.
 *
 * @param {{ error?: string, observation?: string, toolId?: string }} input
 * @returns {{ kind: string }}
 */
export function classifyToolFailure({ error = "", observation = "", toolId = "" } = {}) {
  const haystack = `${String(error ?? "")}\n${String(observation ?? "")}`;

  // Order matters: rate-limit / auth / provider-missing checks BEFORE
  // network-unreachable, because a 429 response or a 401 also reads
  // like a "fetch did something" signal — but the user-facing fix is
  // very different from "your network is down".
  if (matchesAny(haystack, RATE_LIMIT_PATTERNS)) {
    return { kind: "rate_limited" };
  }
  if (matchesAny(haystack, AUTH_MISSING_PATTERNS)) {
    return { kind: "auth_missing" };
  }
  if (matchesAny(haystack, PROVIDER_MISSING_PATTERNS)) {
    return { kind: "provider_missing" };
  }
  if (matchesAny(haystack, NETWORK_UNREACHABLE_PATTERNS)) {
    return { kind: "network_unreachable" };
  }
  return { kind: "other" };
}

/**
 * Pull the first network-class tool failure out of a transcript and
 * classify it. Returns null when no such failure exists. Caller
 * decides whether to prepend the classified message to user-visible
 * final_text.
 *
 * @param {Array} transcript
 * @returns {{ kind: string, toolId: string, error: string, observation: string } | null}
 */
export function detectNetworkFailureInTranscript(transcript = []) {
  for (const entry of transcript ?? []) {
    if (!entry) continue;
    if (entry.success === true) continue;
    if (entry.type !== "tool_result" && entry.type !== "tool_call_completed") continue;
    if (!isNetworkClassTool(entry.tool)) continue;
    const error = typeof entry.error === "string" ? entry.error : "";
    const observation = typeof entry.observation === "string" ? entry.observation : "";
    if (!error && !observation) continue;
    const classified = classifyToolFailure({ error, observation, toolId: entry.tool });
    if (classified.kind === "other") continue;
    return {
      kind: classified.kind,
      toolId: entry.tool,
      error,
      observation
    };
  }
  return null;
}

/**
 * Render a clear user-facing message for a classified failure.
 * Bilingual: returns { zh, en }. Caller picks the locale.
 *
 * Each message has TWO halves:
 *   1. What's wrong (short, specific class).
 *   2. What to fix / next step (actionable, single sentence).
 *
 * Per R's rule, the message must NOT pretend the task is impossible —
 * it explicitly tells the user what's needed. The caller is
 * responsible for keeping any local-doable parts visible.
 */
export function formatFailureMessage(failure) {
  if (!failure || typeof failure !== "object") return null;
  const tool = failure.toolId ? ` (${failure.toolId})` : "";
  switch (failure.kind) {
    case "network_unreachable":
      return {
        zh: `这一步需要联网${tool}，但当前网络不可用。请确认网络连接后重试；本地能完成的部分仍会保留。`,
        en: `This step needs the network${tool}, but the connection is currently unavailable. Reconnect and retry; any local progress is preserved.`
      };
    case "provider_missing":
      return {
        zh: `这一步需要配置 LLM provider${tool}。请在 Console → Providers 添加并启用模型 / API key 后重试。`,
        en: `This step needs an LLM provider configured${tool}. Add and enable a model / API key in Console → Providers, then retry.`
      };
    case "auth_missing":
      return {
        zh: `这一步需要连接的账户${tool}，但当前没有可用账户或登录已过期。请到 Console → Connectors 重新连接后重试。`,
        en: `This step needs a connected account${tool}, but no usable account is available or the session expired. Reconnect in Console → Connectors and retry.`
      };
    case "rate_limited":
      return {
        zh: `这一步达到了 provider 的速率限制${tool}。请稍等片刻或检查配额额度后重试。`,
        en: `This step hit a provider rate limit${tool}. Wait a moment or check your quota, then retry.`
      };
    default:
      return null;
  }
}
