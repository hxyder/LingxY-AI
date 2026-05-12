# WindowSession State Machine

DX-001 introduces a desktop-owned state contract for window and task ownership.
The first implementation lives in `src/desktop/shared/window-session-state.mjs`.

## Decision

One `WindowSession` state object is created by the Electron shell and injected
into window managers that need ownership checks. It tracks:

- managed shell windows: dock, overlay, console, preview, and system surfaces;
- task owner to conversation owner bindings;
- preview window binding to task/conversation/artifact;
- popup-card owner metadata for task, conversation, and approval cards;
- background/system task ownership;
- rejected stale window events.

## Current Enforcement

- Preview `init` payloads bind the preview window to a task/conversation when
  those ids are present.
- Preview delta/commit payloads are rejected when they target a different task
  than the current preview owner.
- Popup cards register/unregister owner metadata in the same state object.
- Electron-managed shell windows are bound at creation.

This does not yet remove every renderer-local cache. It creates the shared owner
contract and wires the highest-risk cross-window surfaces first: preview deltas
and popup cards.

## Invariants

- A window that is bound to task A must reject task B deltas unless explicitly
  rebound.
- A conversation-specific window event must not be accepted by a window bound to
  another conversation.
- Popup-card ownership must be inspectable without reading renderer globals.
- Background/system tasks must have an explicit owner type.

## Verification

- `node --test tests/behavior/window-session-state.test.mjs`
- `node scripts/verify-window-session-state-machine.mjs`
- `npm run verify:desktop-gui-smoke`
- `npm run check:fast`
