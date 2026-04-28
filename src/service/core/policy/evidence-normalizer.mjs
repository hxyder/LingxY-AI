/**
 * UCA-077 P4-RQ C3: post-loop evidence summary for search/research
 * tasks.
 *
 * Pure observability — NOT a gate. Walks a finalised transcript,
 * extracts URLs from `web_search_fetch` and `fetch_url_content` tool
 * results, normalises them to registrable domains, and reports
 * `source_count` / `distinct_domain_count` / a deduped list of
 * domains and URLs. Stamped onto the agent-loop's return value as
 * `evidence_summary`, written to the audit log, and emitted as a
 * `EVIDENCE_SUMMARY` decision-trace stage.
 *
 * Why pure observability:
 *   - The user direction was explicit: don't gate completion on hard
 *     thresholds; let the model decide when sources are enough.
 *   - We still want production data on actual coverage so future
 *     calibration (do tasks regress to single-domain answers?) can be
 *     done on real numbers, not anecdote.
 *
 * Scope:
 *   - Reads ONLY `metadata.results[].url` (from web_search_fetch) and
 *     `metadata.url` (from fetch_url_content). Other tools' result
 *     observations may also embed URLs, but regex-extracting them
 *     from free-form text is noisy enough to corrupt the count, so
 *     we accept the slight under-count.
 *   - Skips entries with `success === false` (failed fetches don't
 *     contribute evidence).
 *
 * Registrable-domain heuristic:
 *   - Strip `www.` prefix.
 *   - Detect known second-level public suffixes (`.co.uk`, `.com.cn`,
 *     `.com.au`, etc.) and take the last 3 labels in those cases.
 *   - Otherwise take the last 2 labels.
 *   - Fall back to the raw hostname when the URL is malformed.
 *   - This handles 95%+ of real-world cases with no dependency. If
 *     telemetry shows misclassifications on edge TLDs, swap in
 *     `tldts` later (§19 follow-up).
 */

/**
 * P4-RQ D2: roundup / digest / weekly-review marker patterns.
 *
 * A roundup is a single page that aggregates internal articles —
 * "一周热闻", "AI weekly", "tech digest". For a multi_source_research
 * task, treating a roundup as N independent sources is wrong: it is
 * still ONE publisher's editorial selection.
 *
 * The validator (D3) emits `external_web_read_single_roundup_only`
 * when this marker fires AND `distinct_domain_count == 1`. The
 * runbook recovery (D4) is "broaden the query to find independent
 * sources", which is a more actionable hint than the generic
 * single-domain violation.
 *
 * Conservative regex set — false positives here over-flag
 * legitimate articles as roundups, false negatives leave the
 * single-domain violation to do the work. We err on the side of
 * fewer false positives.
 */
const ROUNDUP_MARKERS = [
  // Chinese
  /一周热?闻/i,
  /周报|周刊|每周/,
  /合集|汇总|盘点|要闻回顾/,
  // English
  /\bweekly\s+(review|digest|roundup|summary|recap)\b/i,
  /\b(news|tech|ai|industry)\s+(digest|roundup|recap|weekly)\b/i,
  /\b(roundup|round-up|digest|weekly\s+wrap)\b/i,
  // URL paths that frequently indicate roundup pages
  /\/htmlnews\//i,
  /\/(weekly|digest|roundup|recap|news-roundup)\//i
];

const SECOND_LEVEL_PUBLIC_SUFFIXES = new Set([
  // UK
  "co.uk", "ac.uk", "gov.uk", "org.uk", "ltd.uk", "plc.uk", "me.uk", "net.uk", "sch.uk", "nhs.uk",
  // Japan / Korea / India
  "co.jp", "ne.jp", "or.jp", "go.jp", "ac.jp", "co.kr", "co.in",
  // China / Hong Kong / Taiwan
  "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "ac.cn",
  "com.hk", "org.hk", "edu.hk", "gov.hk",
  "com.tw", "org.tw", "edu.tw", "gov.tw",
  // Australia / New Zealand / Singapore / Brazil
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "ac.nz", "govt.nz", "org.nz",
  "com.sg", "edu.sg", "org.sg", "gov.sg",
  "com.br", "net.br", "org.br", "gov.br"
]);

/**
 * @typedef {Object} EvidenceSummary
 * @property {number}   source_count          - count of unique URLs (deduped)
 * @property {number}   distinct_domain_count - count of unique registrable domains
 * @property {string[]} domains               - sorted list of unique domains
 * @property {string[]} urls                  - sorted list of unique URLs
 * @property {boolean}  is_single_roundup     - P4-RQ D2: true when distinct_domain_count===1
 *                                              AND any URL/title matches a roundup/digest
 *                                              marker. Validator uses this to emit the more
 *                                              specific single_roundup_only violation.
 * @property {string[]} roundup_markers       - which markers matched (for trace / debug)
 */

/**
 * Walk a transcript and extract evidence URLs/domains.
 *
 * @param {object[]} transcript
 * @returns {EvidenceSummary}
 */
