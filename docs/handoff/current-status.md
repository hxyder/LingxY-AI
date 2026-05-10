# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Status: Phases 2B.42–2B.48 Submitted; Codex Review Requires One Verifier Follow-up

DeepSeek has committed the planned 2B.42-2B.48 extraction work and the 2B.47 GUI smoke scheduling code fix. Codex review accepts the product-code fix, but Phase 2B should not be closed until the scheduling-order invariant is locked in a verifier.

## Completed Phases

| Phase | Module | Lines |
|-------|--------|-------|
| 2B.42 | `desktop-window-lifecycle.mjs` | ~145 |
| 2B.43 | `desktop-window-actions.mjs` | ~106 |
| 2B.44 | `desktop-shortcut-router.mjs` | ~220 |
| 2B.45 | `desktop-link-browser-window.mjs` | ~252 |
| 2B.46 | `desktop-preview-window-manager.mjs` | 124 |
| 2B.47 | `desktop-gui-smoke-runner.mjs` | 785 |
| 2B.48 | `desktop-permission-handler.mjs` | 35 |

## electron-main.mjs Reduction

- Original: 2543 lines
- Current: 1072 lines
- Net reduction: **-1471 lines (-58%)**

## Verification

- GUI smoke: 44/44 checks pass (unchanged since start)
- `npm run check:fast`: 65/65 pass
- All dedicated verifiers updated for new module ownership
- IPC contract snapshot stable
- Codex rerun on 2026-05-10: `npm run check:fast` passed 65/65 and behavior tests passed 986/986; no current behavior-test failure was observed in this review

## Codex Review: Phases 2B.47-2B.48

Review scope:
- DeepSeek commits inspected: `15faf80`, `af684e3`, `e4c4d33`, `3ca2e05`.
- Product source changed by DeepSeek, not by Codex in this review.
- Codex only updated planning/handoff notes.

Accepted:
- Phase 2B.48 `src/desktop/tray/desktop-permission-handler.mjs` is a focused Electron-main helper with explicit dependency injection.
- The permission handler is installed before window creation, preserving the previous Web Speech/media permission behavior surface.
- Phase 2B.47 now returns `writeDesktopGuiSmokeResult` from `createDesktopGuiSmokeRunner(...)`, so the previous dangling outer failure-path symbol has been addressed.
- Commit `3ca2e05` moved the `LINGXY_ELECTRON_GUI_SMOKE` `setTimeout(() => runDesktopGuiSmoke(), 250)` registration after `createDesktopGuiSmokeRunner(...)`, resolving the temporal-dead-zone startup-order risk in product code.

Required follow-up before Phase 2B closure:
- Strengthen `scripts/verify-desktop-gui-perf-smoke.mjs` or `scripts/verify-main-process-blocking.mjs` so it asserts the invariant DeepSeek just fixed: `createDesktopGuiSmokeRunner(...)` must appear before the GUI smoke `setTimeout` registration in `electron-main.mjs`.
- Keep the existing reverse checks that `electron-main.mjs` does not redefine internal smoke helpers and that the outer failure path still emits `LINGXY_GUI_SMOKE_RESULT`.
- This is now a verifier/documentation blocker, not a product-source blocker. No additional runtime behavior change is required for this specific issue.

