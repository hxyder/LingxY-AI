# Desktop Product Acceptance Matrix

This matrix is the daily-desktop workflow gate that sits above foundational
smoke checks. It must be updated whenever a visible desktop workflow, settings
surface, capability-management surface, or recovery flow changes.

Rule: a workflow can be considered release-ready only when it has both an
automated gate and a manual or real-environment evidence path. `npm run check:fast`
is not enough by itself for user-visible desktop workflow changes.

Record release-candidate evidence with
`docs/release/desktop_product_evidence_pack.md` and the template at
`docs/release/evidence/desktop-product-evidence.template.json`.

## Workflow Matrix

| Workflow | User path | Automated gate | Manual / real evidence |
|---|---|---|---|
| First-run provider setup | Open Console, see missing-provider recovery, configure/test one provider or Code CLI, submit one short request | `verify:provider-setup-onboarding`, `verify:provider-routing`, `verify:console-runtime-client`, `verify:desktop-gui-smoke` | Capture provider test result and one successful short task with configured credentials. |
| Conversation continuity | Create a chat, branch/edit/rewind, attach a file, follow up, search prior conversation | `verify:conversation-message-flow`, `verify:conversation-branch-contract`, `verify:conversation-search-contract`, `verify:desktop-gui-smoke` | Record one follow-up that uses prior conversation context without restating it. |
| Task operations | Submit a tool-using task, stop/cancel, retry, inspect timeline, delete/restore | `verify:task-log`, `verify:task-branch`, `verify:cancellation-propagation`, `verify:user-interaction-smoke` | Confirm task status, timeline, and restored task are coherent in Console. |
| Artifact workflow | Generate/edit/open DOCX/XLSX/PPTX/PDF/HTML/SVG/Mermaid artifacts and attach them to the conversation | `verify:artifact-action-contract`, `verify:artifact-transform-flows`, `verify:preview-screenshot-diff`, `verify:desktop-gui-smoke` | Open generated files locally and inspect formatting, links, previews, and conversation attachments. |
| Memory governance | Create/approve/reject/delete/undo reviewed memory, filter by project/conversation, verify context injection scope | `verify:user-memory-profile`, `verify:memory-review-history`, `verify:memory-scope-filters`, `verify:memory-governance` | Run one project-scoped task and one unscoped task; confirm unrelated project memory is absent. |
| Marketplace governance | Review skill/plugin/MCP trust, signature, archive, and governance state; disable/archive a test plugin | `verify:marketplace-management-ui`, `verify:marketplace-trust-model`, `verify:marketplace-distribution-policy`, `verify:mcp-governance-policy` | Use a disposable plugin/MCP entry and capture before/after enable/archive state. |
| Scheduler and approvals | Create recurring and one-shot schedules, run now, trigger approval, approve/reject side effect | `verify:scheduler`, `verify:scheduled-fire-safety`, `verify:schedule-create-obligation`, `verify:user-interaction-smoke` | Restart between schedule creation and run; record approval card target data. |
| Connector workflows | Connect account, list mail/files/events, send or schedule a guarded side effect | `verify:unified-connectors`, `verify:connector-workflow-dispatcher`, `verify:workflow-first-dispatch`, `verify:email-send-routing` | Use a real test account and capture OAuth, list, and guarded send/calendar behavior. |
| Browser and Office entry | Browser popup/sidepanel/floating chip plus Word/Excel/PowerPoint add-in handoff | `verify:browser-ui-click-smoke`, `verify:browser-overlay`, `verify:office-base`, `verify:user-interaction-smoke` | Sideload in clean profiles and confirm selected context reaches the same runtime task path. |
| Native Windows entry | Explorer handoff, active-window probe, screenshots, launch/open/reveal file actions | `verify:native-integrations`, `verify:active-window-probe`, `verify:desktop-capture-gui-tools-contract`, `verify:desktop-launch-tools-contract` | Run from Explorer context menu with one and multiple files; verify files are not opened unless requested. |
| Recovery and diagnostics | Kill runtime during task/browser action, restart, export diagnostics and policy trace | `verify:approval-resume-state`, `verify:policy-trace-export`, `verify:runtime-graph-replay`, `verify:file-reversibility-checkpoint` | Capture post-restart task state, user-visible failure copy, and diagnostic bundle. |
| Performance and accessibility | Start app, navigate with keyboard, inspect smoke perf summary and focus/escape behavior | `verify:desktop-gui-perf-smoke`, `verify:a11y-keyboard-contract`, `verify:main-process-blocking`, `verify:renderer-stream-batching` | Save Electron GUI smoke result plus one keyboard-only walkthrough of Overlay and Console. |

## Execution Discipline

- For any desktop workflow change, run the row-specific verifier set plus
  `npm run check:fast`.
- Run `npm run verify:desktop-gui-smoke` for shell, renderer, popup, preview,
  approval, marketplace, memory, provider, conversation, or task-operation UI
  changes when Electron is available.
- Run real API/provider/OAuth/manual tests only when the row depends on
  credentials, hardware, Office tenant policy, browser sideload, or packaged app
  trust prompts.
- Copy partial/fail results into `docs/release/known_issues.md` with a
  workaround or explicit decision to hide the workflow before release.

## Completion Evidence

Each release candidate should record:

- Git commit under test.
- `npm run check` or `npm run check:fast` result.
- Electron GUI smoke result and check count.
- Rows manually exercised, with pass/partial/fail.
- Real provider/account/browser/Office/hardware environment used, when any.
- Links to known issues for every partial/fail row.
- A validated desktop product evidence pack for release-candidate work.
