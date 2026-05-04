import {
  FILE_EVIDENCE_COVERAGE,
  isDeepFileTextCoverageScope,
  isFileTextCoverageScope,
  normalizeFileCoverageScope
} from "../file-evidence-coverage.mjs";
import { normalizeSources } from "../evidence/source-envelope.mjs";

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
 *   - Reads structured evidence fields only: `metadata.results[].url`
 *     from web_search_fetch, `metadata.url` from fetch_url_content, and
 *     local paths from read_file_text / read_folder_text / vision_analyze.
 *     Other tools' result observations may also embed URLs or paths, but
 *     regex-extracting them from free-form text is noisy enough to corrupt
 *     the count, so we accept the slight under-count.
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
 * @property {number}   local_source_count    - count of unique local files/images read
 * @property {string[]} local_sources         - sorted list of local file/image paths
 * @property {number}   local_text_source_count - count of local sources with extracted text/content
 * @property {number}   local_deep_text_source_count - count of local sources read through recursive folder extraction
 * @property {number}   local_shallow_source_count - count of local paths enumerated or statted without extracted content
 * @property {string[]} local_shallow_sources - sorted list of local paths observed without content extraction
 * @property {Object.<string, number>} local_coverage_scope_counts - source counts grouped by coverage scope
 * @property {number}   local_truncated_source_count - count of local sources whose extracted content was truncated
 * @property {string[]} local_truncated_sources - sorted list of truncated local paths
 * @property {number}   indexed_file_source_count - count of local file-content index hits
 * @property {string[]} indexed_file_sources - sorted list of indexed local file paths
 * @property {Object.<string, number>} indexed_file_coverage_scope_counts - indexed hits grouped by coverage scope
 * @property {number}   indexed_file_truncated_source_count - count of indexed hits marked truncated
 * @property {string[]} indexed_file_truncated_sources - sorted list of truncated indexed paths
 * @property {number}   blended_source_count  - web URL count + fresh local source count + indexed file source count
 * @property {number}   blended_origin_count  - distinct web domains + fresh local sources + indexed file sources
 * @property {boolean}  is_single_roundup     - P4-RQ D2: true when distinct_domain_count===1
 *                                              AND any URL/title matches a roundup/digest
 *                                              marker. Validator uses this to emit the more
 *                                              specific single_roundup_only violation.
 * @property {string[]} roundup_markers       - which markers matched (for trace / debug)
 * @property {object[]} sources               - unified source ledger entries for web, local, indexed chunks, and images
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
  const localSources = new Set();
  const localDeepTextSources = new Set();
  const localShallowSources = new Set();
  const localTruncatedSources = new Set();
  const localCoverageSources = new Map();
  const indexedFileSources = new Set();
  const indexedFileTruncatedSources = new Set();
  const indexedFileCoverageSources = new Map();
  const ledgerSources = [];
  const titles = [];   // collected for roundup detection
  if (!Array.isArray(transcript)) {
    return {
      source_count: 0, distinct_domain_count: 0,
      domains: [], urls: [],
      local_source_count: 0, local_sources: [],
      local_text_source_count: 0, local_deep_text_source_count: 0,
      local_shallow_source_count: 0, local_shallow_sources: [],
      local_coverage_scope_counts: {},
      local_truncated_source_count: 0, local_truncated_sources: [],
      indexed_file_source_count: 0, indexed_file_sources: [],
      indexed_file_coverage_scope_counts: {},
      indexed_file_truncated_source_count: 0, indexed_file_truncated_sources: [],
      blended_source_count: 0, blended_origin_count: 0,
      is_single_roundup: false, roundup_markers: [],
      sources: []
    };
  }
  for (const entry of transcript) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "tool_result") continue;
    if (entry.success === false) continue;
    ledgerSources.push(...normalizeSources(entry));
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
    } else if (entry.tool === "read_file_text") {
      if (Array.isArray(entry.metadata?.files)) {
        addFolderTextCoverage({
          metadata: entry.metadata,
          localSources,
          localDeepTextSources,
          localShallowSources,
          localTruncatedSources,
          localCoverageSources
        });
      } else {
        addLocalCoverageSource({
          path: entry.metadata?.path,
          scope: entry.metadata?.coverage_scope ?? FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
          contentExtracted: entry.metadata?.content_extracted !== false,
          truncated: entry.metadata?.truncated === true,
          localSources,
          localDeepTextSources,
          localShallowSources,
          localTruncatedSources,
          localCoverageSources
        });
      }
    } else if (entry.tool === "read_folder_text") {
      addFolderTextCoverage({
        metadata: entry.metadata,
        localSources,
        localDeepTextSources,
        localShallowSources,
        localTruncatedSources,
        localCoverageSources
      });
    } else if (entry.tool === "vision_analyze") {
      const imagePaths = entry.metadata?.image_paths;
      if (Array.isArray(imagePaths)) {
        for (const imagePath of imagePaths) {
          addLocalCoverageSource({
            path: imagePath,
            scope: FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
            contentExtracted: true,
            localSources,
            localDeepTextSources,
            localShallowSources,
            localTruncatedSources,
            localCoverageSources
          });
        }
      }
    } else if (entry.tool === "search_file_content") {
      const results = Array.isArray(entry.metadata?.results) ? entry.metadata.results : [];
      for (const result of results) {
        addIndexedFileCoverageSource({
          path: result?.path ?? result?.metadata?.path ?? result?.id,
          scope: result?.coverage_scope ?? result?.metadata?.coverage_scope ?? FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT,
          truncated: result?.truncated === true || result?.metadata?.truncated === true,
          indexedFileSources,
          indexedFileTruncatedSources,
          indexedFileCoverageSources
        });
      }
    } else if (entry.tool === "list_files" || entry.tool === "glob_files" || entry.tool === "find_recent_files") {
      const files = Array.isArray(entry.metadata?.files) ? entry.metadata.files : [];
      const scope = entry.metadata?.coverage_scope
        ?? (entry.tool === "list_files"
          ? FILE_EVIDENCE_COVERAGE.DIRECTORY_LISTING_SHALLOW
          : FILE_EVIDENCE_COVERAGE.FILE_ENUMERATION_RECURSIVE);
      for (const filePath of files) {
        addLocalCoverageSource({
          path: typeof filePath === "string" ? filePath : filePath?.path,
          scope,
          contentExtracted: false,
          localSources,
          localDeepTextSources,
          localShallowSources,
          localTruncatedSources,
          localCoverageSources
        });
      }
    } else if (entry.tool === "stat_file") {
      addLocalCoverageSource({
        path: entry.metadata?.path,
        scope: entry.metadata?.coverage_scope ?? FILE_EVIDENCE_COVERAGE.FILE_METADATA,
        contentExtracted: false,
        localSources,
        localDeepTextSources,
        localShallowSources,
        localTruncatedSources,
        localCoverageSources
      });
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
    local_source_count: localSources.size,
    local_sources: [...localSources].sort(),
    local_text_source_count: localSources.size,
    local_deep_text_source_count: localDeepTextSources.size,
    local_shallow_source_count: localShallowSources.size,
    local_shallow_sources: [...localShallowSources].sort(),
    local_coverage_scope_counts: localCoverageScopeCounts(localCoverageSources),
    local_truncated_source_count: localTruncatedSources.size,
    local_truncated_sources: [...localTruncatedSources].sort(),
    indexed_file_source_count: indexedFileSources.size,
    indexed_file_sources: [...indexedFileSources].sort(),
    indexed_file_coverage_scope_counts: localCoverageScopeCounts(indexedFileCoverageSources),
    indexed_file_truncated_source_count: indexedFileTruncatedSources.size,
    indexed_file_truncated_sources: [...indexedFileTruncatedSources].sort(),
    blended_source_count: urls.size + localSources.size + indexedFileSources.size,
    blended_origin_count: domains.size + localSources.size + indexedFileSources.size,
    is_single_roundup: isSingleRoundup,
    roundup_markers: matchedMarkers,
    sources: sortEvidenceSources(dedupeEvidenceSources(ledgerSources))
  };
}

