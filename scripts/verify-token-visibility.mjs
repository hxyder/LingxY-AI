#!/usr/bin/env node
/**
 * verify-token-visibility.mjs — C17 (UPGRADE_PLAN.md §C17)
 *
 * R rule (recurring; first seen in plan §5.5 #4 "cost 不准, 改 token";
 * resurfaced 2026-05-08 with screenshot): Console must surface the
 * task token consumption as the primary usage signal, not USD cost.
 *
 * This verifier locks two invariants:
 *   1. renderTaskKvGrid no longer renders a "Cost" cell. When tokens
 *      are passed, a "Tokens" cell appears in their place.
 *   2. describeTaskTokens picks the right token total from the
 *      various carrier shapes the runtime emits (usage_summary,
 *      usage, tokens_used).
 *
 * Constitution (CADRE C):
 *   - 不打补丁: token derivation is a pure function on the task
 *     record (describeTaskTokens). No per-task carve-outs.
 *   - 不针对特定提问: handles all three known carrier shapes
 *     (usage_summary.tokens_in/out, usage.input_tokens/output_tokens,
 *     usage.total_tokens / tokens_used) with one priority chain.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderTaskKvGrid,
  describeTaskTokens
} from "../src/desktop/renderer/console-task-detail.mjs";
import {
  renderTaskListItemHtml
} from "../src/desktop/renderer/console-task-list.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const consoleJsSource = readFileSync(path.join(repoRoot, "src/desktop/renderer/console.js"), "utf8");

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------
// 1. renderTaskKvGrid: Cost cell is gone; Tokens cell appears when
//    tokens param is non-empty.
// ---------------------------------------------------------------------
{
  const html = renderTaskKvGrid({
    provider: "OpenAI",
    model: "gpt-5.4-mini",
    executor: "fast",
    source: "clipboard",
    retry: 0,
    tokens: "1,500 (1,200 in / 300 out)",
    duration: "3.4s",
    transport: "https"
  });
  check("Tokens cell present", html.includes(">Tokens<") && html.includes("1,500"));
  check("Cost cell absent", !html.includes(">Cost<"));
  check("No literal '$' character anywhere", !html.includes("$"));
  check("breakdown 'in / out' rendered", html.includes("1,200 in / 300 out"));
}

// ---------------------------------------------------------------------
// 2. Legacy `cost` keyword is silently ignored (shape compat).
// ---------------------------------------------------------------------
{
  const html = renderTaskKvGrid({
    provider: "OpenAI",
    model: "gpt-5.4",
    cost: 0.012,
    duration: "2s"
  });
  check("legacy cost arg: no Cost cell rendered", !html.includes(">Cost<"));
  check("legacy cost arg: no '$' in output", !html.includes("$"));
  check("legacy cost arg: shape-compat, doesn't throw", typeof html === "string");
}

// ---------------------------------------------------------------------
// 3. renderTaskKvGrid: missing tokens arg → no Tokens cell (avoid
//    misleading "0 tokens" when usage data isn't available).
// ---------------------------------------------------------------------
{
  const html = renderTaskKvGrid({
    provider: "OpenAI",
    model: "gpt-5.4"
  });
  check("missing tokens: no Tokens cell rendered", !html.includes(">Tokens<"));
  check("missing tokens: provider/model still rendered", html.includes("OpenAI") && html.includes("gpt-5.4"));
}

// ---------------------------------------------------------------------
// 4. describeTaskTokens: usage_summary path (the canonical shape).
// ---------------------------------------------------------------------
{
  const display = describeTaskTokens({
    usage_summary: { tokens_in: 1200, tokens_out: 300 }
  });
  check("usage_summary: returns total + breakdown", display === "1,500 (1,200 in / 300 out)");
}

// ---------------------------------------------------------------------
// 5. describeTaskTokens: usage.input_tokens / output_tokens path
//    (anthropic-style envelope).
// ---------------------------------------------------------------------
{
  const display = describeTaskTokens({
    usage: { input_tokens: 800, output_tokens: 200 }
  });
  check("usage.input_tokens path: 800 + 200 → 1,000 total", display === "1,000 (800 in / 200 out)");
}

// ---------------------------------------------------------------------
// 6. describeTaskTokens: tokens_used / usage.total_tokens fallback.
// ---------------------------------------------------------------------
{
  const display = describeTaskTokens({ tokens_used: 4200 });
  check("tokens_used fallback: total only, no breakdown", display === "4,200");

  const display2 = describeTaskTokens({ usage: { total_tokens: 7777 } });
  check("usage.total_tokens fallback", display2 === "7,777");
}

// ---------------------------------------------------------------------
// 7. describeTaskTokens: no MEANINGFUL token data → null. Empty,
//    zero, and corrupted (negative) values all return null so the
//    cell is omitted instead of rendering "0 tokens" / "-1 tokens".
// ---------------------------------------------------------------------
{
  check("empty task: returns null", describeTaskTokens({}) === null);
  check("zero tokens_used: returns null (don't show '0 tokens')",
    describeTaskTokens({ tokens_used: 0 }) === null);
  // codex round-1: 0 in + 0 out used to render "0 (0 in / 0 out)"
  // because Number.isFinite(0) is true. Now requires positive total.
  check("usage_summary 0/0: returns null (don't show '0 (0 in / 0 out)')",
    describeTaskTokens({ usage_summary: { tokens_in: 0, tokens_out: 0 } }) === null);
  // codex round-1: -1 used to render because Number.isFinite(-1) is true.
  check("negative tokens_used: returns null (corrupted data)",
    describeTaskTokens({ tokens_used: -1 }) === null);
  check("negative usage_summary.tokens_in: returns null",
    describeTaskTokens({ usage_summary: { tokens_in: -10, tokens_out: 5 } }) === null);
  check("NaN tokens_used: returns null",
    describeTaskTokens({ tokens_used: Number.NaN }) === null);
}

// ---------------------------------------------------------------------
// 8. describeTaskTokens: usage_summary takes priority over fallbacks
//    when both are present (canonical > legacy).
// ---------------------------------------------------------------------
{
  const display = describeTaskTokens({
    usage_summary: { tokens_in: 100, tokens_out: 50 },
    tokens_used: 9999, // legacy field; should be ignored
    usage: { total_tokens: 8888 }
  });
  check("priority: usage_summary wins over tokens_used + total_tokens",
    display === "150 (100 in / 50 out)");
}

// ---------------------------------------------------------------------
// 8b. Task list: token usage is visible before opening task detail.
// ---------------------------------------------------------------------
{
  const html = renderTaskListItemHtml({
    task: {
      task_id: "task_tokens_visible",
      user_command: "Summarize token usage",
      executor: "tool_using",
      source_type: "chat",
      status: "success",
      created_at: "2026-05-08T12:00:00.000Z",
      usage_summary: { tokens_in: 1200, tokens_out: 300 }
    }
  });
  check("task list: token usage appears in item meta",
    html.includes("1,500 (1,200 in / 300 out) tokens"));
  check("task list: no cost wording in item meta",
    !/cost|usd|\$/i.test(html));
}

// ---------------------------------------------------------------------
// 9. Console stat strip / idle line / budget panel no longer surface
//    USD as a primary signal anywhere. This is a TEXT-LEVEL guard
//    against accidental drift back to monetary display.
//    codex round-1: the original C17 commit missed the stat strip's
//    "Spend" card (computeSummary.monthlySpend → renderSummary
//    cards label "Spend"). This regression guard locks the new shape.
// ---------------------------------------------------------------------
{
  // The stat strip card label is now "Tokens", not "Spend".
  check("stat strip: label 'Spend' is gone",
    !/label:\s*"Spend"/.test(consoleJsSource));
  check("stat strip: label 'Tokens' present",
    /label:\s*"Tokens"/.test(consoleJsSource));
  // computeSummary returns monthlyTokens, not monthlySpend.
  check("computeSummary: monthlySpend computation dropped",
    !/monthlySpend:\s*budget\?\.spent\?\.this_month_usd/.test(consoleJsSource));
  check("computeSummary: monthlyTokens computation present",
    /monthlyTokens:/.test(consoleJsSource));
  // Idle line shows "X tokens this month", not "$X this month".
  check("idle line: '$X this month' phrasing is gone",
    !/formatMoney\(spend\)\}\}\s*this month/.test(consoleJsSource));
  check("idle line: 'tokens this month' phrasing present",
    /tokens this month/.test(consoleJsSource));
  // renderBudget no longer has a "This Month" tile.
  check("budget panel: 'This Month' tile dropped",
    !/\["This Month",\s*formatMoney\(b\.spent\?\.this_month_usd/.test(consoleJsSource));
  check("budget panel: 'Tokens (this month)' tile present",
    /\["Tokens \(this month\)"/.test(consoleJsSource));
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
