# Semantic Router Re-layering Plan

## Summary

This document is the handoff plan for the next Semantic Router upgrade. The goal is to stop solving routing regressions by adding topic-specific regular expressions and instead move search, URL, news, open-source discovery, and research requests into a generalized Semantic Router + EvidencePolicy flow.

The system should treat regex as surface-signal detection only. Regex should not decide the user's true intent, final source mode, research depth, executor, or answer format.

## 1. Core Direction

- Regex only detects surface hard signals; it must not decide user intent.
- SemanticRouter classifies meaning.
- EvidencePolicy decides external search, citations, multi-source quality, and tool requirements.
- SuccessContract and PhaseGate enforce deterministic completion standards.
- Scheduler is only a trigger; it must not contain news/search special cases.

## 2. Required Architecture Change

Hard signals should keep only structural and safety-relevant facts:

- URL mentions.
- Attachments and file references.
- Explicit search / no-search requests.
- Time-sensitive terms.
- External side effects.
- Destructive or risky actions.

Do not add more topic/domain regex to cover cases like news, open-source projects, tech news, URL summaries, market scans, product comparisons, or research tasks.

SemanticRouter output should expand toward this structured shape:

- `primary_intent`
- `expected_output`
- `needs_external_info`
- `needs_current_information`
- `needs_citations`
- `needs_tool_use`
- `source_mode`
- `external_search`
- `min_sources`
- `min_distinct_domains`
- `freshness_requirement`
- `confidence`
- `brief_rationale`

EvidencePolicy should be merged from SemanticRouter output plus hard signals, then become the source of truth for:

- `tool_policy`
- `research_quality`
- `success_contract.required_policy_groups`

## 3. Concrete Fixes Needed

- `查一下有没有类似的开源项目` should route to `external_search=required` and `source_mode=multi_source_research`.
- `research today's tech news` should route to required + multi-source without adding English topic regex patches.
- `总结这个 URL: https://...` should route to required + single_lookup and allow `fetch_url_content`.
- Local selections, uploaded files, and explicit "只基于这篇内容" requests should route to provided-context or single_lookup and should not require multi-source research.
- Explicit "不联网 / do not browse" must override the router and force `external_search=forbidden`.

## 4. Validation

For `multi_source_research`:

- `min_sources=3`
- `min_distinct_domains=2`
- A single roundup/digest page does not satisfy the contract.

For `single_lookup`:

- `min_sources=1`
- `min_distinct_domains=1`

Required outcomes:

- A ScienceNet single-source roundup must fail under `multi_source_research`.
- Three cross-domain sources must pass.
- Optional search should not force multi-source validation.
- Required search should enter SuccessContract coverage enforcement.

## Test Plan

Add SemanticRouter fixtures for:

- `今天有什么 AI 新闻`
- `查一下有没有类似的开源项目`
- `research today's tech news`
- `总结这个 URL: https://example.com/a`
- `只基于这篇文章总结`
- `不要联网，解释一下 X`

Add policy merge tests:

- Explicit no-search beats router required.
- Explicit search beats router optional.
- Single URL summary becomes required + single_lookup.

Add SuccessContract tests:

- Single-domain roundup fails under multi-source.
- Three URLs across at least two domains pass.
- One URL passes under single_lookup.

## Assumptions

- File name: `SEMANTIC_ROUTER_RE_LAYERING_PLAN.md`.
- Keep existing P4 guardrails: registry guard, policy groups, SuccessContract, PhaseGate, and Runbook.
- Do not touch `src/service/executors/kimi/output-format.mjs`.
- Do not solve this by expanding regex lists.

## E3 Audit — explicit-entity.mjs (synced from `~/.claude/plans/p4-03-p4-02-goofy-forest.md`)

Scope: `src/service/core/intent/signals/explicit-entity.mjs` PATTERN
groups + their consumers, evaluated against the directive "do not
add topic-domain regex". User has chosen Option C below.

### Consumption survey

- `policy/tool-policy-resolver.mjs:90` — sole behavioural consumer.
  Strong + scope=none → web=required. **The escalation point that C
  removes.**
- `policy/tool-policy-resolver.mjs shouldConsultSemanticRouter` —
  strong → SKIP SR (latency optimisation). **C drops this skip.**
- `core/contracts/task-contract.mjs:191` — adds 0.15 to contract
  confidence. Cosmetic / observability only.
- `core/contracts/risk-register.mjs:272` — RAID flag.
- `core/task-spec.mjs:183, 615` — collected into evidence list for
  goal classification.
- `router/fast-path-router.mjs` — **does NOT consume**
  `explicit_entity`. There is no tier-0 fast path for
  weather/stock/flight/news. The only tier-0 today is URL open.
  The hypothetical "keep weather/stock for tier-0 latency" argument
  does NOT hold.

