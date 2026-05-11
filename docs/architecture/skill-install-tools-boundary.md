# Skill Install Tools Boundary

CAP-1 high-risk family migration. Status: 2026-05-11, moved to
`src/service/capabilities/tools/skill-install-tools.mjs` after static and
runtime/security preflight verification.

## Current State

- File: `src/service/capabilities/tools/skill-install-tools.mjs`
- Tools: `preview_skill_from_github` (low risk, no confirmation), `install_skill_from_github` (high risk, requires_confirmation)
- Two-step LLM-callable install: preview (staging + validate SKILL.md) → install (atomic swap + registry append)
- Aggregated into `BUILTIN_ACTION_TOOLS` via named exports

## Dependencies

| Import | Current path | Notes |
|--------|-------------|----------------|
| `stageSkillFromGitHub` | `../../ai/skills/github-install.mjs` | Unchanged |
| `finalizeStagedInstall` | `../../ai/skills/github-install.mjs` | Unchanged |
| `discardStagedInstall` | `../../ai/skills/github-install.mjs` | Unchanged |
| `createActionResult` | `../../capabilities/registry/types.mjs` | Result shape unchanged |

Three imports from `github-install.mjs` — these are already at `../../ai/skills/` and would remain correct after a move to `capabilities/tools/`.

## Current Verifier Coverage

- `scripts/verify-skill-install-tools-contract.mjs` locks tool ids, risk
  levels, confirmation gate, moved owner, old-path removal, exports,
  delegation references, contentHash references, surface-gating presence, and
  boundary document.
- `scripts/verify-skill-install-tools-runtime.mjs` executes preview and install
  with injected stage/finalize/discard seams, confirms cleanup on missing state
  registry, confirms state_token and contentHash-bound stagingInfo handoff, and
  exercises class-level surface gating.
- Existing broader gates still apply:
  `scripts/verify-skill-install-tools.mjs`,
  `scripts/verify-skill-install-approval-preview.mjs`, and
  `scripts/verify-skill-stage-finalize.mjs`.

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
| `../../ai/skills/github-install.mjs` post-move | Low | Same relative path from `capabilities/tools/`, unchanged |
| Narrow test seam must not change production behavior | Medium | Runtime verifier exercises injected seams; defaults remain production functions |

## Decision

Moved from the old action-tools owner to
`src/service/capabilities/tools/skill-install-tools.mjs` in CAP-1 as a focused
security/approval tool-family move. The old owner path must not return as a
compatibility barrel or parallel implementation.

Remaining follow-up:
- CAP-2 schemas/registry migration remains blocked until remaining high-risk
  tool families are classified and reviewed.