export function extractEvidence(transcript) {
  const urls = new Set();
  const domains = new Set();
  const titles = [];   // collected for roundup detection
  if (!Array.isArray(transcript)) {
    return {
      source_count: 0, distinct_domain_count: 0,
      domains: [], urls: [],
      is_single_roundup: false, roundup_markers: []
    };
  }
  for (const entry of transcript) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "tool_result") continue;
    if (entry.success === false) continue;
    if (entry.tool === "web_search_fetch") {
      const results = entry.metadata?.results;
      if (Array.isArray(results)) {
        for (const r of results) {
          const u = typeof r?.url === "string" ? r.url : null;
          if (u) urls.add(u);
          if (typeof r?.title === "string") titles.push(r.title);
        }
      }
    } else if (entry.tool === "fetch_url_content") {
      const u = typeof entry.metadata?.url === "string" ? entry.metadata.url : null;
      if (u) urls.add(u);
    }
  }
  for (const u of urls) {
    const d = registrableDomain(u);
    if (d) domains.add(d);
  }
  // Roundup detection: only when ALL evidence is from a single
  // publisher (distinct_domain_count === 1). Outside that, the
  // distinct-domain violation is enough — adding roundup_only to a
  // multi-domain transcript would over-flag.
  const matchedMarkers = [];
  let isSingleRoundup = false;
  if (domains.size === 1 && urls.size > 0) {
    const haystack = [...urls, ...titles].join("\n");
    for (const re of ROUNDUP_MARKERS) {
      if (re.test(haystack)) matchedMarkers.push(re.source);
    }
    isSingleRoundup = matchedMarkers.length > 0;
  }
  return {
    source_count: urls.size,
    distinct_domain_count: domains.size,
    domains: [...domains].sort(),
    urls: [...urls].sort(),
    is_single_roundup: isSingleRoundup,
    roundup_markers: matchedMarkers
  };
}

/**
 * Detect search saturation: are the most recent `windowSize` successful
 * web tool results adding any new registrable domains beyond what was
 * already gathered earlier in the same transcript?
 *
 * Soft heuristic for research-quality tasks. Callers (agent-loop /
 * agentic planner) render the result as a one-shot system-style hint in
 * the next turn — it does NOT force synthesis or stop the loop. The
 * model decides whether to switch angles, keep searching, or compose
 * from what it already has. This sits next to extractEvidence on
 * purpose: same URL/domain extraction logic, just sliced into "before
 * the window" and "the window" instead of one big set.
 *
 * Saturation fires only when ALL of:
 *   - there are at least `windowSize + 1` successful web tool results
 *     (so a baseline exists to compare against — one new search
 *     yielding a familiar domain is not a saturation signal)
 *   - the most recent `windowSize` results contributed at least one
 *     domain (zero-domain windows aren't saturation, they're noise)
 *   - every domain in the window is already in the baseline
 *
 * Skips entries with `success === false` (failed fetches contribute
 * nothing to either side). Reads only the same metadata fields
 * extractEvidence uses (`web_search_fetch.metadata.results[].url` and
 * `fetch_url_content.metadata.url`); freeform-text URL extraction is
 * deliberately out of scope to avoid noisy false saturation.
 *
 * @param {object[]} transcript  validator-shape entries
 *                               ({type:"tool_result", tool, success, metadata})
 * @param {number} [windowSize=3]
 * @returns {{
 *   saturated: boolean,
 *   window_size: number,
 *   repeated_domains: string[],
 *   baseline_domain_count: number
 * }}
 */
export function detectSearchSaturation(transcript, windowSize = 3) {
  const safeWindow = Number.isFinite(windowSize) && windowSize >= 1 ? Math.floor(windowSize) : 0;
  const empty = {
    saturated: false,
    window_size: safeWindow,
    repeated_domains: [],
    baseline_domain_count: 0
  };
  if (!Array.isArray(transcript) || safeWindow < 1) return empty;

  const webHits = [];
  for (const entry of transcript) {
    if (!entry || entry.type !== "tool_result") continue;
    if (entry.success === false) continue;
    if (entry.tool !== "web_search_fetch" && entry.tool !== "fetch_url_content") continue;
    webHits.push(entry);
  }
  if (webHits.length <= safeWindow) return empty;

  const baseline = collectWebDomains(webHits.slice(0, webHits.length - safeWindow));
  const recent = collectWebDomains(webHits.slice(webHits.length - safeWindow));
  if (recent.size === 0) {
    return { ...empty, baseline_domain_count: baseline.size };
  }

  const repeatedDomains = [];
  let sawNewDomain = false;
  for (const d of recent) {
    if (baseline.has(d)) repeatedDomains.push(d);
    else { sawNewDomain = true; break; }
  }
  if (sawNewDomain) {
    return { ...empty, baseline_domain_count: baseline.size };
  }
  return {
    saturated: true,
    window_size: safeWindow,
    repeated_domains: repeatedDomains.sort(),
    baseline_domain_count: baseline.size
  };
}

function collectWebDomains(entries) {
  const out = new Set();
  for (const entry of entries) {
    if (entry.tool === "web_search_fetch") {
      const results = entry.metadata?.results;
      if (Array.isArray(results)) {
        for (const r of results) {
          const d = registrableDomain(typeof r?.url === "string" ? r.url : null);
          if (d) out.add(d);
        }
      }
    } else if (entry.tool === "fetch_url_content") {
      const d = registrableDomain(typeof entry.metadata?.url === "string" ? entry.metadata.url : null);
      if (d) out.add(d);
    }
  }
  return out;
}

/**
 * Extract a registrable domain (eTLD+1) from a URL using the local
 * heuristic. Returns null on malformed input.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function registrableDomain(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  // IPv4 (and bracketed IPv6 — URL.hostname strips brackets) — return
  // verbatim. Numeric hosts have no eTLD+1 to extract.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return host;
  if (host.includes(":")) return host; // IPv6 unbracketed
  // Strip leading "www."
  if (host.startsWith("www.")) host = host.slice(4);
  const labels = host.split(".");
  if (labels.length <= 1) return host;
  if (labels.length === 2) return host;
  // Check for known 2-part public suffixes (e.g. "co.uk", "com.cn")
  const tail2 = labels.slice(-2).join(".");
  if (SECOND_LEVEL_PUBLIC_SUFFIXES.has(tail2)) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}