### Per-pattern verdict

All 9 pattern groups are **topical / SR-eligible**. None is a
structural hard signal in the sense the reference docs preserve
(URL / attachment / explicit search-verb / explicit no-search /
time-sensitive marker / external side-effect / destructive action).

| Pattern group | Verdict |
|---|---|
| weather / 天气 / 气温 / 气象 / forecast | SR-eligible |
| stock-prices / 股价 / 涨幅 / nasdaq / 大盘 / 暴涨 / 暴跌 | SR-eligible |
| flights / 航班 / 订机票 / flight status | SR-eligible |
| forex / 汇率 / 外汇 / exchange rate | SR-eligible |
| hotels / 酒店价格 / 订酒店 | SR-eligible |
| news / 今日新闻 / 头条 / breaking news / ai 新闻 / 科技新闻 | SR-eligible (largest, most arbitrary) |
| geopolitics / 局势 / 大选 / election / geopolitic | SR-eligible |
| commodities / 油价 / 金价 / crude oil / gold price | SR-eligible |
| monetary / 加息 / 利率 / interest rate | SR-eligible |

### Decision (USER CHOSE C)

> "explicit_entity 不再作为 resolver required 的直接依据;
> 改成 topic_hint / semantic_hint, 只供 SemanticRouter prompt 和
> decision trace 使用; web required / single_lookup / multi_source
> 由 SemanticRouter + EvidencePolicy 合并决定; SR 不可用时 fallback
> 必须是保守、通用的，不要靠继续扩 topic regex"

Rejected:
- **Option A (drop entirely)**: too aggressive, no replacement when
  SR is unavailable.
- **Option B (keep weather/stock/flight)**: the keep-list rationale
  was tier-0 latency; tier-0 doesn't consume the signal, so the
  rationale fails.

### C — incremental implementation plan

**Principle:** when SR is unavailable, the conservative fallback is
`web=forbidden`. We do NOT extend topic regex to keep the deterministic
"required" path alive. Operators who turn SR off accept that
weather/news queries no longer auto-escalate to web; they can
still type "查一下网上的 X" / "search the web" to opt in via
`explicit_search` + `explicit_external` (which are kept-as-regex
structural hard signals).

**C-stage 1 — Rename + remove the resolver-required driver:**
- Rename signal `explicit_entity` → `topic_hint` everywhere.
- Patterns and `kind: "hint"` preserved (the data is still useful
  for SR prompt + observability).
- Resolver `resolveDeterministicPolicy`: remove step 3 ("strong
  topic_hint + scope=none → required"). The signal becomes
  observation-only at the deterministic layer.
- Update consumers that key off the old name (task-spec.mjs evidence
  collection, contracts/task-contract.mjs confidence boost, risk
  register, shouldConsultSemanticRouter).
- Fixture fallout (verify-routing-policy / verify-executor-selection):
  cases that previously asserted required from entity-only signals
  must either:
    (a) be updated to expect forbidden + a behaviour-change comment,
        consistent with the conservative fallback principle; OR
    (b) be re-platformed to test the SR-merge path by stubbing a
        `semantic_router_decision` on the contextPacket so the merge
        layer drives required.

**C-stage 2 — Drop topic_hint from the SR skip-gate:**
- `shouldConsultSemanticRouter` no longer skips SR when topic_hint
  fires strongly. Result: SR runs more often (latency cost
  acknowledged). This is what enables the SR-driven required path
  for weather/news/etc.
- Tests: extend verify-resolver-merge with cases that prove SR is
  consulted for topic-only inputs.

**C-stage 3 — SR prompt + decision trace surfacing:**
- `summariseSignals` already passes the renamed signal through to
  the LLM with kind/strength/hint. Verify; no code change expected.
- Decision trace: confirm the renamed signal name is captured in
  the GOAL_CLASSIFICATION + TOOL_POLICY stage evidence.

**C-stage 4 — Documentation + memory:**
- Update plan file with the executed-stage commits.
- Memory note: "topic-domain regex (weather/stock/news/etc.) is
  observability-only at the deterministic layer; routing decisions
  for these classes flow through SR + EvidencePolicy merge."
- Update reference doc cross-links.

### Out of scope this round

- Removing the renamed `topic_hint` patterns entirely. The signal
  remains as a soft observability hint feeding SR + decision trace.
  Future evolution can drop the regex once SR coverage telemetry
  shows zero deterministic dependence (§19 follow-up).
- Reshaping `shouldConsultSemanticRouter` beyond removing the
  topic-skip — broader gate redesign (e.g. always-consult-SR) is a
  separate experiment.
