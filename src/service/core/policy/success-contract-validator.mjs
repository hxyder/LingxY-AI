/**
 * UCA-077 P1-08: Centralised success-contract validator.
 *
 * Shared between tool_using and agentic so both executors apply the same
 * downgrade rules. Pulls the rules out of `agent-loop.mjs` so we can call
 * them from anywhere (including a future task-runtime finalize hook in
 * Phase 2's OutputPolicy work).
 *
 * Validates:
 *   - For every entry in `success_contract.required_policy_groups`, the
 *     transcript must contain at least one tool_result for ANY tool that
 *     belongs to the group — and the result must look non-empty.
 *     "Called but returned nothing" still counts as a violation. This is
 *     the P4-00.7 group-aware check; it replaces the previous hardcoded
 *     `web_search_fetch === required → must call web_search_fetch` rule
 *     so the LLM is allowed to satisfy "external_web_read=required" by
 *     calling fetch_url_content (a sibling tool in the same group) or
 *     web_search instead.
 *
 * Phase 2 will extend this with: artifact_required → artifact actually
 * created; output=conversational → no spurious file writes.
 */

import path from "node:path";

import { toolsInGroup } from "./policy-groups.mjs";
import {
  ACTION_OBLIGATION_GROUPS,
  actionGroupHitSatisfies,
  evaluateActionObligations,
  workflowMatchesActionGroup
} from "./obligation-evaluator.mjs";
import { extractEvidence } from "./evidence-normalizer.mjs";
import { SYNTHESIS_REQUIRED_OUTPUTS } from "../intent/semantic-router.mjs";
import {
  isDeepFileTextCoverageScope,
  isFileTextCoverageScope
} from "../file-evidence-coverage.mjs";

const SYNTHESIS_OVERLAP_THRESHOLD = 0.6;
const SYNTHESIS_MIN_OBSERVATION_CHARS = 80;
const SYNTHESIS_MIN_FINAL_RAW_DUMP_CHARS = 120;
const SYNTHESIS_BIGRAM_SAMPLE_CAP = 4000;
const LOCAL_FILE_TEXT_READ_GROUP = "local_file_text_read";

function normaliseForOverlap(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SYNTHESIS_BIGRAM_SAMPLE_CAP);
}

function bigramSet(text) {
  const norm = normaliseForOverlap(text);
  if (norm.length < 2) return new Set();
  const set = new Set();
  for (let i = 0; i < norm.length - 1; i++) set.add(norm.slice(i, i + 2));
  return set;
}

function bigramOverlap(a, b) {
  const A = bigramSet(a);
  const B = bigramSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / Math.min(A.size, B.size);
}

function compactMetadataForOverlap(metadata) {
  if (!metadata || typeof metadata !== "object") return "";
  try {
    return JSON.stringify(metadata).slice(0, SYNTHESIS_BIGRAM_SAMPLE_CAP);
  } catch {
    return "";
  }
}

function recordListMetadata(entry = {}) {
  const metadata = entry?.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  if (metadata.result_kind !== "record_list") return null;
  const count = Number(metadata.record_count ?? 0);
  return {
    recordType: String(metadata.record_type ?? "record"),
    recordCount: Number.isFinite(count) ? count : 0
  };
}

function lineShapeStats(text = "") {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const itemLines = lines.filter((line) => /^(?:[-*]|\d+[.)、])\s+/.test(line));
  const proseLines = lines.filter((line) => !/^(?:[-*]|\d+[.)、])\s+/.test(line));
  return {
    lineCount: lines.length,
    itemLineCount: itemLines.length,
    substantialProseLineCount: proseLines.filter((line) => line.length >= 24).length
  };
}

function detectUnsynthesizedRecordList(toolResults = [], expected, final = "") {
  if (!SYNTHESIS_REQUIRED_OUTPUTS.has(expected)) return null;
  if (expected === "action_items") return null;
  const recordLists = toolResults
    .map(recordListMetadata)
    .filter((entry) => entry && entry.recordCount >= 2);
  if (recordLists.length === 0) return null;

  const stats = lineShapeStats(final);
  if (stats.lineCount < 2 || stats.itemLineCount < 2) return null;
  const mostlyItems = stats.itemLineCount / stats.lineCount >= 0.6;
  const hasEnoughProse = stats.substantialProseLineCount >= 2;
  if (!mostlyItems || hasEnoughProse) return null;

  const totalRecords = recordLists.reduce((sum, entry) => sum + entry.recordCount, 0);
  return {
    record_count: totalRecords,
    record_types: [...new Set(recordLists.map((entry) => entry.recordType))]
  };
}

/**
 * Per-kind shape markers. Deterministic v1 — light heuristics that
 * catch obvious "wrong shape" cases (e.g. expected_output=summary but
 * the answer is a bare list with no conclusion). Each entry documents
 * what the kind expects and the markers we look for. Markers are bigram
 * / phrase signatures, not topic regex.
 */
const SHAPE_MARKERS = Object.freeze({
  summary: {
    description: "summary or grouped overview with at least one synthesis sentence",
    patterns: [
      /(总结|概括|综上|总体来看|总体而言|要点是|核心是|主要|大致来说)/i,
      /(in\s+summary|overall|to\s+sum\s+up|in\s+short|takeaway|summary:)/i
    ]
  },
  comparison: {
    description: "explicit comparison across at least one dimension",
    patterns: [
      /(相比|对比|比较|相对|优于|劣于|差别|区别|不同点|相同点)/i,
      /(\bcompared\b|\bvs\.?\b|\bversus\b|\bbetter\b|\bworse\b|\bdifference\b|\bsimilar\b)/i,
      /\|.+\|/   // a markdown table row often signals comparison
    ]
  },
  recommendation: {
    description: "ranked / prioritised recommendation with reasoning",
    patterns: [
      /(推荐|建议|首选|优先|最佳|最好|强烈推荐|considered|preferred)/i,
      /(\brecommend\b|\bsuggest\b|\bbest\s+(option|choice)|\bprefer\b|\bgo\s+with\b)/i
    ]
  },
  analysis: {
    description: "pattern / cause / implication beyond restating the data",
    patterns: [
      /(原因|因为|导致|趋势|模式|意味着|说明|可见|因此|所以)/i,
      /(\bbecause\b|\btherefore\b|\bimplies\b|\bsuggests\b|\bpattern\b|\btrend\b|\broot\s+cause\b)/i
    ]
  },
  action_items: {
    description: "numbered / bulleted action items with handling guidance",
    patterns: [
      /(待处理|需要处理|优先级|紧急|后续|下一步|负责人|deadline)/i,
      /(\baction\b|\bnext\s+steps?\b|\bpriority\b|\bowner\b|\btodo\b|\bto-?do\b)/i
    ]
  }
});