function dedupeEvidenceSources(sources = []) {
  const byId = new Map();
  for (const source of sources) {
    if (!source?.id || byId.has(source.id)) continue;
    byId.set(source.id, source);
  }
  return [...byId.values()];
}

function sortEvidenceSources(sources = []) {
  const kindOrder = new Map([
    ["web", 0],
    ["file", 1],
    ["chunk", 2],
    ["image", 3]
  ]);
  return [...sources].sort((a, b) => {
    const kindDiff = (kindOrder.get(a.kind) ?? 9) - (kindOrder.get(b.kind) ?? 9);
    if (kindDiff) return kindDiff;
    const scoreA = Number.isFinite(Number(a.score)) ? Number(a.score) : -1;
    const scoreB = Number.isFinite(Number(b.score)) ? Number(b.score) : -1;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.locator ?? "").localeCompare(String(b.locator ?? ""));
  });
}

function addLocalSource(out, value) {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (!normalized) return;
  out.add(normalized);
}

function addCoverageSource(map, scope, path) {
  const normalizedScope = normalizeFileCoverageScope(scope);
  if (!normalizedScope || typeof path !== "string" || !path.trim()) return;
  if (!map.has(normalizedScope)) map.set(normalizedScope, new Set());
  map.get(normalizedScope).add(path.trim());
}

