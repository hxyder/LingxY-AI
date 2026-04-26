#!/usr/bin/env node
/**
 * UCA-077 inspect-routing — quick CLI to dump createTaskSpec output for any
 * input. Replaces the fragile `node -e "..."` one-liner that depended on
 * platform-specific argv numbering.
 *
 * Usage:
 *   node scripts/inspect-routing.mjs "你的查询"
 *   node scripts/inspect-routing.mjs --file a.md "查一下文件内容"
 *   node scripts/inspect-routing.mjs --image x.png "识别这张图"
 *   node scripts/inspect-routing.mjs --route fast "今天天气"      # simulate intent-router suggestion
 *   node scripts/inspect-routing.mjs --json "你的查询"            # machine-readable output
 *
 * Flags:
 *   --file <path>    repeat to attach multiple files (sets contextPacket.file_paths)
 *   --image <path>   repeat to attach multiple images (sets contextPacket.image_paths)
 *   --route <exec>   pretend intent-router suggested this executor
 *   --json           emit raw JSON instead of the human-readable block
 */

import { createTaskSpec } from "../src/service/core/task-spec.mjs";

function parseArgs(argv) {
  const filePaths = [];
  const imagePaths = [];
  let routeSuggestion = null;
  let json = false;
  const text = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file" || arg === "-f") {
      const value = argv[++i];
      if (value) filePaths.push(value);
    } else if (arg === "--image" || arg === "-i") {
      const value = argv[++i];
      if (value) imagePaths.push(value);
    } else if (arg === "--route" || arg === "-r") {
      routeSuggestion = argv[++i] ?? null;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      text.push(arg);
    }
  }
  return {
    text: text.join(" ").trim(),
    contextPacket: {
      ...(filePaths.length ? { file_paths: filePaths } : {}),
      ...(imagePaths.length ? { image_paths: imagePaths } : {})
    },
    routeSuggestion,
    json
  };
}

function printUsage() {
  process.stdout.write(
    "Usage: node scripts/inspect-routing.mjs [--file path]... [--image path]... [--route exec] [--json] <text>\n"
  );
}

function colour(label) {
  switch (label) {
    case "forbidden": return "\x1b[32m" + label + "\x1b[0m"; // green — safe default
    case "required":  return "\x1b[31m" + label + "\x1b[0m"; // red — costs money
    case "optional":  return "\x1b[33m" + label + "\x1b[0m"; // yellow — LLM decides
    default: return label;
  }
}

function dump(spec) {
  const policy = spec.tool_policy?.web_search_fetch ?? {};
  const decision = spec.executor_decision ?? {};
  const contract = spec.contract ?? {};

  const lines = [];
  lines.push("");
  lines.push("Input         : " + JSON.stringify(spec.user_goal_text));
  lines.push("Goal          : " + spec.goal + "  (mode=" + contract.mode + ")");
  lines.push("Source scope  : " + (contract.source_scope ?? "none"));
  lines.push("Web policy    : " + colour(policy.mode ?? "?"));
  if (policy.reason) lines.push("              → " + policy.reason);
  lines.push("Executor      : " + spec.suggested_executor);
  if (decision.reason) lines.push("              → " + decision.reason);
  lines.push("Artifact      : required=" + spec.artifact?.required + (spec.artifact?.kind ? "  kind=" + spec.artifact.kind : ""));
  lines.push("Confidence    : " + contract.confidence);
  lines.push("");
  lines.push("Decision trace:");
  for (const entry of spec.decision_trace ?? []) {
    lines.push("  [" + entry.stage.padEnd(22) + "] " + JSON.stringify(entry.output));
    if (entry.reason) lines.push("    " + entry.reason);
    if (Array.isArray(entry.evidence) && entry.evidence.length > 0) {
      const matches = entry.evidence.filter((e) => e.matched).map((e) => `${e.source}:${e.matched}`);
      if (matches.length > 0) lines.push("    evidence: " + matches.join(", "));
    }
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.text) {
    printUsage();
    process.stderr.write("\nNo input text provided.\n");
    process.exit(2);
  }

  const route = args.routeSuggestion ? { suggested_executor: args.routeSuggestion } : {};
  const spec = createTaskSpec(args.text, args.contextPacket, route);

  if (args.json) {
    process.stdout.write(JSON.stringify({
      input: args.text,
      contextPacket: args.contextPacket,
      route_suggestion: args.routeSuggestion,
      web_policy: spec.tool_policy?.web_search_fetch?.mode,
      web_reason: spec.tool_policy?.web_search_fetch?.reason,
      executor: spec.suggested_executor,
      executor_reason: spec.executor_decision?.reason,
      goal: spec.goal,
      mode: spec.contract?.mode,
      source_scope: spec.contract?.source_scope,
      artifact_required: spec.artifact?.required,
      confidence: spec.contract?.confidence,
      decision_trace: spec.decision_trace
    }, null, 2) + "\n");
  } else {
    process.stdout.write(dump(spec));
  }
}

main();
