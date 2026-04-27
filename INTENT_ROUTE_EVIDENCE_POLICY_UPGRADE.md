# IntentRoute + EvidencePolicy Upgrade Tracker

## Purpose

This document tracks the framework-level upgrade from regex-driven routing toward:

```text
Hard signals -> LLM IntentRoute -> EvidencePolicy / ToolPolicy -> Executor -> Guard -> SuccessContract
```

The goal is not to patch individual repro prompts such as weather, news, or open-source-project searches. The goal is to let the model classify intent in a structured, auditable way, then let deterministic policy layers constrain execution.

## Non-Negotiable Direction

- Do not add topic/domain regex to fix individual tests.
- Regex is only for structural hard signals: explicit no-search, explicit search, URL, attachments, real local anchors, destructive actions, and external side effects.
- LLM classification does not execute tools directly. It outputs judgment fields for policy to merge.
- `sr_timeout`, `sr_no_provider`, `sr_exception`, and `sr_schema_invalid` are operational failures, not user intent and not `forbidden`.
- Existing guardrails stay in place: policy groups, registry guard, SuccessContract, PhaseGate, Runbook, and research-quality thresholds.
- Do not touch `src/service/executors/kimi/output-format.mjs`.

## Target Layers

1. **Input Normalizer**
   - Produces normalized input and context-source metadata.
   - Does not decide intent.

2. **Hard Signals**
   - Extracts facts/hints/assumptions.
   - Hard facts can override the LLM.
   - `topic_hint` remains observability-only.

3. **SemanticRouter / IntentRoute**
   - LLM outputs structured judgment:
     - `primary_intent`
     - `domain`
     - `user_goal`
     - `expected_output`
     - `needs_external_info`
     - `needs_current_information`
     - `needs_user_files`
     - `needs_tool_use`
     - `needed_capabilities`
     - `source_mode`
     - `complexity`
     - `risk_level`
     - `confidence`
     - `rationale_summary`
   - Existing `web_policy`, `research_depth`, and `executor` remain as compatibility fields while EvidencePolicy takes over.

4. **EvidencePolicy / ToolPolicy Merge**
   - Merges hard signals with IntentRoute.
   - Converts capability needs into `tool_policy`, `research_quality`, and success-contract requirements.
   - Keeps source-count thresholds deterministic in `research-quality.mjs`; the LLM must not emit numeric thresholds.

5. **Executor Routing**
   - `required` web capability routes to `tool_using` or `agentic`.
   - `optional + routing_degraded` routes to `tool_using`, not `fast`.
   - `fast` remains for truly tool-free answers or explicit no-search refusals.

6. **Guard + SuccessContract**
   - Registry guard remains the final hard enforcement.
   - SuccessContract validates required evidence and research-quality profiles.

## Implementation Checklist

- [x] Extend SemanticRouter schema with IntentRoute fields.
- [x] Update SemanticRouter prompt to explain that regex signals are evidence, not final intent.
- [x] Preserve hard-fact conflict checks for explicit no-search and local anchors.
- [x] Add an EvidencePolicy-style merge helper or equivalent resolver path.
- [x] Convert SR operational failures into degraded optional fallback when no hard forbid/local anchor exists.
- [x] Route `web=optional + routing_degraded=true` to `tool_using`.
- [x] Keep `topic_hint` out of deterministic required paths.
- [x] Keep research thresholds deterministic and policy-owned.
- [x] Consume IntentRoute `source_mode`, `needs_external_info`, and `needed_capabilities` in EvidencePolicy instead of treating them as trace-only fields.
- [x] Treat IntentRoute `email_calendar_action` / `needed_capabilities=["email_calendar_action"]` as connector-domain evidence.
- [x] Run connector capability read preflight inside `tool_using` even when a chat planner is available.
- [x] Thread `conversation_id` through file/browser/image/office/action/composite submission paths.
- [x] Add regression tests for SR failure fallback.
- [x] Run P4-RQ smoke and relevant routing/verifier suites.

## Implementation Notes

- SemanticRouter now emits IntentRoute judgement fields in addition to the existing compatibility routing fields.
- `needed_capabilities` is capability-based; `web_search_fetch` is intentionally rejected by schema validation.
- `maxTokens` for the SR tool call was raised to fit the larger strict JSON payload.
- Operational SR failures (`timeout`, `no_provider`, `exception`, `schema_invalid`) now produce optional external-web fallback when the request is ambiguous and no hard fact blocks it.
- Executor routing keeps `routing_degraded + optional` tasks on `tool_using`, preventing `fast` from issuing a premature degraded refusal.
- `EvidencePolicy` now maps IntentRoute source/capability fields to external-web mode; compatibility `web_policy` is a fallback, not the only signal.
- Connector-domain execution now has a deterministic first-read hook for connected-account state (for example calendar availability) before the LLM performs follow-up reasoning or writes.
- No topic/domain regex was added or promoted. `topic_hint` remains observability-only.

## Acceptance Scenarios

- `天气怎么样 + sr_timeout` -> `web=optional`, `executor=tool_using`.
- `国际新闻 + sr_timeout` -> `web=optional`, `executor=tool_using`.
- `今天有什么 AI 新闻 + sr_no_provider` -> `web=optional`, `executor=tool_using`.
- `不要联网，国际新闻 + sr_timeout` -> `web=forbidden`, `executor=fast`.
- `总结选中文本 + sr_timeout` -> local/provided-context path, not degraded refusal.
- `总结这个 URL: https://example.com/a` -> `single_lookup`, URL fetch allowed.
- `查一下有没有类似的开源项目` -> SR/EvidencePolicy path, not topic regex.

## Current Problem Being Fixed

The current chain can turn an SR timeout into:

```text
semantic_router_rejection=timeout
-> deterministic fallback web=forbidden
-> goal=qa
-> executor=fast
-> fast degraded refusal
```

This is wrong because an operational failure in the semantic layer is not evidence that the user forbade tools. The fallback should preserve tool-capable execution when no hard constraint blocks it.