function addLocalCoverageSource({
  path,
  scope,
  contentExtracted,
  truncated = false,
  localSources,
  localDeepTextSources,
  localShallowSources,
  localTruncatedSources,
  localCoverageSources
}) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  if (!normalizedPath) return;
  const normalizedScope = normalizeFileCoverageScope(scope)
    ?? (contentExtracted ? FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT : FILE_EVIDENCE_COVERAGE.FILE_METADATA);
  addCoverageSource(localCoverageSources, normalizedScope, normalizedPath);
  if (contentExtracted && isFileTextCoverageScope(normalizedScope)) {
    addLocalSource(localSources, normalizedPath);
    if (isDeepFileTextCoverageScope(normalizedScope)) addLocalSource(localDeepTextSources, normalizedPath);
    if (truncated) addLocalSource(localTruncatedSources, normalizedPath);
    return;
  }
  addLocalSource(localShallowSources, normalizedPath);
}

function addFolderTextCoverage({
  metadata = {},
  localSources,
  localDeepTextSources,
  localShallowSources,
  localTruncatedSources,
  localCoverageSources
}) {
  const files = metadata?.files;
  let added = false;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (file?.success === false) continue;
      addLocalCoverageSource({
        path: file?.path,
        scope: metadata.coverage_scope ?? FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
        contentExtracted: metadata.content_extracted !== false,
        truncated: file?.truncated === true,
        localSources,
        localDeepTextSources,
        localShallowSources,
        localTruncatedSources,
        localCoverageSources
      });
      added = true;
    }
  }
  if (!added) {
    addLocalCoverageSource({
      path: metadata?.path,
      scope: metadata?.coverage_scope ?? FILE_EVIDENCE_COVERAGE.FOLDER_RECURSIVE_TEXT,
      contentExtracted: metadata?.content_extracted !== false,
      truncated: metadata?.truncated === true,
      localSources,
      localDeepTextSources,
      localShallowSources,
      localTruncatedSources,
      localCoverageSources
    });
  }
}

function addIndexedFileCoverageSource({
  path,
  scope,
  truncated = false,
  indexedFileSources,
  indexedFileTruncatedSources,
  indexedFileCoverageSources
}) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  if (!normalizedPath) return;
  const normalizedScope = normalizeFileCoverageScope(scope) ?? FILE_EVIDENCE_COVERAGE.SINGLE_FILE_TEXT;
  addCoverageSource(indexedFileCoverageSources, normalizedScope, normalizedPath);
  addLocalSource(indexedFileSources, normalizedPath);
  if (truncated) addLocalSource(indexedFileTruncatedSources, normalizedPath);
}

function localCoverageScopeCounts(map) {
  const out = {};
  for (const [scope, sources] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[scope] = sources.size;
  }
  return out;
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
