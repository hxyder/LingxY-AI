# Desktop Launch Tools Boundary

CAP inline high-risk family extraction preflight. Status: 2026-05-11, current
owner remains `src/service/action_tools/tools/index.mjs`; target owner is
`src/service/capabilities/tools/desktop-launch-tools.mjs`.

## Current State

- Current owner: `src/service/action_tools/tools/index.mjs`
- Target owner: `src/service/capabilities/tools/desktop-launch-tools.mjs`
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

- `scripts/verify-desktop-launch-tools-contract.mjs` currently locks this
  preflight state: inline owner, public helper exports, launcher helper
  presence, Python script path, registry metadata, and this document.
- The physical move must update the verifier to require
  `src/service/capabilities/tools/desktop-launch-tools.mjs`, require
  `index.mjs` to import/re-export from that owner, and require absence of old
  inline launch helper/tool definitions.
- Existing behavior coverage includes `tests/behavior/launch-app-ambiguity.test.mjs`
  and `tests/behavior/agent-loop-sequencing.test.mjs`.

## Decision

Preflight only. Do not claim this family moved until the verifier requires the
new capability owner and proves the old inline owner text is gone.
