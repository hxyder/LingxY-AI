#!/usr/bin/env node
/**
 * verify-skill-install-approval-preview.mjs — C18 #2c
 *
 * Closes D's "approval should anchor to the SKILL.md the user
 * previewed, not just to a state_token" finding from the C18 #2b
 * round-1. The wiring:
 *
 *   agent-loop.confirmation-gate.createPendingToolApproval(runtime,
 *     task, tool, args, ...) → buildDeferredToolContext({ tool,
 *     args, runtime, ... }) → buildSkillInstallDeferredContext
 *     pulls the staged install info via runtime.skillInstallState
 *     .inspect(args.state_token) → previewText carries the full
 *     SKILL.md (capped at 4000 chars) + descriptor + contentHash.
 *
 * Constitution (CADRE C):
 *   - 不打补丁: hooked through the existing deferredContext
 *     mechanism (already used by index_file_content). No new
 *     parallel preview path.
 *   - 不针对特定提问: previewSkillInstall is class-level — handles
 *     any deferredContext shape from the registry inspect call,
 *     including missing/expired tokens (returns a clear "expired
 *     or unknown" line).
 */

import {
  buildDeferredToolContext,
  buildToolApprovalPreview
} from "../src/service/executors/shared/tool-approval-context.mjs";
import {
  createInstallStateRegistry
} from "../src/service/capabilities/skills/install-state.mjs";

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

const SAMPLE_SKILL_MD = `# Research Skill

Helps gather sources for a research task.

## Activation

Trigger when the user asks for "research" or "find sources".

## Steps

1. Use web_search_fetch to gather candidates.
2. Filter by relevance + recency.
3. Summarise in markdown.
`;

function fakeStagingInfo(overrides = {}) {
  return {
    stagingDir: "/tmp/staging-X",
    finalDir: "/tmp/final/owner--repo",
    owner: "openai",
    repo: "agents",
    branch: "main",
    subPath: "skills/research",
    targetIdentifier: "openai/agents@main:/skills/research",
    skillDir: "/tmp/staging-X/skills/research",
    entryPath: "/tmp/staging-X/skills/research/SKILL.md",
    descriptor: { heading: "Research Skill", description: "Helps gather sources." },
    preview: {
      markdown: SAMPLE_SKILL_MD,
      sizeBytes: Buffer.byteLength(SAMPLE_SKILL_MD, "utf8"),
      contentHash: "abc123def4567890"
    },
    gitRemoveFailed: false,
    ...overrides
  };
}

const installTool = { id: "install_skill_from_github", name: "Install Skill from GitHub (Confirm)" };
const previewTool = { id: "preview_skill_from_github", name: "Preview Skill from GitHub" };

// ---------------------------------------------------------------------
// 1. End-to-end: register stagingInfo, build deferred context via
//    install_skill_from_github tool + state_token → preview text shows
//    SKILL.md + descriptor + content hash + warning.
// ---------------------------------------------------------------------
{
  const registry = createInstallStateRegistry();
  const token = registry.put(fakeStagingInfo());
  const runtime = { skillInstallState: registry };
  const deferred = buildDeferredToolContext({
    tool: installTool,
    args: { state_token: token },
    runtime
  });
  check("deferred: not null for valid token", deferred !== null);
  check("deferred: targetIdentifier passed through",
    deferred?.targetIdentifier === "openai/agents@main:/skills/research");
  check("deferred: descriptor heading + description present",
    deferred?.descriptor?.heading === "Research Skill"
    && deferred?.descriptor?.description === "Helps gather sources.");
  check("deferred: previewMarkdown is the full SKILL.md",
    deferred?.previewMarkdown === SAMPLE_SKILL_MD);
  check("deferred: contentHash matches staging info",
    deferred?.contentHash === "abc123def4567890");

  const previewText = buildToolApprovalPreview(installTool, { state_token: token }, { deferredContext: deferred });
  check("preview: contains the third-party warning",
    previewText.includes("⚠️")
    && previewText.includes("third-party skill")
    && previewText.includes("LLM's future prompt context"));
  check("preview: shows owner/repo/branch/subPath via target identifier",
    previewText.includes("openai/agents@main:/skills/research"));
  check("preview: shows SKILL.md heading line",
    previewText.includes("# Research Skill"));
  check("preview: shows SKILL.md activation section",
    previewText.includes("## Activation"));
  check("preview: shows SKILL.md steps",
    previewText.includes("Use web_search_fetch"));
  check("preview: shows content hash",
    previewText.includes("abc123def4567890"));
  check("preview: shows byte size",
    previewText.includes("bytes"));
}

