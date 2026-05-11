# Desktop Capture And GUI Tools Boundary

CAP inline high-risk family preflight. Status: 2026-05-11, preflight only.
The screenshot and GUI automation tools have not been physically extracted from
`src/service/action_tools/tools/index.mjs`.

## Current State

- Current owner: `src/service/action_tools/tools/index.mjs`
- Tool family:
  - `take_screenshot`
  - `gui_find_element`
  - `gui_click`
  - `gui_type_text`
- Shared helper functions still inline:
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
- Do not move this family in the preflight commit.
- Do not add a compatibility barrel or duplicate reachable implementation.

## Verification

- `scripts/verify-desktop-capture-gui-tools-contract.mjs` locks the current
  owner, inline helper functions, tool metadata, schema references, PowerShell
  capture boundary, and this document.
- `scripts/verify-action-tools.mjs` exercises `take_screenshot` with a stubbed
  capture command and verifies a non-empty PNG artifact.
- GUI behavior remains covered by `npm run verify:desktop-gui-smoke` for shell
  and user interaction flows.

## Decision

Preflight only. The current owner remains
`src/service/action_tools/tools/index.mjs`. A later extraction may move this
family only after the verifier is updated to lock the moved owner, old inline
body absence, and unchanged GUI/screenshot behavior.
