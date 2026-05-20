const WEB_EVIDENCE_TOOLS = new Set([
  "web_search",
  "web_search_fetch",
  "fetch_url_content",
  "download_file"
]);

const RELEVANCE_PROFILES = new Set(["multi_source_research", "deep_research"]);

const STOP_TOKENS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "could", "did", "do", "does",
  "for", "from", "get", "give", "how", "i", "in", "info", "information", "into", "is",
  "it", "latest", "may", "me", "need", "new", "news", "now", "of", "on", "or", "please",
  "recent", "report", "search", "send", "summary", "summarize", "tell", "that", "the",
  "this", "to", "today", "tomorrow", "try", "up", "us", "u", "usa", "united", "states",
  "via", "was", "what", "when", "where", "with", "would", "year",
  "http", "https", "www", "com", "org", "net", "html", "htm", "utm", "ref",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "june", "july", "august", "september",
  "october", "november", "december"
]);

const CJK_STOP_TOKENS = new Set([
  "一下", "一些", "这个", "那个", "今天", "今日", "现在", "最新", "最近", "信息", "资料",
  "内容", "结果", "整理", "收集", "包括", "主要", "重要", "发送", "邮件", "帮我",
  "看看", "查询", "搜索", "汇总", "简报", "情况"
]);

const PHRASE_EXPANSIONS = [
  {
    pattern: /(美股|美国股市|美国股票|股市|股票|股价|股指|大盘|标普|纳斯达克|道琼斯|板块|财经|华尔街|stock\s+market|stocks?|equities|nasdaq|dow\s+jones|s\s*&\s*p\s*500|sp500|wall\s+street)/iu,
    tokens: [
      "stock", "stocks", "equity", "equities", "market", "markets", "finance",
      "nasdaq", "dow", "jones", "djia", "s&p", "sp500", "spx", "nyse",
      "sector", "sectors", "wall", "street", "marketwatch", "cnbc", "reuters",
      "yahoo", "quote"
    ]
  },
  {
    pattern: /(开源|开放源码|open\s+source|opensource|github|gitlab|sourceforge)/iu,
    tokens: ["open", "source", "opensource", "project", "projects", "github", "gitlab", "sourceforge"]
  },
  {
    pattern: /(活动|展览|演出|音乐会|节日|赛事|event|events|concert|festival|show|exhibit|performance|ticket)/iu,
    tokens: ["event", "events", "concert", "festival", "show", "exhibit", "performance", "ticket", "tickets"]
  }
];