function hasShapeMarker(kind, text) {
  const config = SHAPE_MARKERS[kind];
  if (!config) return true;
  for (const re of config.patterns) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Post-tool synthesis check.
 *
 * SCOPE — this is a LIGHTWEIGHT GUARDRAIL, not a semantic quality
 * evaluator. It catches the obvious "tool observation pasted back as
 * the final answer" anti-pattern and the "wrong shape" cases per the
 * expected_output kind. It does NOT judge whether a summary is
 * insightful, whether a comparison is fair, or whether a recommendation
 * is well-reasoned. Treat it as a tripwire that triggers one synthesis
 * retry; do not promote it into a quality scoring layer. A future LLM-
 * based or hybrid evaluator can sit alongside this without replacing
 * it; this function will remain the deterministic floor.
 *
 * Two independent arms:
 *
 *   ARM 1 — RAW-DUMP DETECTION
 *     bigram overlap with a non-trivial tool observation ≥
 *     SYNTHESIS_OVERLAP_THRESHOLD. Catches "I found 10 emails:
 *     1. ... 2. ..." pasted back as the final answer.
 *
 *     Fires when expected_output is:
 *       - one of SYNTHESIS_REQUIRED_OUTPUTS (the obvious case), OR
 *       - null / undefined / "" — i.e. SR was unavailable or skipped
 *         and IntentRoute never classified the request. Pre-A the
 *         validator early-returned in this case, so when SR went
 *         missing the raw-dump regression slipped through (P6 F3 root
 *         cause: 总结一下今天的邮件 → SR fact-skipped → expected_output
 *         stayed null → validator silenced → LLM raw-dumped 100 emails).
 *
 *     Does NOT fire when expected_output is an EXPLICITLY classified
 *     non-synthesis kind (raw_results, direct_answer, code, table,
 *     artifact). When IntentRoute explicitly classified the request
 *     as wanting raw data, the LLM is allowed to echo observations —
 *     that's what the user asked for.
 *
 *   ARM 2 — SHAPE-MARKER CHECK (synthesis kinds only)
 *     The kind-specific shape marker (e.g. summary requires a
 *     conclusion sentence; comparison requires comparative wording)
 *     is absent. Only runs when expected_output is one of
 *     SYNTHESIS_REQUIRED_OUTPUTS. For null/non-synthesis kinds we
 *     don't know the expected shape, so the check is skipped.
 *
 * Either arm alone marks the violation; checkerReason describes
 * which fired. No extra LLM call.
 *
 * Returns [] when:
 *   - finalText is empty
 *   - no successful tool observation exists (synthesis intent without
 *     tools is the model's free composition; this checker would only
 *     produce false positives)
 *   - every tool observation is below SYNTHESIS_MIN_OBSERVATION_CHARS
 *     (degenerate transcript — nothing material to synthesize from)
 *   - no arm fired (no raw dump AND shape markers present / not
 *     applicable)
 */
export function validateAnswerSynthesis(taskSpec, transcript = [], finalText = "") {
  const expected = taskSpec?.synthesis?.expected_output ?? null;
  const isSynthesisKind = typeof expected === "string" && SYNTHESIS_REQUIRED_OUTPUTS.has(expected);
  // Null / undefined / empty → IntentRoute never classified. Treat as
  // "synthesis-eligible by default" for the raw-dump arm.
  const isOutputUnclassified = expected === null
    || expected === undefined
    || (typeof expected === "string" && expected.trim().length === 0);
  const armOneEligible = isSynthesisKind || isOutputUnclassified;

  const final = String(finalText ?? "").trim();
  if (final.length === 0) return [];

  const toolResults = (transcript ?? []).filter(
    (e) => e?.type === "tool_result" && isSuccessfulHit(e)
  );
  if (toolResults.length === 0) return [];

  let maxOverlap = 0;
  let anySubstantialObservation = false;
  for (const r of toolResults) {
    const candidates = [
      String(r.observation ?? r.result ?? ""),
      compactMetadataForOverlap(r.metadata)
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (candidate.length < SYNTHESIS_MIN_OBSERVATION_CHARS) continue;
      anySubstantialObservation = true;
      const overlap = bigramOverlap(candidate, final);
      if (overlap > maxOverlap) maxOverlap = overlap;
    }
  }

  // No substantial observation → nothing to synthesize from; skip the
  // check rather than punish the model for a degenerate transcript.
  if (!anySubstantialObservation) return [];

  const finalLooksLikeRawList = /\n\s*(?:[-*]|\d+[.)、])\s+/.test(final);
  const finalLongEnoughForRawDump = final.length >= SYNTHESIS_MIN_FINAL_RAW_DUMP_CHARS
    || finalLooksLikeRawList;
  const isLikelyRawDump = armOneEligible
    && finalLongEnoughForRawDump
    && maxOverlap >= SYNTHESIS_OVERLAP_THRESHOLD;
  const missingExpectedTransformation = isSynthesisKind && !hasShapeMarker(expected, final);
  const unsynthesizedRecordList = detectUnsynthesizedRecordList(toolResults, expected, final);

  if (!isLikelyRawDump && !missingExpectedTransformation && !unsynthesizedRecordList) return [];

  const reasons = [];
  if (isLikelyRawDump) {
    reasons.push(`overlap_with_observation=${(maxOverlap * 100).toFixed(0)}%`);
  }
  if (missingExpectedTransformation) {
    reasons.push(`missing_${expected}_shape_markers`);
  }
  if (unsynthesizedRecordList) {
    reasons.push(`record_list_not_synthesized=${unsynthesizedRecordList.record_count}`);
  }
  const checkerReason = reasons.join("; ");

  const expectationLabel = isSynthesisKind
    ? (SHAPE_MARKERS[expected]?.description ?? "synthesis")
    : "synthesis (expected_output unclassified — defensive raw-dump arm)";
  const detail = isLikelyRawDump
    ? `final answer echoes raw tool observations (${(maxOverlap * 100).toFixed(0)}% bigram overlap)`
    : unsynthesizedRecordList
      ? `final answer mostly enumerates ${unsynthesizedRecordList.record_count} records instead of producing collection-level synthesis`
      : `final answer lacks ${expectationLabel}`;

  // P6 F3 followup A: when expected_output was not classified (SR
  // unavailable or skipped), expected_output stays null but the
  // raw-dump arm still applies. Synthesis-kind violations stay tagged
  // with the original `expected_output`; null cases get a synthetic
  // "raw_dump" label so the audit trail can distinguish "shape check
  // failed" from "defensive raw-dump fired without classification".
  return [{
    kind: "answer_not_synthesized",
    expected_output: expected ?? "raw_dump",
    isLikelyRawDump,
    missingExpectedTransformation,
    unsynthesizedRecordList: Boolean(unsynthesizedRecordList),
    checkerReason,
    message: isSynthesisKind
      ? `expected_output=${expected} requires synthesis: ${detail}.`
      : `final answer is a raw tool-observation echo (${(maxOverlap * 100).toFixed(0)}% bigram overlap); a synthesised reply is required.`
  }];
}

