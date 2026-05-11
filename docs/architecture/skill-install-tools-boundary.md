# Skill Install Tools Boundary

CAP-1 deferred family assessment. Status: 2026-05-11, boundary documented, not moved.

## Current State

- File: `src/service/action_tools/tools/skill-install-tools.mjs` (211 lines)
- Tools: `preview_skill_from_github` (low risk, no confirmation), `install_skill_from_github` (high risk, requires_confirmation)
- Two-step LLM-callable install: preview (staging + validate SKILL.md) → install (atomic swap + registry append)
- Aggregated into `BUILTIN_ACTION_TOOLS` via named exports

## Dependencies

| Import | Current path | Post-move path |
|--------|-------------|----------------|
| `stageSkillFromGitHub` | `../../ai/skills/github-install.mjs` | Unchanged |
| `finalizeStagedInstall` | `../../ai/skills/github-install.mjs` | Unchanged |
| `discardStagedInstall` | `../../ai/skills/github-install.mjs` | Unchanged |
| `createActionResult` | `../types.mjs` | `../../action_tools/types.mjs` |
| `createNoopTool` | `../tool-helper.mjs` | `../../action_tools/tool-helper.mjs` |
| `ACTION_TOOL_SCHEMAS` | `../schemas/index.mjs` | `../../action_tools/schemas/index.mjs` |

Three imports from `github-install.mjs` — these are already at `../../ai/skills/` and would remain correct after a move to `capabilities/tools/`.

## Security / Approval Boundary

- `install_skill_from_github` is confirmation-gated (requires_confirmation: true)
- Approval is bound by contentHash on stagingInfo — user approves the exact SKILL.md they previewed
- Surface gating in `tool-surface.mjs` (`shouldExposeSkillInstall`) is class-level
- Both tools delegate to `github-install.mjs` for actual staging/finalize/discard — no skill-specific logic in the action tool wrapper

## No-Touch Areas

- Tool ids: `preview_skill_from_github`, `install_skill_from_github`
- Confirmation gate (`requires_confirmation: true` for install)
- `contentHash` approval binding
- `shouldExposeSkillInstall` surface gating in `tool-surface.mjs`
- `github-install.mjs` imports (staging/finalize/discard)

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Confirmation gate must survive path change | High | Contract verifier locks requires_confirmation |
| `../../../ai/skills/github-install.mjs` post-move | Low | Already relative to project root, unchanged |
| `../tool-helper.mjs` post-move | Low | Standard CAP-1 path fix |

## Decision

**Preflight only in this phase.** Higher risk than memory-tools due to
confirmation gate and security boundary. Physical move requires:
1. Contract verifier (current step)
2. Approval flow test proving contentHash binding survives path change
3. Surface gating verifier (shouldExposeSkillInstall still gates correctly)
