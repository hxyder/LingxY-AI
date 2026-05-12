# Desktop Launch Tools Boundary

CAP inline high-risk family extraction. Status: 2026-05-11, moved to
`src/service/capabilities/tools/desktop-launch-tools.mjs` after static and
runtime-contract preflight verification.

## Current State

- Current owner: `src/service/capabilities/tools/desktop-launch-tools.mjs`
- Registry aggregator: `src/service/action_tools/tools/index.mjs`
- Tool family:
  - `launch_app`
- Public helpers:
  - `normalizeLaunchCandidates`
  - `createLaunchAmbiguityResult`
- Internal helpers:
  - `resolveAppCommand`
  - `hasKnownAppAlias`
  - `looksLikeExecutableTarget`
  - `stableLaunchCandidateId`
  - `findPythonLauncherScript`
  - `tryPythonLauncher`
  - `resolveAppViaStartMenu`
- External script:
  - `scripts/app_launcher/launcher.py`

## Contract

- `launch_app` remains medium risk and does not require confirmation.
- Tool id, schema key, required capability, metadata names, and registry order
  must remain stable.
- Ambiguous Windows launcher results must keep
  `metadata.disambiguation_type: "launch_app_candidate"` and
  `metadata.next_tool: "launch_app"`.
- Python launcher probing must preserve the dev and packaged script lookup
  behavior for `scripts/app_launcher/launcher.py`.
- Windows behavior must preserve the existing order: Python launcher for
  non-executable unknown aliases, `Start-Process`, `Get-StartApps`, then final
  Python launcher fallback.
- Non-Windows behavior must preserve detached `spawn` launch semantics.

## No-Touch Areas

- Do not change IPC channels, HTTP routes, provider ids, storage schema, tool
  ids, artifact kinds, or storage records.
- Do not change risk level, confirmation gate, required capability, schema key,
  or registry order.
- Do not add a compatibility barrel or duplicate reachable implementation.
- Do not move this family into Electron main, preload, renderer, or desktop UI.

## Verification

- `scripts/verify-desktop-launch-tools-contract.mjs` locks the moved owner,
  public helper exports/re-exports, launcher helper presence, Python script
  path, registry metadata, old inline body absence, and this document.
- Existing behavior coverage includes `tests/behavior/launch-app-ambiguity.test.mjs`
  and `tests/behavior/agent-loop-sequencing.test.mjs`.

## Decision

Moved. The current owner is
`src/service/capabilities/tools/desktop-launch-tools.mjs`.
`src/service/action_tools/tools/index.mjs` remains the live aggregator and must
not reintroduce inline desktop launch helper or tool bodies.
