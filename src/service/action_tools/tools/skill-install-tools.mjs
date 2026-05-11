// C18 #2b (lingxy_codex_ready_agent_runtime_upgrade_plan.md, 2026-05-08): two-step LLM-callable skill
// install. Implements D's pre-design ACCEPT (option-c):
//
//   1. preview_skill_from_github(url) — clones to staging + validates
//      SKILL.md, returns preview content + state_token. NO user-
//      visible mutation. risk_level: low, no confirmation.
//
//   2. install_skill_from_github(state_token) — finalizes the
//      previewed install (atomic swap + registry append). risk_level:
//      HIGH, requires_confirmation. The user approves THE SKILL.md
//      they previewed in step 1, not just an opaque URL.
//
// The split is what makes this safe enough to expose to the LLM:
// the user reads the SKILL.md preview the LLM showed them, then the
// install card asks them to approve THAT EXACT staged content
// (bound by contentHash on the stagingInfo, validated at the
// approval-creation site in agent-loop's confirmation gate).
//
// Constitution (CADRE C):
//   - 不打补丁: both tools delegate to stage / finalize from
//     github-install.mjs. No skill-specific logic in the action
//     tool wrapper beyond shape adaptation.
//   - 不针对特定提问: surface gating (shouldExposeSkillInstall in
//     tool-surface.mjs) is class-level — verb + URL co-occurrence
//     in user_command, not a per-prompt allowlist.

import {
  stageSkillFromGitHub,
  finalizeStagedInstall,
  discardStagedInstall
} from "../../ai/skills/github-install.mjs";
import { createActionResult } from "../types.mjs";

// Truncated preview shown to the LLM in the tool result. The full
// SKILL.md is held in the staging registry until install commits.
// Codex pre-design: "Show ... validator heading + description, then
// an excerpt of the first ~20 lines or ~800-1000 chars with truncation."
const PREVIEW_MAX_CHARS = 1000;

function truncateForLlm(markdown) {
  if (typeof markdown !== "string") return "";
  if (markdown.length <= PREVIEW_MAX_CHARS) return markdown;
  return `${markdown.slice(0, PREVIEW_MAX_CHARS)}\n\n[…truncated; ${markdown.length - PREVIEW_MAX_CHARS} more chars in the full SKILL.md held in staging]`;
}

export const PREVIEW_SKILL_FROM_GITHUB_TOOL = {
  id: "preview_skill_from_github",
  name: "Preview Skill from GitHub",
  description: `Clone a GitHub skill repository to a temp staging area and return a preview of its SKILL.md. NO user-visible install happens — the staged clone lives in the runtime's install-state registry (10 min TTL) until install_skill_from_github commits it.

Returns a state_token in the metadata that install_skill_from_github needs.

URL forms accepted:
- https://github.com/owner/repo
- https://github.com/owner/repo#branch
- https://github.com/owner/repo/tree/<branch>/<sub/path>

Branches with "/" in their name (e.g. feat/x): use the #branch form, the /tree/ form is ambiguous.

Use this tool BEFORE install_skill_from_github so the user sees what they're installing.`,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      url: {
        type: "string",
        description: "GitHub URL — repo root, repo#branch, or /tree/<branch>/<sub/path> form."
      }
    },
    required: ["url"]
  },
  risk_level: "low",
  required_capabilities: ["network", "file_write"],
  requires_confirmation: false,
  policy_group: null,
  formatObservation(args) {
    return `Previewed skill from ${args.url}`;
  },
  async execute(args = {}, ctx = {}) {
    const _stage = ctx._testSeam?.stageSkill ?? stageSkillFromGitHub;
    const _discard = ctx._testSeam?.discardInstall ?? discardStagedInstall;
    const url = String(args?.url ?? "").trim();
    if (!url) {
      return createActionResult({
        success: false,
        observation: "url is required",
        metadata: { tool_id: "preview_skill_from_github", error: "missing_url" }
      });
    }
    const stage = await _stage({ url, runtime: ctx.runtime });
    if (!stage.ok) {
      return createActionResult({
        success: false,
        observation: stage.message ?? "skill staging failed",
        error: stage.error ?? null,
        metadata: { tool_id: "preview_skill_from_github", error: stage.error ?? "stage_failed" }
      });
    }
    const registry = ctx.runtime?.skillInstallState;
    if (!registry || typeof registry.put !== "function") {
      // Defensive: if the runtime doesn't have a registry wired,
      // don't leak the staging dir.
      await _discard(stage.stagingInfo);
      return createActionResult({
        success: false,
        observation: "skill install state registry not available on this runtime",
        metadata: { tool_id: "preview_skill_from_github", error: "no_state_registry" }
      });
    }
    const token = registry.put(stage.stagingInfo);
    const info = stage.stagingInfo;
    return createActionResult({
      success: true,
      observation: `Previewed ${info.targetIdentifier}. State token: ${token}. Heading: "${info.descriptor.heading}". Description: ${info.descriptor.description}\n\nSKILL.md preview:\n${truncateForLlm(info.preview.markdown)}`,
      metadata: {
        tool_id: "preview_skill_from_github",
        state_token: token,
        owner: info.owner,
        repo: info.repo,
        branch: info.branch,
        subPath: info.subPath,
        target_identifier: info.targetIdentifier,
        descriptor_heading: info.descriptor.heading,
        descriptor_description: info.descriptor.description,
        preview_size_bytes: info.preview.sizeBytes,
        content_hash: info.preview.contentHash
      }
    });
  }
};