function safeDecode(value = "") {
  const text = String(value ?? "");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function textPartsForTask(taskSpec = {}) {
  return [
    taskSpec.user_goal_text,
    taskSpec.user_command,
    taskSpec.topic,
    taskSpec.synthesis?.user_goal,
    taskSpec.synthesis?.primary_intent
  ].filter((value) => typeof value === "string" && value.trim());
}

function textPartsForResult(result = {}) {
  return [
    result.title,
    result.name,
    result.snippet,
    result.description,
    result.excerpt,
    result.url,
    result.link,
    result.display_url,
    result.displayUrl,
    result.source
  ].filter((value) => typeof value === "string" && value.trim());
}

function textPartsForEntry(entry = {}) {
  return [
    entry.metadata?.query,
    entry.metadata?.url,
    entry.metadata?.requested_url,
    entry.metadata?.title,
    entry.result?.url,
    entry.result?.title,
    entry.observation,
    entry.result?.observation
  ].filter((value) => typeof value === "string" && value.trim());
}

function addPhraseExpansions(text, tokens) {
  for (const entry of PHRASE_EXPANSIONS) {
    if (entry.pattern.test(text)) {
      for (const token of entry.tokens) tokens.add(token);
    }
  }
  if (/s\s*&\s*p\s*500|s\s*p\s*500|sp500/iu.test(text)) {
    tokens.add("s&p");
    tokens.add("sp500");
    tokens.add("spx");
  }
}

function addCjkTokens(text, tokens) {
  const segments = text.match(/\p{Script=Han}{2,}/gu) ?? [];
  for (const segment of segments) {
    if (CJK_STOP_TOKENS.has(segment)) continue;
    if (segment.length <= 6) {
      tokens.add(segment);
      continue;
    }
    for (let i = 0; i < segment.length - 1; i += 1) {
      const gram = segment.slice(i, i + 2);
      if (!CJK_STOP_TOKENS.has(gram)) tokens.add(gram);
    }
  }
}

export function extractRelevanceTokens(value) {
  const text = safeDecode(String(value ?? "").toLowerCase().normalize("NFKC"));
  const tokens = new Set();
  if (!text.trim()) return tokens;

  addPhraseExpansions(text, tokens);
  addCjkTokens(text, tokens);

  const ascii = text.match(/[a-z0-9]+(?:[&.-][a-z0-9]+)*/gu) ?? [];
  for (const raw of ascii) {
    const token = raw.replace(/^[.-]+|[.-]+$/gu, "");
    const candidates = token.includes("-") || token.includes(".")
      ? [token, ...token.split(/[.-]+/u)]
      : [token];
    for (const candidate of candidates) {
      if (!candidate || STOP_TOKENS.has(candidate)) continue;
      if (/^\d+$/u.test(candidate)) continue;
      if (candidate.length < 2 && candidate !== "x") continue;
      tokens.add(candidate);
    }
  }
  return tokens;
}

function buildTaskTokenSet(taskSpec = {}) {
  const tokens = new Set();
  for (const part of textPartsForTask(taskSpec)) {
    for (const token of extractRelevanceTokens(part)) tokens.add(token);
  }
  return tokens;
}

function buildQueryTokenSet(entry = {}) {
  return extractRelevanceTokens(entry?.metadata?.query ?? entry?.result?.query ?? "");
}

function relevanceApplies(taskSpec = {}) {
  const profile = taskSpec?.research_quality?.profile;
  if (RELEVANCE_PROFILES.has(profile)) return true;
  return taskSpec?.needs_current_web_data === true
    && taskSpec?.tool_policy?.policy_groups?.external_web_read?.mode === "required";
}

export function buildExternalWebEvidenceRelevanceProfile(taskSpec = {}) {
  const taskTokens = buildTaskTokenSet(taskSpec);
  return {
    applies: relevanceApplies(taskSpec),
    taskTokens
  };
}

function expectedTokensForEntry(profile, entry = {}) {
  const tokens = new Set(profile?.taskTokens ?? []);
  for (const token of buildQueryTokenSet(entry)) tokens.add(token);
  return tokens;
}

function hasTokenOverlap(expectedTokens, value) {
  const candidateTokens = extractRelevanceTokens(value);
  for (const token of expectedTokens) {
    if (candidateTokens.has(token)) return true;
  }
  return false;
}

function resultMatchesExpectedTokens(expectedTokens, result = {}) {
  const haystack = textPartsForResult(result).join(" ");
  return haystack.trim() ? hasTokenOverlap(expectedTokens, haystack) : false;
}

function searchResultArrays(entry = {}) {
  return [
    entry.metadata?.results,
    entry.metadata?.sources,
    entry.result?.results,
    entry.result?.sources
  ].filter(Array.isArray);
}

function filterSearchEntry(profile, entry = {}) {
  const expectedTokens = expectedTokensForEntry(profile, entry);
  if (expectedTokens.size === 0) return entry;

  const arrays = searchResultArrays(entry);
  if (arrays.length === 0) {
    return textPartsForEntry(entry).some((part) => hasTokenOverlap(expectedTokens, part))
      ? entry
      : null;
  }

  const primary = arrays[0];
  const filtered = primary.filter((result) => resultMatchesExpectedTokens(expectedTokens, result));
  if (filtered.length === 0) return null;

  const clone = {
    ...entry,
    metadata: entry.metadata && typeof entry.metadata === "object"
      ? { ...entry.metadata }
      : entry.metadata,
    result: entry.result && typeof entry.result === "object"
      ? { ...entry.result }
      : entry.result
  };
  if (clone.metadata && Array.isArray(clone.metadata.results)) clone.metadata.results = filtered;
  if (clone.metadata && Array.isArray(clone.metadata.sources)) clone.metadata.sources = filtered;
  if (clone.result && Array.isArray(clone.result.results)) clone.result.results = filtered;
  if (clone.result && Array.isArray(clone.result.sources)) clone.result.sources = filtered;
  return clone;
}

function filterWebEntry(profile, entry = {}) {
  if (!WEB_EVIDENCE_TOOLS.has(entry?.tool)) return entry;
  if (entry?.tool === "web_search" || entry?.tool === "web_search_fetch") {
    return filterSearchEntry(profile, entry);
  }
  const expectedTokens = expectedTokensForEntry(profile, entry);
  if (expectedTokens.size === 0) return entry;
  return textPartsForEntry(entry).some((part) => hasTokenOverlap(expectedTokens, part))
    ? entry
    : null;
}

export function filterRelevantExternalWebEvidenceTranscript(taskSpec, transcript = []) {
  const profile = buildExternalWebEvidenceRelevanceProfile(taskSpec);
  if (!profile.applies || profile.taskTokens.size === 0) return transcript;
  if (!Array.isArray(transcript)) return [];

  const out = [];
  for (const entry of transcript) {
    if (entry?.type !== "tool_result" || !WEB_EVIDENCE_TOOLS.has(entry?.tool)) {
      out.push(entry);
      continue;
    }
    const filtered = filterWebEntry(profile, entry);
    if (filtered) out.push(filtered);
  }
  return out;
}

export function evaluateExternalWebEvidenceRelevance(taskSpec, entries = []) {
  const profile = buildExternalWebEvidenceRelevanceProfile(taskSpec);
  if (!profile.applies || profile.taskTokens.size === 0) {
    return {
      applies: false,
      relevantEntries: Array.isArray(entries) ? entries : [],
      irrelevantEntries: [],
      taskTokens: [...profile.taskTokens]
    };
  }

  const relevantEntries = [];
  const irrelevantEntries = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const filtered = filterWebEntry(profile, entry);
    if (filtered) relevantEntries.push(filtered);
    else irrelevantEntries.push(entry);
  }
  return {
    applies: true,
    relevantEntries,
    irrelevantEntries,
    taskTokens: [...profile.taskTokens].sort()
  };
}