// ---------------------------------------------------------------------
// 2. Long SKILL.md is truncated at the cap (4000 chars) with an
//    explicit "[…truncated]" tail. Hash binding is mentioned so the
//    user knows the token still anchors to the FULL bytes.
// ---------------------------------------------------------------------
{
  const longBody = "# Research\n\n" + "lorem ipsum dolor sit amet ".repeat(400);
  const registry = createInstallStateRegistry();
  const token = registry.put(fakeStagingInfo({
    preview: {
      markdown: longBody,
      sizeBytes: Buffer.byteLength(longBody, "utf8"),
      contentHash: "long123"
    }
  }));
  const deferred = buildDeferredToolContext({
    tool: installTool,
    args: { state_token: token },
    runtime: { skillInstallState: registry }
  });
  const previewText = buildToolApprovalPreview(installTool, { state_token: token }, { deferredContext: deferred });
  check("truncation: preview length under 6000 chars (markdown 4000 + framing)",
    previewText.length < 6000);
  check("truncation: explicit '[…truncated' marker",
    previewText.includes("[…truncated"));
  check("truncation: notes contentHash binding to full bytes",
    previewText.includes("contentHash"));
}

// ---------------------------------------------------------------------
// 3. Missing / expired token → preview text says so plainly without
//    crashing.
// ---------------------------------------------------------------------
{
  const registry = createInstallStateRegistry();
  const runtime = { skillInstallState: registry };
  const deferred = buildDeferredToolContext({
    tool: installTool,
    args: { state_token: "deadbeef-0000-0000-0000-000000000000" },
    runtime
  });
  check("missing token: deferred = null", deferred === null);
  const previewText = buildToolApprovalPreview(installTool, { state_token: "deadbeef" }, { deferredContext: null });
  check("missing token preview: includes 'expired or unknown' hint",
    previewText.includes("expired") || previewText.includes("unknown"));
  check("missing token preview: still mentions preview_skill_from_github as the recovery step",
    previewText.includes("preview_skill_from_github"));
}

// ---------------------------------------------------------------------
// 4. Empty state_token → deferred context returns null (graceful);
//    preview falls through to the "expired or unknown" copy.
// ---------------------------------------------------------------------
{
  const registry = createInstallStateRegistry();
  const deferred = buildDeferredToolContext({
    tool: installTool,
    args: { state_token: "" },
    runtime: { skillInstallState: registry }
  });
  check("empty token: deferred = null", deferred === null);
}

// ---------------------------------------------------------------------
// 5. No registry on runtime → deferred = null (no crash). Preview
//    falls through to the recovery copy.
// ---------------------------------------------------------------------
{
  const deferred = buildDeferredToolContext({
    tool: installTool,
    args: { state_token: "any" },
    runtime: { /* no skillInstallState */ }
  });
  check("no registry: deferred = null (no crash)", deferred === null);
}

// ---------------------------------------------------------------------
// 6. preview_skill_from_github (the LOW-risk staging tool) doesn't
//    get a deferred context — it has requires_confirmation=false
//    and never reaches the approval card path. This is a regression
//    guard: the runtime/args wiring shouldn't accidentally surface
//    SKILL.md previews for the wrong tool.
// ---------------------------------------------------------------------
{
  const registry = createInstallStateRegistry();
  const token = registry.put(fakeStagingInfo());
  const deferred = buildDeferredToolContext({
    tool: previewTool,
    args: { url: "https://github.com/owner/repo" },
    runtime: { skillInstallState: registry }
  });
  check("preview tool gets no deferred context (only install tool does)",
    deferred === null);
}

// ---------------------------------------------------------------------
// 7. Other tools' deferred-context handling is unchanged (regression).
// ---------------------------------------------------------------------
{
  // index_file_content path still works (uses transcript, not runtime).
  const deferred = buildDeferredToolContext({
    tool: { id: "index_file_content" },
    args: {},
    transcript: [
      { type: "tool_result", tool: "read_file_text", success: true, observation: "x", metadata: { path: "/tmp/a.md" } }
    ]
  });
  check("regression: index_file_content deferred context still built from transcript",
    deferred !== null && Array.isArray(deferred.transcript));
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