export const INSTALL_SKILL_FROM_GITHUB_TOOL = {
  id: "install_skill_from_github",
  name: "Install Skill from GitHub (Confirm)",
  description: `Commit a skill install staged by preview_skill_from_github. Takes the state_token from the preview's metadata.

REQUIRES CONFIRMATION. The approval card shows the full SKILL.md content + owner/repo/branch/subPath + content hash so the user is approving the EXACT bytes they previewed. Installing third-party SKILL.md introduces external instructions into the LLM's future prompt context, so this is a high-risk action.

Failure modes:
- state_token expired (TTL is 10 min) or already used → call preview_skill_from_github again
- finalize fails (filesystem lock, etc.) → original skill (if any) is preserved via backup`,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      state_token: {
        type: "string",
        description: "The state_token from a previous preview_skill_from_github call's metadata."
      }
    },
    required: ["state_token"]
  },
  risk_level: "high",
  required_capabilities: ["file_write"],
  requires_confirmation: true,
  policy_group: null,
  formatObservation(_args, result) {
    if (!result?.success) return "Skill install rejected or failed";
    const meta = result?.metadata ?? {};
    return `Installed skill ${meta.owner ?? "?"}/${meta.repo ?? "?"} → ${meta.root_path ?? "?"}`;
  },
  async execute(args = {}, ctx = {}) {
    const _finalize = ctx._testSeam?.finalizeInstall ?? finalizeStagedInstall;
    const token = String(args?.state_token ?? "").trim();
    if (!token) {
      return createActionResult({
        success: false,
        observation: "state_token is required",
        metadata: { tool_id: "install_skill_from_github", error: "missing_state_token" }
      });
    }
    const registry = ctx.runtime?.skillInstallState;
    if (!registry || typeof registry.consume !== "function") {
      return createActionResult({
        success: false,
        observation: "skill install state registry not available on this runtime",
        metadata: { tool_id: "install_skill_from_github", error: "no_state_registry" }
      });
    }
    const stagingInfo = registry.consume(token);
    if (!stagingInfo) {
      return createActionResult({
        success: false,
        observation: "state_token not found or expired. Call preview_skill_from_github first.",
        metadata: { tool_id: "install_skill_from_github", error: "state_token_invalid" }
      });
    }
    const result = await _finalize(stagingInfo, { runtime: ctx.runtime });
    if (!result.ok) {
      // Finalize already removed the staging dir on failure.
      return createActionResult({
        success: false,
        observation: result.message ?? "skill install failed",
        error: result.error ?? null,
        metadata: { tool_id: "install_skill_from_github", error: result.error ?? "install_failed" }
      });
    }
    return createActionResult({
      success: true,
      observation: `Installed skill from ${result.owner}/${result.repo}${result.subPath ? `:/${result.subPath}` : ""} → ${result.rootPath}`,
      metadata: {
        tool_id: "install_skill_from_github",
        owner: result.owner,
        repo: result.repo,
        branch: result.branch,
        subPath: result.subPath,
        root_path: result.rootPath,
        descriptor_heading: result.descriptor?.heading ?? null,
        descriptor_description: result.descriptor?.description ?? null,
        warnings: result.warnings ?? []
      }
    });
  }
};