const LOCAL_EVENT_TOPIC_QUERY_RE = /(活动|展览|演出|音乐会|节日|赛事|events?|event\s+calendar|things\s+to\s+do|concerts?|festivals?)/iu;
const RECENT_OR_UPCOMING_QUERY_RE = /(最近|近期|本周|周末|this\s+week(?:end)?|upcoming|nearby)/iu;
const LOCALITY_QUERY_RE = /(我的城市|我这边|附近|当地|本地|near\s+me|my\s+city|local|nearby|in\s+[A-Z][A-Za-z .'-]{2,})/u;
const EVENT_DETAIL_RE = /(活动|展览|演出|音乐会|节日|赛事|event|concert|festival|show|market|exhibit|performance|game)/iu;
const DAY_LEVEL_DATE_RE = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*月\s*\d{1,2}\s*日|周[一二三四五六日天]|星期[一二三四五六日天]|\b(?:today|tomorrow|tonight|this\s+(?:week|weekend)|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday)\b)/iu;
const TIME_OR_VENUE_RE = /(\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|地点|场地|地址|venue| at | @ | arena|amphitheater|theatre|theater|center|centre|museum|park|hall|stadium|downtown|PNC|Red Hat)/iu;
const INSUFFICIENT_EVENT_ANSWER_RE = /(无法确定.*城市|还无法确定.*城市|没法直接告诉|没有直接列出具体的活动名称和日期|没有.*具体.*活动.*日期|建议.*访问.*活动日历|请告诉我你所在的城市|could not determine.*city|no concrete event names?|no specific event dates?|visit .*event calendar)/iu;

function eventQueryText(task = null) {
  const spec = task?.task_spec ?? {};
  return [
    task?.user_command,
    spec.user_goal_text,
    spec.topic,
    spec.goal,
    task?.context_packet?.text
  ].map((value) => String(value ?? "")).join("\n");
}

function isRecentLocalEventQuery(task = null) {
  const text = eventQueryText(task);
  if (!LOCAL_EVENT_TOPIC_QUERY_RE.test(text)) return false;
  return LOCALITY_QUERY_RE.test(text) || RECENT_OR_UPCOMING_QUERY_RE.test(text);
}

function hasExternalWebReadAttempt(transcript = []) {
  return (transcript ?? []).some((entry) =>
    entry?.type === "tool_result"
    && ["web_search", "web_search_fetch", "fetch_url_content"].includes(entry?.tool)
  );
}

function concreteEventDetailCount(finalText = "") {
  const lines = String(finalText ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?$/.test(line));
  let count = 0;
  for (const line of lines) {
    if (line.length < 12) continue;
    if (!EVENT_DETAIL_RE.test(line) && !TIME_OR_VENUE_RE.test(line)) continue;
    if (!DAY_LEVEL_DATE_RE.test(line)) continue;
    if (!TIME_OR_VENUE_RE.test(line)) continue;
    count += 1;
  }
  return count;
}

/**
 * Final-answer quality gates that need task context, not just TaskSpec.
 * These are deterministic "must not call this success" checks. They do not
 * rewrite the answer or special-case a sample prompt; they catch broad answer
 * contract failures such as current local-event answers with no dated events.
 */
export function validateFinalAnswerQuality({ task = null, transcript = [], finalText = "" } = {}) {
  const violations = [];
  const final = String(finalText ?? "").trim();
  if (!final) return violations;

  if (isRecentLocalEventQuery(task) && hasExternalWebReadAttempt(transcript)) {
    const concreteCount = concreteEventDetailCount(final);
    if (INSUFFICIENT_EVENT_ANSWER_RE.test(final) || concreteCount === 0) {
      violations.push({
        kind: "local_event_answer_lacks_concrete_events",
        message: "The user asked for recent/local events, but the final answer did not provide concrete dated event items with location/time evidence. It must be partial_success or ask for the missing location before spending tool calls.",
        concrete_event_detail_count: concreteCount
      });
    }
  }

  return violations;
}

/**
 * UCA-181: framework-level guard against fabricated action claims.
 *
 * Each entry binds a connector-write contract to the data needed to
 * audit a final answer:
 *
 *   - `group`: the policy_groups.mjs key whose members satisfy the
 *     contract. When the group exists in `POLICY_GROUPS`, membership
 *     is read from there (single source of truth — adding a new
 *     gmail/outlook tool to `email_send` automatically extends this
 *     guard with no code change).
 *
 *   - `claims`: regexes that match phrases asserting the action *was*
 *     performed. Past tense and completion verbs only — "I will send"
 *     / "可以使用 X 发送" must NOT match.
 *
 *   - `negations`: regexes that, when present in the same final text,
 *     suppress the claim (e.g. "邮件未发送", "not yet sent"). This
 *     prevents an honest "我没能发出邮件" answer from being flagged.
 *
 * Patterns live here (not in agent-loop) so tool_using and agentic
 * apply identical truthfulness rules. Both executors call
 * `detectUnbackedActionClaims` and prepend the resulting banner.
 */
const ACTION_CLAIM_GROUPS = Object.freeze([
  {
    group: "email_send",
    // All patterns require an email-context anchor (邮件 / email / mail /
    // an @-bearing recipient / 收件人). Without the anchor the
    // generic "已发送/sent" verbs collide with notification / file /
    // schedule claims (regression caught when adding Phase C: a real
    // notify success was wrongly flagged because email_send's first
    // pattern was matching "已发送通知").
    claims: [
      // 邮件 + (within 3 chars) + (optional 已/成功/顺利 marker) +
      // (within 3 chars) + 发送/发出/寄出. Tight gaps prevent matches
      // like "邮件内容已经整理好…的发送操作" where the verb is far
      // downstream and refers to a different noun.
      /邮件[\s\S]{0,3}?(?:已|成功|顺利)?[\s\S]{0,3}?(?:发送|发出|寄出)/,
      // 已 + (optional success marker) + verb-sending + (邮件 |
      // @email-target) within 12 chars. Stricter than the previous
      // 30-char window so it doesn't reach over a "通知" object.
      /(?:已|成功|顺利)\s*(?:成功|顺利)?\s*(?:发送|发出|寄出)[\s\S]{0,12}?(?:邮件|\S+@\S+\.\S+)/,
      // 邮件/email + 发送/寄出/发出 + 成功 (success acknowledgment)
      /(?:邮件|email)[\s\S]{0,8}?(?:发送|寄出|发出)\s*成功/i,
      // 已 + 发送/发出/寄出 + 至/到/给 + email-like target
      /(?:已|成功)\s*(?:发送|发出|寄出)\s*(?:至|到|给)\s*\S+@\S+/,
      /\bemail\s+(?:was|has been|is|got)\s+(?:successfully\s+)?sent\b/i,
      /\bi(?:\s+have\s+|['‘’]ve\s+|\s+)sent\s+(?:the\s+|an?\s+|my\s+)?email\b/i,
      /\bsent\s+(?:the\s+|an?\s+|my\s+|this\s+)?email\b/i,
      /\bsuccessfully\s+sent\s+(?:the\s+|an?\s+)?(?:email|mail)\b/i,
      /\bemail\s+(?:was|has been)\s+delivered\b/i
    ],
    negations: [
      /未\s*(?:发送|发出|寄出)|没\s*能?\s*(?:发送|发出|寄出)|无法\s*(?:发送|发出|寄出)|尚未\s*(?:发送|发出|寄出)|还(?:没|未)\s*(?:发送|发出|寄出)|(?:发送|发出|寄出)\s*失败|(?:发送|发出|寄出).{0,4}失败/,
      /(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+(?:successfully\s+)?(?:send|sent|deliver|delivered)/i,
      /not\s+yet\s+(?:sent|delivered)|prepared\s+but\s+not\s+(?:yet\s+)?(?:sent|delivered)/i,
      /邮件.{0,8}(?:还没|尚未|未真正|未实际|尚未真正).{0,8}(?:发出|发送)/
    ]
    // tool list is read from POLICY_GROUPS.email_send at runtime
  },
  {
    group: "calendar_create",
    claims: [
      /已\s*创建\s*(?:日程|会议|事件|提醒)/,
      /日程\s*已\s*创建|事件\s*已\s*创建/,
      /\bevent\s+(?:was|has been|is)\s+created\b/i,
      /\bcalendar\s+event\s+(?:has\s+been\s+)?created\b/i
    ],
    negations: [
      /未\s*创建|无法\s*创建|创建\s*失败/,
      /\b(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+create/i
    ]
  },
  {
    group: "file_upload",
    claims: [
      /已\s*上传/,
      /\buploaded\s+(?:successfully|the\s+file)?\b/i,
      /\bfile\s+(?:has\s+been\s+)?uploaded\b/i
    ],
    negations: [
      /未\s*上传|无法\s*上传|上传\s*失败/,
      /\b(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+upload/i
    ]
  },
  {
    group: "schedule_create",
    claims: [
      // 已[为你/帮你/成功/顺利] + 设置/创建/安排 + 好 + ... + 提醒/定时/任务/闹钟
      // Allow up to 30 chars between the verb and the schedule noun so the
      // typical "已为你设置好每天早上 8 点的提醒" form matches.
      /已\s*(?:为你|帮你)?\s*(?:成功|顺利)?\s*(?:设置|创建|安排|建立|添加|新建)\s*(?:好|了)?[\s\S]{0,30}?(?:提醒|定时|定时任务|计划任务|每\s*[日天周月]|每\s*\S{1,4}|闹钟)/,
      /(?:提醒|定时任务|计划任务|闹钟)\s*(?:已|成功)\s*(?:设置|创建|安排|建立)/,
      /(?:已|成功)\s*(?:为你|帮你)?\s*(?:设置|创建|安排)\s*(?:好|了)?\s*(?:每\s*\S{1,4}|定时|提醒)/,
      // English
      /\bi(?:\s+have\s+|['‘’]ve\s+|\s+)(?:set|created|scheduled|added)\s+(?:up\s+)?(?:a\s+|the\s+|an\s+|your\s+)?(?:reminder|schedule|scheduled\s+task|recurring\s+task|cron|alarm)\b/i,
      /\b(?:reminder|schedule|scheduled\s+task|cron\s+job|alarm)\s+(?:has\s+been\s+|was\s+|is\s+)(?:set|created|scheduled|added|configured)\b/i,
      /\bsuccessfully\s+(?:set|created|scheduled)\s+(?:a\s+|the\s+)?(?:reminder|schedule|task)\b/i
    ],
    negations: [
      /未\s*(?:设置|创建|安排)|没\s*(?:有)?\s*(?:设置|创建|安排)|无法\s*(?:设置|创建|安排)|尚未\s*(?:设置|创建|安排)|(?:设置|创建|安排)\s*失败/,
      /(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+(?:set|create|schedule|configure)/i,
      /not\s+yet\s+(?:set|created|scheduled)|prepared\s+but\s+not\s+(?:yet\s+)?(?:set|scheduled)/i
    ]
  },
  {
    // Claim-guard-only entries (Phase C): not promoted to a full
    // obligation because SR triggers are too ambiguous to require
    // them. The claim guard still catches hallucinated past-tense
    // "I modified the file" / "I opened Word" / "I notified you"
    // when no backing tool ran. Inline `tools` because POLICY_GROUPS
    // doesn't list these.
    group: "file_modify",
    claims: [
      // 已 + 修改/更新/编辑/改/重写 + 文件名 / 完毕 / 完成
      /已\s*(?:成功|顺利)?\s*(?:修改|更新|编辑|改写|重写|改了|改完)\s*(?:好|完|完毕|了)?(?:[\s\S]{0,40}?(?:\.md|\.txt|\.json|\.js|\.ts|\.py|\.html|\.css|\.yaml|\.yml|\.csv|文件|README|文档))?/,
      /(?:文件|文档|README)\s*(?:已|成功)\s*(?:修改|更新|编辑|改写|重写|保存)/,
      // English
      /\bi(?:\s+have\s+|['‘’]ve\s+|\s+)(?:modified|updated|edited|rewritten|saved|patched|changed)\s+(?:the\s+|your\s+|that\s+|this\s+|a\s+)?(?:file|README|document|config|script|code|content)\b/i,
      /\b(?:file|README|document|config|script)\s+(?:has\s+been\s+|was\s+|is\s+)(?:modified|updated|edited|rewritten|saved|patched)\b/i,
      /\bsuccessfully\s+(?:modified|updated|edited|saved|patched)\s+(?:the\s+|your\s+)?(?:file|README|document)\b/i
    ],
    negations: [
      /未\s*(?:修改|更新|编辑|改|保存)|无法\s*(?:修改|更新|编辑|改|保存)|(?:修改|更新|编辑|保存)\s*失败/,
      /(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+(?:modify|update|edit|save|patch|rewrite|change)/i,
      /not\s+yet\s+(?:modified|updated|edited|saved)|没\s*(?:有)?\s*(?:修改|更新|保存)/
    ],
    tools: [
      "edit_file",
      "write_file",
      "file_op",
      "generate_document"
    ]
  },
  {
    group: "app_launch",
    claims: [
      // 已[成功]打开/启动 + 不直接跟"文件"或常见"页面"等中性词
      /已\s*(?:成功|顺利)?\s*(?:打开|启动)\s*(?:好|了)?\s*(?!文件|页面|对话框|链接|链接\s|\s*[（(])/,
      /(?:打开|启动)\s*(?:好|了)\s*(?:应用|程序|软件)/,
      /\bi(?:\s+have\s+|['‘’]ve\s+|\s+)(?:opened|launched|started|fired\s+up)\s+(?:the\s+|your\s+|a\s+)?(?:app|application|program|browser|word|excel|powerpoint|outlook|slack|chrome|firefox|edge|safari)\b/i,
      /\b(?:app|application|program|window|browser)\s+(?:has\s+been\s+|was\s+|is\s+)(?:opened|launched|started)\b/i
    ],
    negations: [
      /未\s*(?:打开|启动)|无法\s*(?:打开|启动)|(?:打开|启动)\s*失败/,
      /(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+(?:open|launch|start|fire\s+up)/i,
      /not\s+yet\s+(?:opened|launched|started)/i
    ],
    tools: [
      "launch_app",
      "open_url"
    ]
  },
  {
    group: "notification_send",
    claims: [
      // 已通知你 / 通知已发送 / 已弹出通知
      // Excludes "通知" alone — must combine with a clear past-action verb.
      /已\s*(?:成功|顺利)?\s*(?:发送|弹出|推送|展示|显示)\s*(?:好|了)?\s*(?:通知|提示|消息|toast)/,
      /(?:通知|提示)\s*(?:已|成功)\s*(?:发送|弹出|推送|展示|显示)/,
      /\bi(?:\s+have\s+|['‘’]ve\s+|\s+)(?:sent|displayed|pushed|shown|fired|popped|raised)\s+(?:you\s+)?(?:a\s+|the\s+)?(?:notification|toast|alert|popup)\b/i,
      /\b(?:notification|toast|alert|popup)\s+(?:has\s+been\s+|was\s+|is\s+)(?:sent|displayed|shown|pushed|fired|raised)\b/i
    ],
    negations: [
      /未\s*(?:发送|弹出|推送|显示).{0,4}通知|无法\s*(?:发送|推送|弹出|显示).{0,4}通知|通知\s*(?:发送|推送|弹出)\s*失败/,
      /(?:not|hasn['']?t|wasn['']?t|couldn['']?t|failed\s+to)\s+(?:send|push|fire|display|raise)\s+(?:a\s+|the\s+)?(?:notification|toast|alert)/i
    ],
    tools: [
      "notify"
    ]
  }
]);

const ACTION_CLAIM_WORKFLOW_TOOL = "connector_workflow_run";

function resolveGroupTools(entry) {
  const fromGroup = toolsInGroup(entry.group);
  if (fromGroup.length > 0) return new Set(fromGroup);
  return new Set(entry.tools ?? []);
}

/**
 * Inspect the final answer text and the executor transcript. If the
 * final text claims a connector write action was performed but the
 * transcript contains no successful tool call from that action's
 * policy group, return a violation. Returns [] for honest answers.
 *
 * Used by both tool_using/agent-loop and agentic/planner so they
 * downgrade hallucinated "邮件已发送" / "event created" / "uploaded"
 * replies the same way.
 *
 * @param {TranscriptEntry[]} transcript
 * @param {string} finalText
 * @returns {ContractViolation[]}
 */
export function detectUnbackedActionClaims(transcript = [], finalText = "") {
  const text = String(finalText ?? "");
  if (!text) return [];
  const violations = [];
  for (const entry of ACTION_CLAIM_GROUPS) {
    const claimMatched = entry.claims.some((re) => re.test(text));
    if (!claimMatched) continue;
    const negationMatched = entry.negations.some((re) => re.test(text));
    if (negationMatched) continue;
    const tools = resolveGroupTools(entry);
    if (tools.size === 0) continue; // misconfigured entry — fail open
    const succeeded = (transcript ?? []).some((t) => {
      if (t?.type !== "tool_result") return false;
      if (!isSuccessfulHit(t)) return false;
      if (t.tool === ACTION_CLAIM_WORKFLOW_TOOL) {
        // Workflow runs only count when the connector actually reported
        // success. waiting_external_decision / failed must not satisfy.
        if (!tools.has(ACTION_CLAIM_WORKFLOW_TOOL)) return false;
        return t?.metadata?.connector_status === "success"
          && workflowMatchesActionGroup(entry.group, t);
      }
      return tools.has(t.tool);
    });
    if (!succeeded) {
      violations.push({
        kind: `${entry.group}_claim_unsupported`,
        message: `Final answer claims ${entry.group} was completed, but no tool in that policy group ran successfully. The text is a model fabrication, not a real execution result.`
      });
    }
  }
  return violations;
}

export function detectUnsatisfiedRequiredLinkAnswer(taskSpec = {}, transcript = [], finalText = "") {
  const text = String(finalText ?? "").trim();
  if (!text) return null;
  const command = String(taskSpec?.user_goal_text ?? taskSpec?.user_command ?? "");
  const requiredGroups = Array.isArray(taskSpec?.success_contract?.required_policy_groups)
    ? taskSpec.success_contract.required_policy_groups
    : [];
  const requiresExternal = requiredGroups.includes("external_web_read")
    || taskSpec?.tool_policy?.policy_groups?.external_web_read?.mode === "required";
  if (!requiresExternal) return null;
  if (!isConcreteLinkDeliveryRequest(command)) return null;

  const answerAdmitsUnsatisfied =
    /(无法|没能|未能|不能)[^。！？!?\n]{0,40}(抓到|获取|确认|列出|提供|找到)[^。！？!?\n]{0,40}(具体|公司|职位|岗位|薪资|申请)?[^。！？!?\n]{0,24}(链接|岗位|职位|报告|评级)/i.test(text)
    || /(请自行|你可以自己|建议你(?:可以)?(?:直接)?(?:访问|搜索|查找)|手动过一遍|自行在)/i.test(text)
    || /\b(?:could not|can't|cannot|unable to)\b[^.?!\n]{0,80}\b(?:specific|concrete|application|source|original)?\s*(?:links?|urls?|jobs?|reports?)\b/i.test(text);
  const urlCount = (text.match(/https?:\/\/[^\s)\]]+/gi) ?? []).length;
  if (!answerAdmitsUnsatisfied && urlCount > 0) return null;

  return {
    kind: "required_link_answer_not_satisfied",
    message: "The user asked for concrete source/application links, but the final answer admits that it did not provide the requested links. This must be partial_success rather than success."
  };
}

function isConcreteLinkDeliveryRequest(text = "") {
  const raw = String(text ?? "");
  if (!raw) return false;
  return /(申请链接|原文链接|资料链接|来源链接|职位链接|岗位链接|报告链接|把.*链接.*列|列出.*链接|给出.*链接|给.*链接|links?\s+(?:for|to|with|listed|only)|application\s+links?|source\s+links?|original\s+links?)/i.test(raw);
}

/**
 * @typedef {Object} TranscriptEntry
 * @property {string} [type]              - "tool_call" | "tool_result" | ...
 * @property {string} [tool]              - tool id when applicable
 * @property {*}      [result]            - tool result body (shape varies)
 * @property {string} [observation]       - some executors store the rendered
 *                                          observation text instead of result
 */

/**
 * @typedef {Object} ContractViolation
 * @property {string} kind     - machine-readable code (e.g. "web_search_required_not_called")
 * @property {string} message  - human-readable message for the user
 */

/**
 * @typedef {"continue"|"retry"|"escalate"|"abort"} StepNextAction
 *
 * @typedef {Object} StepGateResult
 * @property {boolean}             satisfied
 * @property {ContractViolation[]} violations
 * @property {StepNextAction}      next_action
 */

/**
 * @param {object} taskSpec
 * @param {TranscriptEntry[]} transcript
 * @returns {{ satisfied: boolean, violations: ContractViolation[] }}
 */
export function validateSuccessContract(taskSpec, transcript = []) {
  const violations = [];

  // P4-00.7: required policy groups. The LLM may call ANY tool in the
  // group to satisfy the requirement — that's the whole point of the
  // group abstraction (LLM can pick the most appropriate sibling — e.g.
  // fetch_url_content when web_search_fetch returned nothing).
  //
  // P4-00.7 revised (§18.6.1.B): hits are filtered to drop entries that
  // FAILED at the tool layer. Without this, a `web_search_fetch` call
  // blocked by the registry policy guard returns a long observation
  // explaining the block ("Tool ... is forbidden by task policy: ...")
  // and `resultHasSubstance` happily accepts it as substance. That gave
  // the validator's `satisfied=true` for tasks that never actually
  // touched the open web. We now fail closed: an entry only counts if
  // it ran successfully (no entry.error, no entry.success === false).
  const requiredGroups = Array.isArray(taskSpec?.success_contract?.required_policy_groups)
    ? taskSpec.success_contract.required_policy_groups
    : [];
  const actionObligationByGroup = new Map(
    evaluateActionObligations(taskSpec, transcript).map((obligation) => [obligation.group, obligation])
  );
  for (const group of requiredGroups) {
    const members = toolsInGroup(group);
    if (members.length === 0) continue;
    if (ACTION_OBLIGATION_GROUPS.includes(group)) {
      const obligation = actionObligationByGroup.get(group);
      if (!obligation) continue;
      if (["satisfied", "blocked_missing_input", "abandoned_with_reason"].includes(obligation.status)) {
        continue;
      }
      if (obligation.status === "waiting_approval") {
        violations.push({
          kind: `${group}_required_waiting_confirmation`,
          message: `success_contract.required_policy_groups includes "${group}"; the connector/tool prepared the action but is still waiting for user confirmation.`
        });
        continue;
      }
      violations.push({
        kind: `${group}_required_not_called`,
        message: `success_contract.required_policy_groups includes "${group}" but the executor never invoked any of: ${members.join(", ")}.`
      });
      continue;
    }
    const memberSet = new Set(members);
    const allCalls = (transcript ?? []).filter(
      (entry) => entry?.type === "tool_result" && memberSet.has(entry?.tool)
    );
    const successfulHits = allCalls.filter(isSuccessfulHit);
    if (group === LOCAL_FILE_TEXT_READ_GROUP) {
      const violation = validateLocalFileTextReadRequirement({
        taskSpec,
        members,
        allCalls,
        successfulHits
      });
      if (violation) violations.push(violation);
      continue;
    }
    if (successfulHits.length === 0) {
      // Distinguish "never called" from "called but every call failed" so
      // the user / audit log can see what actually went wrong.
      const kind = allCalls.length === 0
        ? `${group}_required_not_called`
        : `${group}_required_all_failed`;
      const message = allCalls.length === 0
        ? `success_contract.required_policy_groups includes "${group}" but the executor never invoked any of: ${members.join(", ")}.`
        : `success_contract.required_policy_groups includes "${group}"; tools were called (${allCalls.map((h) => h.tool).join(", ")}) but every call failed (errors: ${allCalls.map((h) => h.error ?? "(none)").join(", ")}).`;
      violations.push({ kind, message });
      continue;
    }
    if (!successfulHits.some((hit) => groupHitSatisfies(group, hit))) {
      violations.push({
        kind: `${group}_required_returned_empty`,
        message: `success_contract.required_policy_groups includes "${group}"; tools succeeded (${successfulHits.map((h) => h.tool).join(", ")}) but none returned usable results.`
      });
    }
  }

  const requiredToolNames = Array.isArray(taskSpec?.success_contract?.required_tool_names)
    ? [...new Set(taskSpec.success_contract.required_tool_names.map((name) => String(name ?? "").trim()).filter(Boolean))]
    : [];
  for (const toolName of requiredToolNames) {
    const allCalls = (transcript ?? []).filter(
      (entry) => entry?.type === "tool_result" && entry?.tool === toolName
    );
    const successfulHits = allCalls.filter(isSuccessfulHit);
    if (successfulHits.length > 0) continue;
    const kind = allCalls.length === 0
      ? `${toolName}_required_not_called`
      : `${toolName}_required_all_failed`;
    const message = allCalls.length === 0
      ? `success_contract.required_tool_names includes "${toolName}" but the executor never invoked it successfully.`
      : `success_contract.required_tool_names includes "${toolName}"; the tool was called but every call failed (errors: ${allCalls.map((h) => h.error ?? h.result?.error ?? "(none)").join(", ")}).`;
    violations.push({ kind, message });
  }

  // P4-RQ D3: research_quality coverage enforcement. Only fires when
  // the task is multi_source_research AND external_web_read is
  // already on required_policy_groups (i.e. web mode is "required").
  // For "optional" tasks we don't force coverage — the user didn't
  // ask for hard external research.
  for (const v of checkResearchCoverage(taskSpec, transcript, requiredGroups)) {
    violations.push(v);
  }

  if (requiresArtifactCreated(taskSpec) && !transcriptHasArtifactCreated(transcript)) {
    const kind = artifactKindFromSpec(taskSpec) || "artifact";
    violations.push({
      kind: "artifact_required_not_created",
      message: `success_contract.artifact_created is true, but no ${kind} artifact was created or registered. The executor must call an artifact-producing tool before finalizing.`
    });
  } else if (requiresArtifactCreated(taskSpec)) {
    const kind = artifactKindFromSpec(taskSpec);
    if (kind && !transcriptHasArtifactKind(transcript, kind)) {
      violations.push({
        kind: "artifact_required_kind_mismatch",
        message: `success_contract.artifact_created requires a ${kind} artifact, but the created artifact paths/metadata do not match that kind.`
      });
    }
    for (const requiredKind of artifactRequiredKindsFromSpec(taskSpec).filter((item) => item !== kind)) {
      if (requiredKind && !transcriptHasArtifactKind(transcript, requiredKind)) {
        violations.push({
          kind: "artifact_required_kind_mismatch",
          message: `success_contract.artifact_created requires a ${requiredKind} artifact from artifact.required_kinds, but the created artifact paths/metadata do not match that kind.`
        });
      }
    }
  }

  if (requiresGeneratedScriptExecution(taskSpec)
      && transcriptHasArtifactCreated(transcript)
      && !transcriptHasGeneratedScriptExecution(taskSpec, transcript)) {
    violations.push({
      kind: "generated_script_file_not_executed",
      message: "success_contract.generated_script_execution_required is true, but run_script did not reference the generated script artifact path or filename. Execute the real file created on disk, not equivalent inline code."
    });
  }

  return { satisfied: violations.length === 0, violations };
}

/**
 * P4-RQ D3: enforce research_quality thresholds against the
 * transcript's evidence. Three new violation kinds:
 *
 *   - external_web_read_insufficient_sources
 *     source_count < min_sources
 *
 *   - external_web_read_single_domain_only
 *     distinct_domain_count < min_distinct_domains
 *
 *   - external_web_read_single_roundup_only
 *     evidence.is_single_roundup AND
 *     research_quality.single_source_digest_satisfies === false
 *     (the more specific "the one publisher you found is a roundup
 *     page, you need actual independent sources" violation)
 *
 * Only runs when:
 *   - task_spec.research_quality is non-null
 *   - profile is "multi_source_research" (single_lookup is 1/1/true,
 *     so the per-group "succeeded with substance" check is enough)
 *   - external_web_read is in required_policy_groups (i.e. web mode
 *     was "required" — we don't enforce coverage on optional tasks)
 *
 * If the per-group hit-count check above already failed (no
 * successful hits or returned-empty), running coverage on top would
 * just stack noise. We still check, because the violations are
 * orthogonal: "0 hits" vs "1 hit but only 1 publisher" tell the
 * operator different things.
 */
function checkResearchCoverage(taskSpec, transcript, requiredGroups) {
  const rq = taskSpec?.research_quality;
  if (!rq || typeof rq !== "object") return [];
  // K3: deep_research is a stricter sibling of multi_source_research —
  // same shape (numerical thresholds + roundup rejection), only the
  // numbers differ. Both go through the same coverage check.
  if (rq.profile !== "multi_source_research" && rq.profile !== "deep_research") return [];
  if (!Array.isArray(requiredGroups) || !requiredGroups.includes("external_web_read")) return [];

  const evidence = extractEvidence(transcript);
  const violations = [];

  // Roundup gets its own (more specific) violation BEFORE the
  // generic single_domain_only — the runbook recovery is different
  // ("broaden the query" vs "find another source") so we want the
  // sharper signal first when both apply. Violation messages use the
  // active profile name so the user sees the real bar
  // ("deep_research requires ..." vs "multi_source_research requires ...").
  const profileLabel = rq.profile;
  const sourceCount = evidence.source_count;
  const originCount = evidence.distinct_domain_count;
  const indexedCount = evidence.indexed_file_source_count ?? 0;
  const localLabel = evidence.local_source_count > 0 || indexedCount > 0
    ? `; local evidence observed separately (${evidence.local_source_count} fresh local + ${indexedCount} indexed file)`
    : "";

  if (evidence.is_single_roundup
      && rq.single_source_digest_satisfies === false) {
    violations.push({
      kind: "external_web_read_single_roundup_only",
      message: `${profileLabel} does not accept a single-publisher roundup/digest as evidence (domain=${evidence.domains.join(", ")}, markers matched: ${evidence.roundup_markers.join(", ")}).`
    });
  } else if (originCount < rq.min_distinct_domains) {
    violations.push({
      kind: "external_web_read_single_domain_only",
      message: `${profileLabel} requires at least ${rq.min_distinct_domains} distinct web domains; got ${originCount} web domain(s) (${evidence.domains.join(", ") || "none"}${localLabel}). Local files can inform synthesis but cannot satisfy external web-source coverage.`
    });
  }

  if (sourceCount < rq.min_sources) {
    violations.push({
      kind: "external_web_read_insufficient_sources",
      message: `${profileLabel} requires at least ${rq.min_sources} distinct web sources; got ${sourceCount} web source(s) (${evidence.local_source_count ?? 0} fresh local + ${indexedCount} indexed file observed separately). Local files can inform synthesis but cannot satisfy external web-source coverage.`
    });
  }

  return violations;
}

/**
 * A transcript entry "counts" toward satisfying a requirement only if the
 * tool actually ran successfully. Failed/blocked/errored calls leave a
 * record but don't move the success contract forward.
 *
 * Inspects every signal the registry sets on a failure:
 *   - `entry.success === false`  (canonical: createActionResult sets this)
 *   - `entry.error`              (canonical: blocked_by_policy / rate_limited)
 *   - `entry.result?.success === false`  (legacy adapters that wrap result)
 *   - `entry.result?.error`              (legacy adapters that wrap error)
 *
 * Defaults to "successful" only when nothing on the entry flags a failure
 * — fail-closed is wrong here (we'd miss legitimate successes from
 * adapters that just don't set `success`); fail-open is also wrong (the
 * §18.6.1.B bug). The compromise: any explicit failure signal disqualifies
 * the entry; everything else counts.
 *
 * @param {object} entry
 * @returns {boolean}
 */
function isSuccessfulHit(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.success === false) return false;
  if (entry.error != null && entry.error !== "") return false;
  const result = entry.result;
  if (result && typeof result === "object") {
    if (result.success === false) return false;
    if (result.error != null && result.error !== "") return false;
  }
  return true;
}

function groupHitSatisfies(group, entry) {
  if (ACTION_OBLIGATION_GROUPS.includes(group)) {
    return actionGroupHitSatisfies(group, entry);
  }
  return resultHasSubstance(entry);
}

function requiresArtifactCreated(taskSpec) {
  return taskSpec?.success_contract?.artifact_created === true
    || taskSpec?.artifact?.required === true
    || taskSpec?.contract?.output_contract?.artifact_required === true;
}

const METADATA_PATH_ARTIFACT_TOOLS = new Set([
  "generate_document",
  "write_file",
  "edit_file",
  "render_diagram",
  "render_svg",
  "register_artifact"
]);

function artifactToolIdFromEntry(entry = {}) {
  return String(entry?.tool
    ?? entry?.metadata?.tool_id
    ?? entry?.result?.metadata?.tool_id
    ?? entry?.result?.tool_id
    ?? "").trim();
}

function metadataPathCanRepresentArtifact(entry = {}) {
  if (entry?.type === "artifact_created") return true;
  return METADATA_PATH_ARTIFACT_TOOLS.has(artifactToolIdFromEntry(entry));
}

function artifactPathsFromEntry(entry = {}) {
  const paths = [];
  if (Array.isArray(entry.artifact_paths)) paths.push(...entry.artifact_paths);
  if (Array.isArray(entry.artifacts)) paths.push(...entry.artifacts);
  if (Array.isArray(entry.result?.artifact_paths)) paths.push(...entry.result.artifact_paths);
  if (Array.isArray(entry.result?.artifacts)) paths.push(...entry.result.artifacts);
  if (metadataPathCanRepresentArtifact(entry)) {
    if (typeof entry.path === "string" && entry.path.trim()) paths.push(entry.path);
    if (typeof entry.result?.path === "string" && entry.result.path.trim()) paths.push(entry.result.path);
    if (typeof entry.metadata?.path === "string" && entry.metadata.path.trim()) paths.push(entry.metadata.path);
  }
  return paths.filter((value) => typeof value === "string" && value.trim());
}

function transcriptHasArtifactCreated(transcript = []) {
  return (transcript ?? []).some((entry) => {
    if (!isSuccessfulHit(entry)) return false;
    if (entry?.type === "artifact_created") return artifactPathsFromEntry(entry).length > 0;
    if (entry?.type === "tool_result") return artifactPathsFromEntry(entry).length > 0;
    return artifactPathsFromEntry(entry).length > 0;
  });
}

function artifactKindFromSpec(taskSpec = {}) {
  return String(taskSpec?.artifact?.kind
    ?? taskSpec?.contract?.output_contract?.kind
    ?? "").trim().toLowerCase();
}

function artifactRequiredKindsFromSpec(taskSpec = {}) {
  const kinds = Array.isArray(taskSpec?.artifact?.required_kinds)
    ? taskSpec.artifact.required_kinds
    : [];
  return [...new Set(kinds
    .map((kind) => String(kind ?? "").trim().toLowerCase())
    .filter(Boolean))];
}

function artifactPathMatchesKind(filePath = "", kind = "") {
  const normalized = String(kind ?? "").trim().toLowerCase();
  if (!normalized) return true;
  const lower = String(filePath ?? "").trim().toLowerCase();
  if (!lower) return false;
  if (normalized === "word") return lower.endsWith(".docx");
  if (normalized === "excel") return lower.endsWith(".xlsx");
  if (normalized === "ppt" || normalized === "powerpoint") return lower.endsWith(".pptx");
  if (normalized === "js" || normalized === "javascript") {
    return [".js", ".mjs", ".cjs", ".jsx"].some((extension) => lower.endsWith(extension));
  }
  return lower.endsWith(`.${normalized}`);
}

function artifactKindsMatch(actualKind = "", requiredKind = "") {
  const actual = String(actualKind ?? "").trim().toLowerCase();
  const required = String(requiredKind ?? "").trim().toLowerCase();
  if (!required) return true;
  if (!actual) return false;
  if (actual === required) return true;
  if ((required === "js" || required === "javascript") && ["js", "mjs", "cjs", "jsx", "javascript"].includes(actual)) {
    return true;
  }
  return false;
}

function entryMatchesArtifactKind(entry = {}, kind = "") {
  const normalized = String(kind ?? "").trim().toLowerCase();
  if (!normalized) return true;
  const metadataKind = String(entry?.metadata?.kind
    ?? entry?.metadata?.artifact_kind
    ?? entry?.result?.kind
    ?? entry?.result?.artifact_kind
    ?? "").trim().toLowerCase();
  if (metadataKind && artifactKindsMatch(metadataKind, normalized)) return true;
  return artifactPathsFromEntry(entry).some((filePath) => artifactPathMatchesKind(filePath, normalized));
}

function transcriptHasArtifactKind(transcript = [], kind = "") {
  return (transcript ?? []).some((entry) => {
    if (!isSuccessfulHit(entry)) return false;
    if (artifactPathsFromEntry(entry).length === 0) return false;
    return entryMatchesArtifactKind(entry, kind);
  });
}

const SCRIPT_ARTIFACT_KINDS = new Set(["mjs", "js", "javascript", "cjs", "jsx", "py", "ps1"]);

function requiresGeneratedScriptExecution(taskSpec = {}) {
  return taskSpec?.success_contract?.generated_script_execution_required === true;
}

function scriptArtifactPathsFromTranscript(taskSpec = {}, transcript = []) {
  const requiredKinds = [
    artifactKindFromSpec(taskSpec),
    ...artifactRequiredKindsFromSpec(taskSpec)
  ].filter((kind) => SCRIPT_ARTIFACT_KINDS.has(kind));
  const kinds = requiredKinds.length > 0 ? requiredKinds : [...SCRIPT_ARTIFACT_KINDS];
  const paths = [];
  for (const entry of transcript ?? []) {
    if (!isSuccessfulHit(entry)) continue;
    const entryPaths = artifactPathsFromEntry(entry);
    if (entryPaths.length === 0) continue;
    if (!kinds.some((kind) => entryMatchesArtifactKind(entry, kind))) continue;
    paths.push(...entryPaths.filter((filePath) =>
      kinds.some((kind) => artifactPathMatchesKind(filePath, kind))
    ));
  }
  return [...new Set(paths)];
}

function normalizePathNeedle(value = "") {
  return String(value ?? "")
    .replace(/\\/gu, "/")
    .toLowerCase();
}

function runScriptArgsText(entry = {}) {
  const args = entry?.args ?? entry?.arguments ?? entry?.result?.args ?? {};
  try {
    return JSON.stringify(args);
  } catch {
    return String(args ?? "");
  }
}

function transcriptHasGeneratedScriptExecution(taskSpec = {}, transcript = []) {
  const scriptPaths = scriptArtifactPathsFromTranscript(taskSpec, transcript);
  if (scriptPaths.length === 0) return false;
  const needles = scriptPaths.flatMap((filePath) => [
    normalizePathNeedle(filePath),
    normalizePathNeedle(path.basename(filePath))
  ]).filter(Boolean);
  return (transcript ?? []).some((entry) => {
    if (entry?.type !== "tool_result" || entry?.tool !== "run_script" || !isSuccessfulHit(entry)) return false;
    const haystack = normalizePathNeedle(runScriptArgsText(entry));
    return needles.some((needle) => haystack.includes(needle));
  });
}

function researchQualityThresholds(rq) {
  if (!rq || typeof rq !== "object") return null;
  const minSources = Number(rq.min_sources);
  const minDomains = Number(rq.min_distinct_domains);
  if (!Number.isFinite(minSources) || !Number.isFinite(minDomains)) return null;
  return {
    minSources,
    minDomains
  };
}

function isLooserResearchQuality(candidate, base) {
  const candidateThresholds = researchQualityThresholds(candidate);
  const baseThresholds = researchQualityThresholds(base);
  if (!candidateThresholds || !baseThresholds) return false;
  return candidateThresholds.minSources <= baseThresholds.minSources
    && candidateThresholds.minDomains <= baseThresholds.minDomains;
}

export function selectSuccessContractValidationSpec(task) {
  const initial = task?.task_spec_initial ?? null;
  const current = task?.task_spec ?? null;
  const base = initial ?? current;
  if (!base || !current || current === base) return base;

  const next = { ...base };
  if (isLooserResearchQuality(current.research_quality, base.research_quality)) {
    next.research_quality = current.research_quality;
  }
  return next;
}

function requiresDeepLocalTextRead(taskSpec) {
  return taskSpec?.file_read?.depth === "deep";
}

function metadataOfToolHit(entry) {
  if (entry?.metadata && typeof entry.metadata === "object") return entry.metadata;
  if (entry?.result?.metadata && typeof entry.result.metadata === "object") return entry.result.metadata;
  return {};
}

function localFileTextReadHitSatisfies(entry, taskSpec) {
  const metadata = metadataOfToolHit(entry);
  if (metadata.content_extracted !== true) return false;
  const scope = metadata.coverage_scope;
  if (requiresDeepLocalTextRead(taskSpec)) {
    return deepLocalFileTextReadHitSatisfies(metadata, taskSpec);
  }
  return isFileTextCoverageScope(scope);
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function countSuccessfulFiles(metadata) {
  const direct = numberOrNull(metadata?.files_read);
  if (direct != null) return direct;
  const files = Array.isArray(metadata?.files) ? metadata.files : [];
  return files.filter((file) => file?.success !== false).length;
}

function deepLocalFileTextReadHitSatisfies(metadata, taskSpec) {
  if (!isDeepFileTextCoverageScope(metadata.coverage_scope)) return false;
  if (metadata.recursive !== true) return false;
  if (countSuccessfulFiles(metadata) <= 0) return false;
  if (metadata.coverage_complete === true) return true;
  if (metadata.truncated === true) return false;
  if (metadata.file_limit_hit === true || metadata.depth_limit_hit === true) return false;

  const requiredDepth = numberOrNull(taskSpec?.file_read?.max_depth);
  const actualDepth = numberOrNull(metadata.max_depth);
  if (requiredDepth != null && actualDepth != null && actualDepth < requiredDepth) return false;

  return true;
}

function validateLocalFileTextReadRequirement({ taskSpec, members, allCalls, successfulHits }) {
  if (successfulHits.length === 0) {
    const kind = allCalls.length === 0
      ? `${LOCAL_FILE_TEXT_READ_GROUP}_required_not_called`
      : `${LOCAL_FILE_TEXT_READ_GROUP}_required_all_failed`;
    const message = allCalls.length === 0
      ? `success_contract.required_policy_groups includes "${LOCAL_FILE_TEXT_READ_GROUP}" but the executor never invoked any of: ${members.join(", ")}.`
      : `success_contract.required_policy_groups includes "${LOCAL_FILE_TEXT_READ_GROUP}"; tools were called (${allCalls.map((h) => h.tool).join(", ")}) but every call failed (errors: ${allCalls.map((h) => h.error ?? "(none)").join(", ")}).`;
    return { kind, message };
  }

  if (successfulHits.some((hit) => localFileTextReadHitSatisfies(hit, taskSpec))) {
    return null;
  }

  const deep = requiresDeepLocalTextRead(taskSpec);
  return {
    kind: deep
      ? `${LOCAL_FILE_TEXT_READ_GROUP}_required_deep_insufficient`
      : `${LOCAL_FILE_TEXT_READ_GROUP}_required_no_fresh_text`,
    message: deep
      ? `success_contract.required_policy_groups includes "${LOCAL_FILE_TEXT_READ_GROUP}" and file_read.depth=deep; tools succeeded (${successfulHits.map((h) => h.tool).join(", ")}) but none produced complete recursive folder text coverage.`
      : `success_contract.required_policy_groups includes "${LOCAL_FILE_TEXT_READ_GROUP}"; tools succeeded (${successfulHits.map((h) => h.tool).join(", ")}) but none produced fresh local file text. Indexed search, listing, and metadata do not satisfy this contract.`
  };
}

/**
 * UCA-077 P4-08 (main plan §16.5 / §18.4): per-step phase gate.
 *
 * Where `validateSuccessContract` is the FINALIZE gate (called once at
 * task end), `validateStepGate` is the IN-LOOP gate the agent loop
 * calls after each tool_call_completed. It surfaces failure patterns
 * early and returns a `next_action` hint so the loop can decide:
 *
 *   - `continue`  no problem detected (or contract just got satisfied)
 *   - `retry`     last tool call failed once — let the model try again
 *   - `escalate`  same tool failed multiple times, OR contract is
 *                 unreachable from the current executor → caller
 *                 should switch executor / upgrade policy / hand off
 *                 to runbook (P4-RB)
 *   - `abort`     out of iterations and contract still not met →
 *                 downgrade to partial_success and stop
 *
 * Pre-this-gate the tool loop ran the full maxIterations even when the
 * same web_search_fetch was failing four turns in a row. The phase
 * gate detects that pattern at iteration 2 and signals escalate; the
 * loop can then break out and (with P4-08 step 2 wiring) trigger the
 * SemanticRouter re-judgment / executor upgrade flow.
 *
 * Pure function — same inputs, same output. No side effects, no audit
 * writes. Caller decides what to do with `next_action`.
 *
 * @param {object} taskSpec
 * @param {TranscriptEntry[]} transcript
 * @param {{ iteration?: number, maxIterations?: number, perToolFailureThreshold?: number }} [options]
 * @returns {StepGateResult}
 */
export function validateStepGate(taskSpec, transcript = [], options = {}) {
  const iteration = Number.isFinite(options.iteration) ? options.iteration : 0;
  const maxIterations = Number.isFinite(options.maxIterations) ? options.maxIterations : 8;
  const perToolFailureThreshold = Number.isFinite(options.perToolFailureThreshold)
    ? options.perToolFailureThreshold
    : 2;

  // 1. Cheap early-out: if the finalize gate would already pass, the
  //    current iteration is on track. Just continue.
  const finalGate = validateSuccessContract(taskSpec, transcript);
  if (finalGate.satisfied) {
    return { satisfied: true, violations: [], next_action: "continue" };
  }

  // 2. About to hit the iteration ceiling. Anything not satisfied at
  //    iteration N-1 will not be satisfied at N either; abort and let
  //    the caller mark partial_success.
  if (iteration >= maxIterations - 1) {
    return {
      satisfied: false,
      violations: finalGate.violations,
      next_action: "abort"
    };
  }

  // 3. Examine the transcript tail for a same-tool failure streak. We
  //    only count CONSECUTIVE failures of the SAME tool from the end
  //    — a different-tool retry breaks the streak (the agent is
  //    actually exploring alternatives).
  const toolResults = (transcript ?? []).filter((e) => e?.type === "tool_result");
  if (toolResults.length === 0) {
    return { satisfied: false, violations: finalGate.violations, next_action: "continue" };
  }
  const lastResult = toolResults[toolResults.length - 1];
  if (isSuccessfulHit(lastResult)) {
    // Last call succeeded but contract still not met — agent is making
    // progress, let it keep going.
    return { satisfied: false, violations: finalGate.violations, next_action: "continue" };
  }

  let consecutiveFailures = 0;
  for (let i = toolResults.length - 1; i >= 0; i -= 1) {
    const r = toolResults[i];
    if (r?.tool !== lastResult.tool) break;
    if (isSuccessfulHit(r)) break;
    consecutiveFailures += 1;
  }

  if (consecutiveFailures >= perToolFailureThreshold) {
    return {
      satisfied: false,
      violations: [
        ...finalGate.violations,
        {
          kind: "tool_repeated_failure",
          message: `${lastResult.tool} failed ${consecutiveFailures} consecutive times — escalating to a different approach.`
        }
      ],
      next_action: "escalate"
    };
  }

  // Single failure (or first failure of a new tool). Let the agent
  // try one more time before we escalate. This also covers the
  // "called something else first, then failed once" flow.
  return {
    satisfied: false,
    violations: finalGate.violations,
    next_action: "retry"
  };
}

function resultHasSubstance(entry) {
  if (entry?.tool === "fetch_url_content"
      && entry?.metadata?.content_quality
      && entry.metadata.content_quality.usable === false) {
    return false;
  }
  // web_search_fetch returns results in different shapes depending on the
  // provider. Accept any of: a non-empty `results`/`sources` array, a
  // non-empty `observation` string, or any non-trivial nested data.
  const result = entry?.result ?? null;
  if (Array.isArray(result?.results) && result.results.length > 0) return true;
  if (Array.isArray(result?.sources) && result.sources.length > 0) return true;
  if (typeof entry?.observation === "string" && entry.observation.trim().length > 32) return true;
  if (result && typeof result === "object") {
    for (const value of Object.values(result)) {
      if (Array.isArray(value) && value.length > 0) return true;
      if (typeof value === "string" && value.trim().length > 32) return true;
    }
  }
  return false;
}
