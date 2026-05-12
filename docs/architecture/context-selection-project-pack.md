# Context Selection Project Pack

Status: CTX-001 contract complete as of 2026-05-12.

LingxY already stores `context_packet.compiled_context` with selected and
omitted context rows. CTX-001 adds a stable shared view-model that groups that
data into a user-visible context pack.

## Contract

- Selected context rows keep kind, source, inclusion reason, and provenance.
- Omitted context rows keep kind, source, omission reason, and counts.
- Project scope is explicit: project id, memory scope, and pack id.
- Attachments are grouped separately from inferred context.
- Conversation provenance includes parent task and branch source when present.
- Renderer surfaces consume the shared view-model instead of rebuilding pack
  logic from loose task fields.

## Owner

- Shared pack contract:
  `src/shared/context-selection-project-pack.mjs`
- Console task detail renderer:
  `src/desktop/renderer/console-task-detail.mjs`
- Verification:
  `scripts/verify-context-selection-project-pack.mjs`
  `tests/behavior/context-selection-project-pack.test.mjs`

## Verification

- `node --test tests/behavior/context-selection-project-pack.test.mjs`
- `node --test tests/behavior/context-debug-panel.test.mjs`
- `node scripts/verify-context-selection-project-pack.mjs`
- `npm run check:fast`
