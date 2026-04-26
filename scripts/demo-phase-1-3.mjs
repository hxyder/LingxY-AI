#!/usr/bin/env node
/**
 * UCA-077 Phase 1-3 demo runner.
 *
 * Runs a curated set of inputs end-to-end through createTaskSpec and prints
 * the human-readable decision trail for each. Use this to eyeball whether
 * the upgrade is doing what you expect for both the original symptom and
 * the conflict cases that drove the design.
 *
 * Run:  node scripts/demo-phase-1-3.mjs
 */

import { createTaskSpec } from "../src/service/core/task-spec.mjs";

const SCENARIOS = [
  {
    section: "1. 原始症状 — 不应该联网",
    cases: [
      {
        title: "最近这个框架很慢，帮我分析",
        input: "最近这个框架很慢，帮我分析",
        context: {},
        why: "原始 bug 触发词。'最近' + '这个框架' 应被 source-scope 锁为 current_context → web=forbidden → executor=fast"
      },
      {
        title: "最近我的程序执行很慢，帮我排查",
        input: "最近我的程序执行很慢，帮我排查",
        context: {},
        why: "同上。'我的程序' 也是 current_context"
      },
      {
        title: "这个代码里 current 字段是什么意思",
        input: "这个代码里 current 字段是什么意思",
        context: {},
        why: "'current' 作为标识符不是时态词。'这个代码' 锁定本地范围"
      }
    ]
  },
  {
    section: "2. 真实联网需求 — 必须搜索",
    cases: [
      {
        title: "今天有什么 AI 新闻 (post-E3 C1: SR-driven)",
        input: "今天有什么 AI 新闻",
        context: {
          // E3 stage C1: topic_hint no longer drives required. The
          // deterministic resolver returns forbidden by itself for
          // topic-only queries. SR (when available) classifies it as
          // multi_source_research and the merge upgrades to required.
          // Demo stubs the SR decision so the merged result is required.
          semantic_router_decision: {
            source_scope: "external_world",
            web_policy: "required",
            output_kind: "conversation",
            artifact_required: false,
            executor: "tool_using",
            research_depth: "multi_source",
            confidence: 0.85,
            reason: "news topic"
          }
        },
        why: "topic_hint observability + SR→required (merge) → required. Without SR stub: forbidden (conservative fallback)."
      },
      {
        title: "current weather in Raleigh (post-E3 C1: SR-driven)",
        input: "current weather in Raleigh",
        context: {
          semantic_router_decision: {
            source_scope: "external_world",
            web_policy: "required",
            output_kind: "conversation",
            artifact_required: false,
            executor: "tool_using",
            research_depth: "single_lookup",
            confidence: 0.95,
            reason: "single-fact weather"
          }
        },
        why: "topic_hint observability + SR→required (merge) → required."
      },
      {
        title: "查一下网上最近开源项目",
        input: "查一下网上最近开源项目",
        context: {},
        why: "explicit_external (网上) 是结构性 hard signal → required (resolver step 1)。不需要 SR。"
      },
      {
        title: "查一下 AVIS 为什么暴涨 (post-E3 C1: SR-driven)",
        input: "查一下 AVIS 为什么暴涨",
        context: {
          semantic_router_decision: {
            source_scope: "external_world",
            web_policy: "required",
            output_kind: "conversation",
            artifact_required: false,
            executor: "tool_using",
            research_depth: "single_lookup",
            confidence: 0.9,
            reason: "stock-price lookup"
          }
        },
        why: "explicit_search → required (E5 resolver step 3) + topic_hint observability for SR; merge stays at required → tool_using."
      }
    ]
  },
  {
    section: "3. 冲突样例 — source_scope vs explicit_external",
    cases: [
      {
        title: "查一下这个文件里最近提到的内容（带文件附件）",
        input: "查一下这个文件里最近提到的内容",
        context: { file_paths: ["a.md"] },
        why: "explicit_search + 文件附件。source_scope (fact-local) 在 step 2a 优先 → forbidden（如果没有附件，post-E5 会是 required）"
      },
      {
        title: "查一下网上最近开源项目（无文件附件）",
        input: "查一下网上最近开源项目",
        context: {},
        why: "explicit_external 优先级最高，即使有 source_scope 也会赢"
      }
    ]
  },
  {
    section: "4. 闲聊 / 无搜索意图",
    cases: [
      {
        title: "你好",
        input: "你好",
        context: {},
        why: "无任何信号 → 默认 forbidden → fast"
      },
      {
        title: "最近怎么样",
        input: "最近怎么样",
        context: {},
        why: "weak_freshness 无 companion → 默认 forbidden（防止聊天升级）"
      },
      {
        title: "帮我润色这句话",
        input: "帮我润色这句话",
        context: {},
        why: "无信号 + qa goal → fast"
      }
    ]
  },
  {
    section: "5. 文件产物 / 多模态 / 翻译",
    cases: [
      {
        title: "基于上传文件生成报告",
        input: "基于上传文件生成报告",
        context: { file_paths: ["data.md"] },
        why: "goal=generate_document + artifact.required=true → executor=agentic"
      },
      {
        title: "改一下这个文档加入日期",
        input: "改一下这个文档加入日期",
        context: { file_paths: ["a.docx"] },
        why: "transform_existing_file + 编辑动词 → executor=agentic"
      },
      {
        title: "翻译这段",
        input: "翻译这段",
        context: {},
        why: "中文 \\b 在翻译规则修过后能匹配 → executor=translate"
      },
      {
        title: "识别这张图",
        input: "识别这张图",
        context: { image_paths: ["x.png"] },
        why: "image_paths → mode=multimodal + executor=multi_modal"
      },
      {
        title: "打开微信",
        input: "打开微信",
        context: {},
        why: "launch_and_act → executor=tool_using（动作工具）"
      }
    ]
  },
  {
    section: "6. routeSuggestion 不能覆盖规则",
    cases: [
      {
        title: "今天 AI 新闻 (intent-router 建议 fast)",
        input: "今天 AI 新闻",
        context: {},
        route: { suggested_executor: "fast" },
        why: "上游 routeSuggestion=fast 必须被规则覆盖为 tool_using（web=required）"
      }
    ]
  }
];

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function bar(char = "─", len = 78) {
  return char.repeat(len);
}