Codex verification on 2026-05-10:
- `node --check src/desktop/tray/electron-main.mjs`: passed.
- `node --check src/desktop/tray/desktop-gui-smoke-runner.mjs`: passed.
- `node --check src/desktop/tray/desktop-permission-handler.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-main-process-blocking.mjs`: passed.
- `node scripts/verify-ipc-contract-inventory.mjs`: passed.
- `node scripts/verify-desktop-shell.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

## Codex Review: 2B.47 Scheduling Fix (`3ca2e05`)

Accepted:
- The GUI smoke timer is now registered after the runner factory call, so both `runDesktopGuiSmoke` and `writeDesktopGuiSmokeResult` are initialized before the 250ms timer can fire.
- The fix preserves the existing smoke check names, stdout prefix, failure payload shape, IPC surface, HTTP routes, tool ids, artifact kinds, provider ids, and storage schema.
- Verification passed after the fix: `npm run check:fast` 65/65 and `npm run verify:desktop-gui-smoke` 44/44.

Remaining review note:
- DeepSeek did not update a verifier to lock the exact ordering. Phase 2B.49 should add that guard before marking Electron main decomposition complete.

## Deferred

- `app.on("activate")` / `app.on("before-quit")` handlers remain in electron-main.mjs — they touch too many internal states to extract cleanly without disproportionate ceremony
- Recurring tray badge / morning digest timers (6 lines) — extraction ceremony outweighs benefit

## Codex Review: Phase 2C Completion Claim

Review date: 2026-05-10.

Conclusion:
- Phase 2C's main renderer-boundary goal is effectively achieved in code: executable renderer `fetch(` references are locked at 0, and direct `window.ucaShell` references are down to the 6 dedicated shell client modules.
- Do not start Phase 2D product source moves yet. There is one stale verifier issue that must be fixed first.

Blocking cleanup before 2D source work:
- `node scripts/verify-audio-entrypoints.mjs` fails with `main process missing audio bridge: setPermissionRequestHandler`.
- Root cause: the verifier still scans only `electron-main.mjs` / `desktop-window-actions.mjs` for permission-handler text, but Phase 2B moved that code to `src/desktop/tray/desktop-permission-handler.mjs`.
- Fix the verifier to scan the current owner set, then rerun the audio verifier, renderer direct-runtime verifier, `check:fast`, and GUI smoke.

2D direction after cleanup:
- Open Phase 2D with `2D.0` inventory/verifier work only.
- The next framework target is `src/service/action_tools/tools/index.mjs`, but do not immediately move tool families.
- First lock tool id order, confirmation-gated ids, external aggregation, and old-owner text assertions.

## Codex Review: 2C Closure + 2D.0 Inventory

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `1c5274c` — adds `desktop-permission-handler.mjs` to `verify-audio-entrypoints.mjs`.
- `28fa31c` — documents Phase 2D.0 tool registry family inventory and strengthens `verify-tool-registry-snapshot.mjs`.

Accepted:
- `verify-audio-entrypoints.mjs` now scans the current permission-handler owner, so the old owner text assertion is fixed.
- Phase 2D.0 did not move product tool source. It only changed docs/verifier, which matches the required inventory-first discipline.
- `verify-tool-registry-snapshot.mjs` now locks the actual 61-tool `BUILTIN_ACTION_TOOLS` count, frozen order, duplicate-id guard, and confirmation-gated ids.

Codex cleanup:
- Corrected stale `64 ids` text to `61 ids` in `docs/architecture/tool-registry-inventory.md` and `linxi_codebase_reorganization_execution_plan.md`.

Verification rerun by Codex:
- `node scripts/verify-audio-entrypoints.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-renderer-direct-runtime-calls.mjs`: passed.
- `node scripts/verify-desktop-renderer.mjs`: passed.
- `node scripts/verify-desktop-gui-perf-smoke.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Next allowed step:
- Phase 2D.1 may start, but only the low-risk browser/web/search/translation family should move first.
- Do not move `write_file`, `edit_file`, `run_script`, `generate_document`, `register_artifact`, GUI automation, or capability creator tools in the first extraction.

## Codex Review: Phase 2D.1 Browser/Web Tool Extraction

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `907dd00` — extracts browser/web/search/translation tools from `src/service/action_tools/tools/index.mjs`.

Accepted:
- The intended 2D.1 product move is scoped to the approved family: `OPEN_URL_TOOL`, `WEB_SEARCH_TOOL`, `WEB_SEARCH_FETCH_TOOL`, `FETCH_URL_CONTENT_TOOL`, and `TRANSLATE_TEXT_TOOL`.
- High-risk tools such as `write_file`, `edit_file`, `run_script`, `generate_document`, `register_artifact`, GUI automation, and capability creator remain in `tools/index.mjs`.
- `BUILTIN_ACTION_TOOLS` id order/count and confirmation-gated tool list remain stable.

Blocker before Phase 2D.2:
- `openWithDefaultHandler` now has two implementations: one local copy in `src/service/action_tools/tools/browser-web-tools.mjs` and one exported implementation in `src/service/action_tools/tools/open-with-default-handler.mjs`.
- This violates the one-owner rule and creates drift risk. The new browser/web module should import the shared helper instead of redefining it, or the shared helper module should be removed if it is not the intended owner.
- Add/strengthen verifier coverage so 2D.1 cannot be marked complete while duplicated helper implementations exist.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/browser-web-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/open-with-default-handler.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-web-search-link-contract.mjs`: passed.
- `node scripts/verify-open-url-surface-gating.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Do not start 2D.2 until the duplicate `openWithDefaultHandler` ownership is resolved and locked by verifier.

## Codex Direction: Capability Directory Architecture

Review date: 2026-05-10.

The target architecture has been added to `linxi_codebase_reorganization_execution_plan.md` under `Phase 2D.X — Long-term capability directory architecture`.

Important direction:
- Tools, skills, MCP, connectors, providers, and code-cli adapters should eventually live under a clean `src/service/capabilities/**` source layout.
- Built-in source capabilities belong in source directories; user-installed skills/MCP/tools/connectors must live under runtime data paths, not under `src/`.
- Legacy paths such as `src/service/action_tools/**`, `src/service/ai/skills/**`, `src/service/ai/mcp/**`, and `src/service/connectors/**` may become compatibility barrels during migration, but they must not contain parallel implementations after the new owner is verified.

Do not jump directly into the full `src/service/capabilities/**` migration yet.

Immediate order:
- First fix the Phase 2D.1 duplicate `openWithDefaultHandler` ownership.
- Continue Phase 2D family extraction under the current `action_tools` layout.
- Start a later `CAP-0` phase for docs/verifier-only capability directory inventory before any broad source moves.

## Codex Direction: Whole-Repository Cleanliness

Review date: 2026-05-10.

The plan now also includes `Phase 2D.Y — Whole-repository directory architecture and cleanliness standard`.

Scope:
- This applies to all code and files, not only tools/skills/MCP.
- Future cleanup must cover desktop app code, service runtime, shared contracts, workers, scripts, tests, docs, assets/generated files, config, and native host boundaries.

Target direction:
- Long term, the repo should move toward `apps/` + `packages/` style ownership:
  - `apps/desktop/**`
  - `apps/native-host/**`
  - `packages/service/**`
  - `packages/shared/**`
  - grouped `scripts/**`, `tests/**`, `docs/**`, `assets/**`, `config/**`
- This is a target architecture, not permission to do a cosmetic root-directory reshuffle now.

Execution order:
- Keep current immediate blocker first: fix duplicate `openWithDefaultHandler` ownership.
- Continue current Phase 2D tool-family extraction.
- Add `CAP-0` and `REPO-0` docs/verifier-only inventory phases before broad physical moves.
- Every later directory migration must have owner docs, compatibility barrels if needed, cleanup verifiers, and no stale old-owner assertions.

## Codex Review: 2D.1 Fix + 2D.2 OS/App File Tools

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `7c6ed09` — removes duplicate `openWithDefaultHandler` from `browser-web-tools.mjs`.
- `06d55cf` — extracts `OPEN_FILE_TOOL`, `REVEAL_IN_EXPLORER_TOOL`, and `FILE_OP_TOOL` into `src/service/action_tools/tools/os-app-tools.mjs`.

Accepted:
- The 2D.1 blocker is fixed in product code: `openWithDefaultHandler` now has one function owner at `src/service/action_tools/tools/open-with-default-handler.mjs`.
- Browser/web tools and OS/app file tools both import the shared helper instead of carrying separate copies.
- The 2D.2 product move is behavior-light and keeps tool ids, registry count/order, confirmation gating, and runtime behavior stable.

Scope correction:
- Treat `06d55cf` as `Phase 2D.2a`, not full 2D.2 completion.
- Remaining OS/clipboard/notification tools still in `tools/index.mjs` include `COPY_TO_CLIPBOARD_TOOL`, `READ_CLIPBOARD_TOOL`, `NOTIFY_TOOL`, and `TAKE_SCREENSHOT_TOOL`.
- Keep `LAUNCH_APP_TOOL` deferred for now because its Windows/Python launcher path and GUI expectations are higher risk.
- `FILE_OP_TOOL` was moved even though the first 2D.2 outline focused on open/reveal/clipboard/notify. This is acceptable because it is simple and passed verification, but later file-write extraction must account for its new owner.

Verifier gap before 2D.3:
- `scripts/verify-tool-registry-snapshot.mjs` still locks ids/count/order but does not yet enforce source ownership.
- Before marking 2D.2 complete or starting 2D.3, add reverse owner assertions that:
  - only `open-with-default-handler.mjs` defines `function openWithDefaultHandler`;
  - `browser-web-tools.mjs` and `os-app-tools.mjs` import that shared helper;
  - `tools/index.mjs` no longer defines extracted browser/web or OS/app file tool bodies except imports and `BUILTIN_ACTION_TOOLS` aggregation.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/os-app-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/browser-web-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/action_tools/tools/open-with-default-handler.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-open-url-surface-gating.mjs`: passed.
- `node scripts/verify-web-search-link-contract.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65, behavior tests 986/986.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Do not open Phase 2D.3 yet.
- Next DeepSeek step should be `2D.2b`: add source-owner verifier assertions and finish the remaining low/medium-risk OS/clipboard/notification extraction, or explicitly split the plan so 2D.2a is closed and 2D.2b is the blocking follow-up.

## Codex Review: 2D.2b + 2D.3 Scheduler Extraction

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `6c886af` — extracts `COPY_TO_CLIPBOARD_TOOL` and `NOTIFY_TOOL` into `src/service/action_tools/tools/os-app-tools.mjs`.
- `bc98971` — extracts scheduler tools into `src/service/action_tools/tools/scheduler-tools.mjs`.

Accepted behavior:
- Tool ids, `BUILTIN_ACTION_TOOLS` order/count, confirmation-gated ids, and action-tool smoke checks remain stable.
- Scheduler behavior appears preserved: create/list/delete/pause moved together with `getSchedulerRuntime`, and the scheduled-fire anti-reschedule guard stayed with `CREATE_SCHEDULED_TASK_TOOL`.
- `COPY_TO_CLIPBOARD_TOOL` and `NOTIFY_TOOL` now live with the OS/app file tools, which is directionally correct for the current `action_tools` layout.

Process issue:
- The previous Codex review required source-owner verifier assertions before opening 2D.3. DeepSeek did not update `scripts/verify-tool-registry-snapshot.mjs` or add a focused owner verifier in `6c886af`.
- 2D.3 therefore ran with behavior verification but without the requested old-owner regression guard.

Scope correction:
- Do not claim full 2D.2 completion yet. `READ_CLIPBOARD_TOOL` remains a `NOOP_TOOLS` reference in `index.mjs`, and `TAKE_SCREENSHOT_TOOL` still remains in `index.mjs`.
- Do not claim Phase 2D ownership cleanup complete. `scripts/verify-tool-registry-snapshot.mjs` still checks registry ids/count/order and family headings, but it does not enforce extracted-source ownership.

Required before Phase 2D.4:
- Add verifier assertions for extracted owners:
  - `browser-web-tools.mjs` owns browser/web/search/translation tool bodies.
  - `os-app-tools.mjs` owns `OPEN_FILE_TOOL`, `REVEAL_IN_EXPLORER_TOOL`, `FILE_OP_TOOL`, `COPY_TO_CLIPBOARD_TOOL`, and `NOTIFY_TOOL`.
  - `scheduler-tools.mjs` owns scheduler tool bodies and `getSchedulerRuntime`.
  - `tools/index.mjs` only imports those extracted owners and aggregates them in `BUILTIN_ACTION_TOOLS`.
  - only `open-with-default-handler.mjs` defines `function openWithDefaultHandler`.
- Update `docs/architecture/tool-registry-inventory.md` to reflect the current owner files after 2D.2b and 2D.3.
- Keep `LAUNCH_APP_TOOL`, `READ_CLIPBOARD_TOOL`, and `TAKE_SCREENSHOT_TOOL` explicitly deferred with named reasons if they are not moved in the next cleanup.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/os-app-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/scheduler-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-user-interaction-smoke.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `npm run check:fast`: passed 65/65, behavior tests 986/986.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Current product behavior is acceptable.
- Do not proceed to Phase 2D.4 yet.
- Next step must be a verifier/inventory cleanup phase for 2D extracted owner boundaries, then rerun `check:fast` and desktop GUI smoke.
