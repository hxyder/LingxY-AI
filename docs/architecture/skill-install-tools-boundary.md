# Skill Install Tools Boundary

CAP-1 deferred family assessment. Status: 2026-05-11, boundary and runtime
security preflight documented, not moved.

## Current State

- File: `src/service/action_tools/tools/skill-install-tools.mjs`
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

Three imports from `github-install.mjs` — these are already at `../../ai/skills/` and would remain correct after a move to `capabilities/tools/`.

## Current Verifier Coverage

- `scripts/verify-skill-install-tools-contract.mjs` locks tool ids, risk
  levels, confirmation gate, current owner exports, delegation references,
  contentHash references, surface-gating presence, and boundary document.
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

**Preflight only in this phase.** Higher risk than memory-tools due to
confirmation gate and security boundary. Static and runtime/security preflight
coverage now exists, but the file is intentionally not moved in the same phase.
A physical move must be a separate commit that updates imports/inventories,
adds old-path guards, and reruns the runtime/security verifiers after the path
change.
