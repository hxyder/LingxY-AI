# Desktop Capture And GUI Tools Boundary

CAP inline high-risk family extraction. Status: 2026-05-11, moved to
`src/service/capabilities/tools/desktop-capture-gui-tools.mjs` after static
preflight verification.

## Current State

- Current owner: `src/service/capabilities/tools/desktop-capture-gui-tools.mjs`
- Registry aggregator: `src/service/action_tools/tools/index.mjs`
- Tool family:
  - `take_screenshot`
  - `gui_find_element`
  - `gui_click`
  - `gui_type_text`
- Shared helper functions:
  - `buildGuiFindScript`
  - `runGuiPsScript`
- External script:
  - `scripts/capture-screenshot.ps1`

## Contract

- `take_screenshot` remains low risk and does not require confirmation.
- `gui_find_element` remains low risk and does not require confirmation.
- `gui_click` remains high risk and requires confirmation.
- `gui_type_text` remains high risk and requires confirmation.
- Tool ids, schema keys, required capabilities, metadata names, and artifact
  result shape must remain stable.
- Screenshot output must remain a PNG artifact with `artifactPaths` and
  `mime_type: "image/png"`.
- GUI automation must remain Windows-only and must not move into Electron main
  or renderer code.

## No-Touch Areas

- Do not change IPC channels, HTTP routes, provider ids, storage schema, or
  artifact kinds.
- Do not change tool ids, confirmation gates, risk levels, or schema keys.
- Do not move this family again without first updating this verifier and
  preserving registry order, tool ids, risk levels, and confirmation gates.
- Do not add a compatibility barrel or duplicate reachable implementation.

## Verification

- `scripts/verify-desktop-capture-gui-tools-contract.mjs` locks the moved
  owner, helper functions, tool metadata, schema references, PowerShell capture
  boundary, aggregator import, old inline body absence, and this document.
- `scripts/verify-action-tools.mjs` exercises `take_screenshot` with a stubbed
  capture command and verifies a non-empty PNG artifact.
- GUI behavior remains covered by `npm run verify:desktop-gui-smoke` for shell
  and user interaction flows.

## Decision

Moved. The current owner is
`src/service/capabilities/tools/desktop-capture-gui-tools.mjs`.
`src/service/action_tools/tools/index.mjs` remains the live aggregator and must
not reintroduce inline screenshot or GUI tool bodies.