function dumpCase(testCase) {
  const { title, input, context, route = {}, why } = testCase;
  const spec = createTaskSpec(input, context, route);

  const policy = spec.tool_policy?.web_search_fetch;
  const decision = spec.executor_decision;
  const contract = spec.contract;

  console.log("• " + title);
  console.log("  input    : " + JSON.stringify(input));
  if (Object.keys(context).length) console.log("  context  : " + JSON.stringify(context));
  if (route.suggested_executor) console.log("  route    : suggested_executor=" + route.suggested_executor);
  console.log("  why      : " + why);
  console.log();
  console.log("  ┌─ Goal           : " + pad(spec.goal, 28) + " (mode=" + contract.mode + ")");
  console.log("  ├─ Source scope   : " + pad(contract.source_scope, 28));
  console.log("  ├─ Tool policy    : web_search_fetch = " + policy.mode);
  console.log("  │                   reason: " + policy.reason);
  console.log("  ├─ Executor       : " + pad(spec.suggested_executor, 28) + " (rejected: " + decision.rejected.length + " candidates)");
  console.log("  │                   reason: " + decision.reason);
  console.log("  ├─ Artifact       : required=" + spec.artifact.required + (spec.artifact.kind ? " kind=" + spec.artifact.kind : ""));
  console.log("  └─ Confidence     : " + contract.confidence);
  console.log();
  console.log("  Decision trace:");
  for (const entry of spec.decision_trace) {
    const out = JSON.stringify(entry.output);
    console.log("    [" + pad(entry.stage, 22) + "] " + out);
    if (entry.reason) console.log("      reason: " + entry.reason);
  }
  console.log();
}

function main() {
  console.log(bar("="));
  console.log("UCA-077 Phase 1-3 demo — routing & decision-trace inspection");
  console.log(bar("="));
  console.log();

  for (const group of SCENARIOS) {
    console.log(bar());
    console.log("§ " + group.section);
    console.log(bar());
    console.log();
    for (const testCase of group.cases) {
      dumpCase(testCase);
    }
  }

  console.log(bar("="));
  console.log("End of demo. Run `node scripts/verify-routing-policy.mjs` and");
  console.log("`node scripts/verify-executor-selection.mjs` for the headline regression.");
  console.log(bar("="));
}

main();
