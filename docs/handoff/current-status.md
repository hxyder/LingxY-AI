# Branch Status: task/uca-077-connector-foundation

**Date:** 2026-05-10

## Status: Phases 2B-2G + CAP-0 Inventory/Checkpoint Complete; All Codex Blockers Resolved

All planned low-risk extraction and inventory work across Phases 2A through 2G and CAP-0 is committed. High-risk deferred items: write/edit/run/generate/render tools, GUI automation, capability creator, full capability migration, desktop app directory move. All Codex review blockers from rounds 1-6 resolved. check:fast 69/69 green.

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

## Codex Review: 2D Owner Verifier + 2D.4 Stat/Verify Slice

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `9d4c67b` — adds source-owner assertions to `scripts/verify-tool-registry-snapshot.mjs` and updates `docs/architecture/tool-registry-inventory.md`.
- `cc14717` — extracts `STAT_FILE_TOOL` and `VERIFY_FILE_EXISTS_TOOL` into `src/service/action_tools/tools/file-read-tools.mjs`.

Accepted:
- DeepSeek did add the missing owner verifier before the 2D.4 product move.
- The verifier now locks current extracted owners for browser/web, OS/app, scheduler, file stat/verify, and the shared open handler.
- The 2D.4 source move is a reasonable narrow first slice: `stat_file` and `verify_file_exists` are self-contained, low-risk file-read tools.
- Direct source search confirms these moved tool bodies are currently only exported from `file-read-tools.mjs`.

Issues to fix before continuing 2D.4:
- `docs/architecture/tool-registry-inventory.md` now has an internal inconsistency: it adds `File Stat / Verify` as an extracted family but the inline `File Discovery / Read / Index` row still lists `stat_file` and `verify_file_exists`.
- `npm run check:fast` did not produce a stable clean run during Codex review. Two full runs failed at `node scripts/verify-behavior-tests.mjs` with `# pass 985 / # fail 1`; direct reruns of `node scripts/verify-behavior-tests.mjs` passed `986/986`, so this may be intermittent, but it is still a release-gate blocker until reproduced cleanly or explained.

Verifier improvement still recommended:
- The new source-owner assertions are useful, but they mostly check named owner files and `index.mjs`. A future hardening pass should scan the full `src/service/action_tools/tools/**` tree for duplicate extracted tool body definitions, not only the expected old and new files.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/file-read-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `node scripts/verify-behavior-tests.mjs`: passed 986/986 when run directly after the failed `check:fast` runs.
- `npm run check:fast`: failed twice at behavior-test aggregation with `# pass 985 / # fail 1`.

Decision:
- Do not continue deeper into 2D.4 yet.
- Next step should fix the inventory inconsistency and obtain a stable `npm run check:fast` pass. If the behavior failure is intermittent, capture the exact failing subtest before proceeding.

## Codex Review: 2D.4 Inventory Fix + Compose Email Extraction

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `e65b668` — removes `stat_file` and `verify_file_exists` from the inline File Discovery / Read / Index inventory row.
- `7809e85` — moves `COMPOSE_EMAIL_TOOL` into `src/service/action_tools/tools/os-app-tools.mjs`.

Accepted:
- The 2D.4a inventory inconsistency called out in the previous Codex review is fixed.
- The previous unstable `check:fast` gate is now clean on rerun.
- `COMPOSE_EMAIL_TOOL` behavior appears preserved: it still builds a `mailto:` URL and uses the shared `openWithDefaultHandler`.
- Tool ids, count/order, confirmation-gated ids, behavior tests, and desktop GUI smoke are stable.

Architecture issue:
- Do not treat `COMPOSE_EMAIL_TOOL` living in `os-app-tools.mjs` as the final architecture.
- The reason for the move was helper reuse, but owner boundaries should follow domain responsibility, not only shared helper dependency.
- `compose_email` is an email-family tool. It should move to a dedicated `src/service/action_tools/tools/email-tools.mjs` owner, or the plan should explicitly define a temporary compatibility reason and a near-term cleanup.
- `scripts/verify-tool-registry-snapshot.mjs` currently accepts `COMPOSE_EMAIL_TOOL` as owned by `os-app-tools.mjs`; that assertion should be revised when the email owner is corrected.

Verifier issue:
- The verifier's inventory family check is too loose: it only checks that the word `Email` appears somewhere in the doc. After `7809e85`, the dedicated inline Email family row was removed, but the verifier still passes because `Email` appears in other text.
- Strengthen the doc assertion to validate actual ownership rows or explicit family table entries, not broad substring presence.

Required before more 2D moves:
- Add a narrow cleanup step: create/verify an email owner module or document `COMPOSE_EMAIL_TOOL` in `os-app-tools.mjs` as temporary only.
- Update the source-owner verifier so email ownership is domain-correct.
- Do not continue broad file-read extraction or high-risk 2D.5 work until this ownership mismatch is addressed.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/os-app-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-behavior-tests.mjs`: passed 986/986.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Product behavior is acceptable.
- Current structure is not acceptable as a final owner boundary because email logic is now mixed into the OS/app module.
- Next step should be an email owner cleanup and verifier tightening, not another broad tool-family extraction.

## Codex Review: Email Owner Fix + File Discovery Slice

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `5e2f53c` — moves `COMPOSE_EMAIL_TOOL` from `os-app-tools.mjs` to dedicated `email-tools.mjs`.
- `a343192` — extracts manifest/path helpers to `file-manifest-helpers.mjs`.
- `f967ee1` — moves `LIST_FILES_TOOL`, `GLOB_FILES_TOOL`, `FIND_RECENT_FILES_TOOL`, and `GET_LATEST_ARTIFACT_TOOL` into `file-read-tools.mjs`.

Accepted:
- The previous email ownership issue is fixed: `compose_email` now has a domain-correct owner in `email-tools.mjs`.
- `SEND_EMAIL_SMTP_TOOL` remains explicitly deferred in `index.mjs` because it still depends on the `NOOP_TOOLS` path.
- The file discovery move is a reasonable next slice. It moves read/enumeration/artifact-lookup tools, not write/edit/generate/register behavior.
- `file-manifest-helpers.mjs` gives shared helpers a single owner and avoids copying `resolveDefaultOutputDir`, `readManifest`, `writeManifest`, or `globToRegex`.
- Owner verifier assertions now cover email and the moved file discovery tools.

Cleanup notes before the next move:
- `file-manifest-helpers.mjs` is shared by both read-side discovery and still-inline artifact registration / output resolution paths. Do not let this become a vague dumping ground; if artifact write tools move later, split helper ownership by read manifest vs artifact write/output concerns if needed.
- `index.mjs` currently imports `file-manifest-helpers.mjs` near the file tool section instead of with the other imports. Node accepts this, but future cleanup should keep static imports grouped at the top for readability and predictable ownership scanning.
- The inventory still says Phase 2D.6 moved "4 of 10 tools" while the extracted file-read owner now contains six tools total including the earlier `stat_file` and `verify_file_exists`. This is understandable as a phase-slice count, but later inventory should avoid ambiguous counts.
- The verifier still mostly checks expected files rather than scanning all `tools/**` for duplicate extracted exports. Keep full-tree duplicate-owner scanning on the hardening list.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/action_tools/tools/file-read-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/file-manifest-helpers.mjs`: passed.
- `node --check src/service/action_tools/tools/email-tools.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Product behavior and current verifier gates are acceptable.
- The next extraction may continue inside the file-read/index family, but do not move `REGISTER_ARTIFACT_TOOL`, `RESOLVE_OUTPUT_PATH_TOOL`, `INDEX_FILE_CONTENT_TOOL`, or artifact-producing/write tools until their artifact/source invariants are separately locked.
- Prefer the next narrow slice to be read-only text/search helpers with targeted tests for file-read evidence coverage.

## Codex Review: 2D Cleanup and 2E Readiness

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `a209cd0` — moves the `file-manifest-helpers.mjs` static import to the top import block in `src/service/action_tools/tools/index.mjs`.

Accepted:
- The import cleanup addresses the previous readability / ownership-scanning note.
- No new tool ids, IPC channels, artifact kinds, storage schema, or runtime behavior changed in this commit.
- Phase 2D low-risk decomposition is now in a reasonable checkpoint state: browser/web, OS/app low-risk tools, scheduler, compose email, file stat/verify, and file discovery tools have owners and verifier coverage.

Remaining 2D high-risk surfaces:
- `WRITE_FILE_TOOL`, `EDIT_FILE_TOOL`, `RUN_SCRIPT_TOOL`, `GENERATE_DOCUMENT_TOOL`, `RENDER_DIAGRAM_TOOL`, `RENDER_SVG_TOOL`.
- `READ_FILE_TEXT_TOOL`, `READ_FOLDER_TEXT_TOOL`, `SEARCH_FILE_CONTENT_TOOL`, `INDEX_FILE_CONTENT_TOOL`.
- `REGISTER_ARTIFACT_TOOL`, `RESOLVE_OUTPUT_PATH_TOOL`.
- `GUI_FIND_ELEMENT_TOOL`, `GUI_CLICK_TOOL`, `GUI_TYPE_TEXT_TOOL`.
- `DRAFT_CAPABILITY_TOOL`, `SAVE_CAPABILITY_DRAFT_TOOL`.
- Deferred `LAUNCH_APP_TOOL`, `TAKE_SCREENSHOT_TOOL`, `READ_CLIPBOARD_TOOL`, and `SEND_EMAIL_SMTP_TOOL`.

2E readiness decision:
- Yes, Phase 2E may start, but only as `2E.0 / 2E.1` artifact boundary inventory and service-owned helper consolidation.
- Do not continue mechanical 2D extraction of artifact-producing/write tools before 2E locks artifact kind/path/source/registration invariants.
- Do not rewrite document generation internals in the first 2E pass.
- Do not change artifact ids, artifact paths, preview URLs, final-answer links, lineage behavior, or artifact manifest schema.

Recommended next DeepSeek task:
- Start `Phase 2E.0` with docs/verifier-only inventory if not already current:
  - map artifact kind inference, path inference, registration, preview/open/reveal, lineage, transform, fallback, and extract call sites;
  - add or strengthen verifier coverage for artifact boundary call sites.
- Then start `Phase 2E.1`:
  - create service-owned artifact boundary helpers for kind/path/source inference and registration options;
  - migrate only low-risk duplicated inference call sites;
  - leave generation/rendering/registering behavior intact.

Verification rerun by Codex:
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node --check src/service/action_tools/tools/file-read-tools.mjs`: passed.
- `node --check src/service/action_tools/tools/file-manifest-helpers.mjs`: passed.
- `node --check scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Close Phase 2D as "low-risk decomposition checkpoint complete", not "all tool families extracted".
- Proceed to Phase 2E with strict artifact-boundary scope.

## Codex Review: 2E.0 Inventory + Artifact Path Helper

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `0ee9b72` — adds Phase 2E.0 artifact boundary call-site inventory and verifier sections.
- `64cbf3b` — extracts artifact path helpers to `src/service/core/artifact-path-helper.mjs`.

Accepted:
- `0ee9b72` is directionally correct: it inventories kind inference, path inference, registration, preview/open/reveal, lineage, transform, fallback, and extract call sites.
- The artifact surface verifier now checks that the 2E.0 inventory sections exist.
- Moving path helper ownership into service core is the right 2E.1 target in principle.

Blocker:
- `64cbf3b` is not behavior-preserving. The new `resolveSandboxedTarget` implementation changed security semantics.
- Previous behavior rejected absolute paths outside the output/allowed roots with `path escapes task workspace`.
- New behavior can rewrite an outside absolute path to `path.resolve(outputDir, path.basename(relativePath))` instead of throwing.
- Previous behavior checked symlink components in the parent chain and rejected symlink targets. The new helper removed those `lstat` symlink checks.
- This weakens the artifact/file-write sandbox and violates the "boundary consolidation, no behavior change" rule.

Required fix before continuing 2E:
- Restore exact old `resolveSandboxedTarget` semantics in `artifact-path-helper.mjs`.
- Absolute path inside output/allowed roots must be accepted as-is.
- Absolute path outside all roots must throw.
- `..` segments must throw.
- Parent-chain symlinks must throw.
- Existing target symlinks must throw.
- Add a focused behavior test or verifier that proves those sandbox invariants.

Verification rerun by Codex:
- `node --check src/service/core/artifact-path-helper.mjs`: passed.
- `node --check src/service/action_tools/tools/index.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `node scripts/verify-action-tools.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 65/65.
- `npm run verify:desktop-gui-smoke`: passed 44/44.

Decision:
- Phase 2E.0 inventory is accepted.
- Phase 2E.1 path helper extraction is blocked until sandbox semantics are restored and test-locked.
- Do not proceed to registration, kind inference, or artifact-producing tool moves yet.

## Codex Review: 2E.1 Sandbox Fix

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `a6304df` — restores exact `resolveSandboxedTarget` sandbox semantics and wires an artifact sandbox invariant verifier into `check:fast`.

Accepted:
- `src/service/core/artifact-path-helper.mjs` now preserves the old sandbox contract from the former tool index implementation.
- Absolute paths inside the output directory or configured allowed roots are accepted as-is.
- Absolute paths outside all roots throw instead of being rewritten through `basename`.
- `..` path segments still throw.
- Parent-chain symlink checks and existing-target symlink checks are restored with `lstat`.
- `scripts/verify-artifact-sandbox-invariants.mjs` is included in the fast check manifest, so future helper edits cannot silently drop the key sandbox text invariants.

Remaining concern:
- The new verifier is mostly source-text/static. Keep it for guardrail coverage, but add a real runtime behavior test in a later 2E slice for relative paths, allowed absolute paths, outside absolute paths, `..`, and symlink/junction cases where the platform supports them.
- One direct behavior-test aggregation run failed before rerun with transient-looking failures in artifact worker cleanup and file-content recall tests. The failing files passed when run directly, and the full `npm run check:fast` rerun passed. Treat this as a test isolation signal to watch, not as a blocker on `a6304df`.

Verification rerun by Codex:
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- Manual artifact sandbox smoke: passed for relative target, inside absolute target, allowed-root absolute target, `..` rejection, outside absolute rejection, and existing regular target.
- `node --check src/service/core/artifact-path-helper.mjs`: passed.
- `node --check scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node --test tests/behavior/artifact-extract-background-lane.test.mjs`: passed 5/5.
- `node --test tests/behavior/file-content-recall-allowlist.test.mjs tests/behavior/file-content-recall-entry.test.mjs`: passed 7/7.
- `npm run verify:desktop-gui-smoke`: passed 44/44.
- `npm run check:fast`: passed 66/66 on rerun.

Decision:
- The Phase 2E.1 sandbox blocker from `64cbf3b` is resolved by `a6304df`.
- Phase 2E may continue to the next narrow artifact-boundary slice.
- Do not consolidate registration, kind inference, artifact-producing tools, or document generation internals until the next slice has explicit behavior tests/verifiers for artifact ids, paths, kinds, lineage, preview/open/reveal behavior, and manifest compatibility.

## Codex Review: 2E.2 Registration Invariant Lock

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `7726016` - locks artifact registration invariants in the artifact surface verifier and updates the inventory.

Accepted:
- This commit did not move product source files or change runtime behavior.
- `scripts/verify-artifact-surface-snapshot.mjs` now checks the key registration surfaces:
  - `artifact-store.mjs` still exposes `registerArtifact` and mentions `artifact_id` / `task_id`.
  - `artifact-action-contract.mjs` still exposes `artifactRegistrationOptionsForPath`.
  - `browser-submission.mjs`, `context-submission.mjs`, `file-submission.mjs`, and `image-submission.mjs` still call `registerArtifact` and `appendArtifact`.
  - `browser-submission.mjs` still uses `artifactRegistrationOptionsForPath`.
- The inventory correctly defers a unified registration facade because the current submission call sites have different metadata and event contexts.

Review notes:
- Treat this as "registration invariants locked", not "registration consolidation complete". The inventory wording should keep that distinction clear in future edits.
- The verifier is still mostly source-shape based. It is useful as a drift guard, but it does not prove that registered artifacts preserve ids, task ids, metadata, lineage, preview links, or final answer visibility.
- `context-submission.mjs` also uses `artifactRegistrationOptionsForPath`; a later hardening pass should lock both browser and context metadata-aware registration paths, not only browser.

Verification rerun by Codex:
- `node --check scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-sandbox-invariants.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 66/66.

Decision:
- Accept `7726016` as a safe Phase 2E.2 guardrail step.
- Phase 2E may continue, but the next registration-related work must be either a behavior test for registration outputs or a very narrow helper extraction with unchanged call semantics.
- Do not introduce a registration facade yet unless the PR proves metadata, event emission, artifact manifest, lineage, and preview/final-answer behavior stay identical.

## Codex Review: 2E.2 Follow-up + 2F.1 Worker Contract Verifier

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `c30795f` - extends the artifact surface verifier to lock `context-submission.mjs` metadata-aware registration.
- `24ff945` - adds `scripts/verify-artifact-extract-worker.mjs` and wires it into full and fast checks.

Accepted:
- `c30795f` correctly addresses the previous Codex review note: both browser and context submission paths now must keep `artifactRegistrationOptionsForPath`.
- `24ff945` does not create or move worker product code. It locks the already-existing artifact extract worker/background lane surface.
- The new worker verifier checks the current worker entry point, abort protocol, structured result shape, supported kind declaration, progress callback, background lane factory, timeout/concurrency controls, failure storage, queue/running state, extract-kind tagging, and behavior-test presence.
- Adding the worker verifier to `check-manifest.mjs` is appropriate because future worker changes should be caught in `check:fast`.

Review notes:
- Treat `24ff945` as a Phase 2F.1 contract verifier foundation, not as a worker migration or deep parser implementation.
- The verifier is still source-shape based. It protects against accidental removal of the lane protocol, but it does not prove parsing quality, worker isolation under load, cancellation race behavior, or main/renderer non-blocking behavior by itself.
- Do not expand worker functionality in the next step without behavior tests for timeout, cancellation, queue fairness, artifact extract persistence, and error surfaces.

Verification rerun by Codex:
- `node --check scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node --check scripts/verify-artifact-extract-worker.mjs`: passed.
- `node scripts/verify-artifact-extract-worker.mjs`: passed.
- `node scripts/verify-artifact-extract-background-lane.mjs`: passed.
- `node --test tests/behavior/artifact-extract-background-lane.test.mjs`: passed 5/5.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `npm run check:fast`: passed 67/67.

Decision:
- Accept both commits as guardrail-only progress.
- Phase 2F may begin only as verifier-first worker hardening.
- Do not implement new extraction worker behavior, move parsing logic, or change artifact extract storage until runtime behavior tests cover cancellation, timeout, persistence, and user-visible artifact availability.

## Codex Review: 2G.1 Provider Boundary + Codebase Inventory Update

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `d90497c` - adds provider boundary inventory and `scripts/verify-provider-boundary.mjs`.
- `f94feda` - updates `docs/architecture/codebase-file-inventory.md` for 2B-2G reorganization.

Accepted:
- Both commits are docs/verifier-only and do not change product runtime behavior.
- Adding a provider boundary verifier to `check:fast` is the right direction.
- The provider adapter/resolver owner surfaces are correctly identified as high-risk service/provider boundaries.
- The codebase inventory update correctly records many 2B desktop helper extractions and 2D tool-family extractions.

Blocking review notes:
- Do not mark Phase 2G.1 complete yet. The provider boundary inventory claims the resolver call-site list is complete, but repository search shows additional provider-boundary references outside the 13 documented callers, including:
  - `src/service/core/planning/runnable-executor.mjs`
  - `src/service/core/http-routes/audio-routes.mjs`
  - `src/service/core/http-routes/config-provider-routes.mjs`
  - `src/service/core/intent/semantic-router.mjs`
- `scripts/verify-provider-boundary.mjs` checks that the listed callers use the resolver, but it does not scan all `src/service/**` imports/usages of `resolveProviderForTask`, `resolveActiveProviderForTask`, `createProviderAdapter`, or dynamic provider-resolver imports and fail on undocumented call sites.
- The provider verifier only scans `src/service/executors/**` for direct `messages.create` / `chat.completions.create` calls. Its "No modules bypass provider-adapter" claim is broader than its scan.
- The codebase inventory still says no dedicated `src/service/workers/` directory exists, but `src/service/workers/artifact-extract-worker.mjs` exists and is now verifier-locked.
- The line counts in the inventory are already stale locally: `electron-main.mjs` is 1022 lines and `tools/index.mjs` is 2900 lines at review time, not the committed 1072 / 3049 values. Prefer approximate counts or regenerate them in verifier-backed docs.

Required correction before accepting 2G.1:
- Update `docs/architecture/provider-boundary-plan.md` to include all current provider resolver/adapter call sites or explicitly classify them as allowed exceptions.
- Strengthen `scripts/verify-provider-boundary.mjs` to scan the tree for provider boundary usages and require every usage to be documented/allowlisted.
- Expand direct provider-call scanning beyond `src/service/executors/**`, or narrow the verifier/doc claim to match the actual scan.
- Update `docs/architecture/codebase-file-inventory.md` to reflect `src/service/workers/` and avoid stale exact line-count assertions unless verified.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed, but with the coverage gaps above.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-artifact-extract-worker.mjs`: passed.
- `node scripts/verify-artifact-surface-snapshot.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 68/68.

Decision:
- Accept the direction of `d90497c` and `f94feda`, but do not accept Phase 2G.1 as complete.
- The next DeepSeek step should fix provider inventory/verifier coverage and inventory freshness before starting provider resolver caching or provider-boundary refactors.

## Codex Review: 2G.1 Provider Boundary Coverage Fix

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `033a154` - completes provider boundary inventory/verifier coverage and updates the worker inventory entry.

Accepted:
- This is still docs/verifier-only; it does not change provider runtime behavior.
- The provider verifier now scans all `src/service/**` files for `resolveProviderForTask` / `provider-resolver` references and fails on undocumented callers.
- Direct provider-call scanning now covers all `src/service/**` instead of only `src/service/executors/**`.
- The previously missing provider-boundary references are now explicitly included: runnable executor, audio routes, config provider routes, intent semantic router, and embeddings semantic routing.
- `docs/architecture/codebase-file-inventory.md` now acknowledges `src/service/workers/artifact-extract-worker.mjs` instead of saying there is no worker directory.

Remaining review notes:
- The provider boundary plan still has wording drift: it says `src/service/embeddings/semantic.mjs` is the only module outside the executor/submission pipeline, but the same document now also allows `src/service/core/intent/semantic-router.mjs`. Update that prose so the exception list is internally consistent.
- `src/service/extractors/file-ingest.mjs` is documented as a resolver call site, but the current match is only a comment reference. Either remove that comment from the enforced caller set or classify it separately as a non-call textual reference.
- The provider adapter call-site table still lists only four callers, while `src/service/core/intent/semantic-router.mjs` dynamically imports and calls `createProviderAdapter`. The verifier should add a tree scan for `createProviderAdapter` / `provider-adapter` usages, mirroring the resolver scan.
- `docs/architecture/codebase-file-inventory.md` still contains stale exact line-count text for `src/service/action_tools/tools/index.mjs` (`4105 -> 3049`) even though the current file is 2900 lines at review time. Prefer approximate or generated counts.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- Direct `node scripts/verify-behavior-tests.mjs`: passed 986/986 after an initial `check:fast` behavior aggregation failure.
- `npm run check:fast`: passed 68/68 on rerun.

Decision:
- Accept `033a154` as resolving the main Phase 2G.1 blocker from the previous review.
- Phase 2G may proceed to the next narrow verifier-first provider step, but do not implement provider resolver caching until the adapter call-site scan and provider-boundary prose drift are cleaned up.
- Treat the one failed `check:fast` behavior aggregation run as a test stability signal to keep watching; the direct behavior suite and rerun fast gate both passed.

## Codex Review: 2G.1 Cleanup + 2G.2 Hot-Reload Contract

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `b54088f` - adds provider-adapter tree scan, excludes comment-only provider-resolver references, and softens stale exact inventory line counts.
- `62d7970` - documents and verifier-locks the provider resolver hot-reload contract.

Accepted:
- Both commits are verifier/docs focused and do not change provider routing behavior or provider ids.
- `b54088f` improves the provider boundary verifier by scanning all `src/service/**` for `createProviderAdapter` / `provider-adapter` usages, mirroring the resolver scan.
- `b54088f` correctly treats `src/service/extractors/file-ingest.mjs` as comment-only, not a runtime resolver caller.
- `b54088f` replaces stale exact line counts in the codebase inventory with approximate counts.
- `62d7970` correctly frames the current provider resolver disk read as an intentional hot-reload contract, not accidental overhead. This blocks premature provider-config caching that would make Settings changes require a service restart.

Remaining review notes:
- `docs/architecture/provider-boundary-plan.md` still has an inventory mismatch: the adapter call-site table lists only four callers and says `~4`, but `src/service/core/intent/semantic-router.mjs` is now an approved dynamic adapter caller in the verifier. Update the table/count so docs and verifier agree.
- The provider boundary plan still lists `src/service/extractors/file-ingest.mjs` in the call-site table as "Static (comment reference)". Since it is intentionally comment-only, move it to a separate non-runtime textual-reference note instead of presenting it as a call site.
- The hot-reload verifier currently checks for source text (`Re-read on every call`, `no in-memory cache`, `readFileSync`) rather than proving behavior. Before any cache/refactor, add a behavior test that changes provider config between two resolver calls and proves the second call sees the new config without process restart.
- `npm run check:fast` is currently unstable in this workspace: it failed twice at `node scripts/verify-behavior-tests.mjs` with `pass 985 / fail 1`, while direct `node scripts/verify-behavior-tests.mjs` passed 986/986. This should be treated as a release-gate stability issue, even though it does not appear caused by these provider verifier commits.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- Direct `node scripts/verify-behavior-tests.mjs`: passed 986/986.
- `npm run check:fast`: failed twice at behavior aggregation with `pass 985 / fail 1`.

Decision:
- Accept the verifier direction of `b54088f` and `62d7970`.
- Do not proceed to provider resolver caching yet.
- Before the next provider implementation step, fix the provider-boundary-plan adapter table/comment-only call-site wording and investigate or quarantine the unstable `check:fast` behavior aggregation failure so the phase gate is reliably green.

## Codex Review: Provider Doc Cleanup + CAP-0 Capability Inventory

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `67d108e` - fixes provider adapter table and moves `file-ingest.mjs` to comment-only classification.
- `7c0c8e4` - adds CAP-0 capability directory architecture inventory and `scripts/verify-capability-roots.mjs`.

Accepted:
- `67d108e` correctly aligns the provider adapter table with the verifier by adding `src/service/core/intent/semantic-router.mjs` and the provider-adapter self surface.
- `67d108e` correctly removes `src/service/extractors/file-ingest.mjs` from the runtime provider resolver call-site table and classifies it as comment-only.
- `7c0c8e4` is docs/verifier-only and does not move product source files.
- CAP-0 usefully inventories current capability roots and sets the right target direction: built-in source capabilities under a service-owned capability tree, while user-installed capabilities stay in runtime data paths.
- `verify-capability-roots.mjs` is a useful first guard: it checks current capability roots exist, blocks a few obvious user-installed `src/` paths, checks the architecture doc, and verifies extracted tool constants are not redefined in `tools/index.mjs`.

Remaining review notes:
- `docs/architecture/provider-boundary-plan.md` still has a stale prose sentence in "Direct Provider Calls (Exceptions)": it says `src/service/embeddings/semantic.mjs` is the only module using provider resolution outside the executor/submission pipeline. That conflicts with the later approved `src/service/core/intent/semantic-router.mjs` exception. Clean this before declaring provider boundary docs complete.
- CAP-0 must remain inventory-only. Do not start CAP-1/CAP-2 moves until each family has verifier coverage for imports, exports, tool ids, schemas, risk policy, approvals, and old owner text.
- The capability verifier should become stricter before any move: compatibility barrels must be re-export-only, and every migration-complete claim must prove no stale old-owner text assertions remain in docs/verifiers/source comments.
- The "no user-installed capability directories under src" check currently only blocks a small fixed list (`src/user-skills`, `src/user-mcp`, `src/user-tools`, `src/user-connectors`). Before enabling user-added capability families, broaden this to scan for all documented runtime-installed capability roots under `src/`.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node --check scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 69/69.

Decision:
- Accept `67d108e` and `7c0c8e4` as safe docs/verifier progress.
- CAP-0 may be considered started/accepted as inventory, not as a completed capability migration.
- Do not proceed to source moves under `src/service/capabilities/**` until the next CAP verifier proves no old owner text/assertion drift and no parallel legacy/new implementations.

## Codex Review: Required Tool Contract + Artifact Recovery Block

Review date: 2026-05-10.

DeepSeek work reviewed:
- No new commit was present at review time.
- Uncommitted product-source changes were present in:
  - `src/service/core/policy/success-contract-validator.mjs`
  - `src/service/executors/tool_using/agent-loop.mjs`
  - `tests/behavior/agent-loop-sequencing.test.mjs`
- Existing guardrail/doc change was also present in `AGENTS.md`.

Accepted:
- Adding validation for `success_contract.required_tool_names` is directionally correct. It turns tool-specific hard requirements such as `edit_file` into runtime data instead of relying on prompt text.
- The targeted verifier `scripts/verify-success-contract-groups.mjs` covers the new required-tool behavior for `edit_file`.
- `scripts/verify-artifact-recovery-hook.mjs` now proves that `transform_existing_file` does not synthesize a brand-new `generate_document` artifact when `edit_file` was required.
- The AGENTS.md addition is consistent with recent migration failures: each phase must sweep docs/verifiers/scripts for stale owner/path assertions, not rely on `check:fast` alone.

Blocking review notes:
- `src/service/executors/tool_using/agent-loop.mjs` now contains a new local `artifactRecoveryBlockedReason()` helper that repeats policy already represented in `src/service/core/artifact-fallback-policy.mjs`. This is not clean enough for the framework direction. Move or centralize the rule in the shared artifact fallback/action contract layer, then have the agent loop call that policy instead of owning the `transform_existing_file` / `edit_file` decision itself.
- The new recovery reason is named `transform_existing_file_requires_edit_file` even when it is triggered only by `required_tool_names.includes("edit_file")`. Use a reason that accurately reflects the policy source, or keep separate reasons for goal-based and required-tool-based blocks.
- The test regex change in `tests/behavior/agent-loop-sequencing.test.mjs` broadens the assertion from `请选择要打开哪一个|choose which` to `哪一个|which`. This may be harmless, but it weakens the UI/UX contract. Keep the broader assertion only if the finalization wording is intentionally allowed to vary; otherwise restore a stronger assertion around disambiguation wording.
- Because this is behavior-changing product source, do not commit it as a quick patch. Finish the policy centralization and keep the verifier proving the contract.

Verification rerun by Codex:
- `node --check src/service/core/policy/success-contract-validator.mjs`: passed.
- `node --check src/service/executors/tool_using/agent-loop.mjs`: passed.
- `node --check tests/behavior/agent-loop-sequencing.test.mjs`: passed.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: passed 19/19.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 46/46.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-claim-guard-phase-c.mjs`: passed 19/19.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node scripts/verify-behavior-tests.mjs`: passed 986/986 when run directly.
- `npm run check:fast`: failed again at `node scripts/verify-behavior-tests.mjs` with TAP summary `pass 985 / fail 1`.

Decision:
- Do not accept the uncommitted product-source change as complete yet.
- Accept the required-tool contract direction, but require the artifact recovery block to be centralized in the shared artifact policy layer before commit.
- Treat the recurring `check:fast` behavior aggregation failure as a release-gate stability issue. Direct behavior tests passing is useful evidence, but the phase cannot be called fully green while `check:fast` is intermittently red.

## Codex Review: Provider Stale-Claim Cleanup + Workspace Gate

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `1145b0c` - `docs: fix stale "only module" claim in provider-boundary-plan.md`.

Accepted:
- `1145b0c` correctly removes the stale Direct Provider Calls prose that said `src/service/embeddings/semantic.mjs` was the only out-of-pipeline provider-resolution caller.
- The provider boundary plan now consistently names both approved semantic-router exceptions:
  - `src/service/embeddings/semantic.mjs`
  - `src/service/core/intent/semantic-router.mjs`
- This commit is documentation-only and does not change provider ids, provider routing, provider adapter behavior, provider resolver hot-reload behavior, IPC, HTTP routes, tool ids, or storage schema.

Remaining review notes:
- The provider-boundary doc cleanup is accepted, but it does not resolve the uncommitted product-source blocker from the previous review.
- `src/service/executors/tool_using/agent-loop.mjs` still owns `artifactRecoveryBlockedReason()` locally. That rule still needs to move into the shared artifact fallback/action-contract policy layer before the required-tool/artifact-recovery behavior change can be considered complete.
- `tests/behavior/agent-loop-sequencing.test.mjs` still has the weakened launch-disambiguation regex. DeepSeek should either justify the wording flexibility or restore the stronger UX assertion.
- The workspace still has uncommitted product-source behavior changes, so the safe conclusion is split:
  - accept `1145b0c` as a provider-doc cleanup;
  - do not accept the whole working tree as ready.

Verification rerun by Codex:
- `node --check scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: failed again at `node scripts/verify-behavior-tests.mjs` with TAP summary `pass 985 / fail 1`.

Decision:
- Accept `1145b0c`.
- Provider stale prose cleanup is complete for the previously reported "only module" issue.
- Do not mark the current workspace or required-tool/artifact-recovery work complete until the artifact policy centralization is done and the fast gate is stable green or explicitly fixed/quarantined with a documented reason.

## Codex Review: Artifact Recovery Policy Centralization

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `9d31164` - `fix: centralize artifactRecoveryBlockedReason in shared policy layer`.

Accepted:
- The previous architecture blocker is directionally resolved: `artifactRecoveryBlockedReason()` no longer lives inside `src/service/executors/tool_using/agent-loop.mjs`; it is exported from `src/service/core/artifact-fallback-policy.mjs` and the agent loop now calls the shared policy.
- The reason names are more truthful than the previous single `transform_existing_file_requires_edit_file` value:
  - `goal_transform_existing_file_requires_edit_file`
  - `required_tool_edit_file_not_called`
- The strong launch-disambiguation test assertion was restored in source, which is the right direction for preserving UX contract strength.

Blocking review notes:
- The restored strong launch-disambiguation assertion currently fails. `node tests/behavior/agent-loop-sequencing.test.mjs` fails test 17 because the actual Chinese final text says `请你告诉我你想打开的是哪一个...`, not `请选择要打开哪一个...`. DeepSeek must either update the product finalization wording to satisfy the stronger contract or adjust the assertion to a precise stable phrase that the product actually guarantees. Do not leave this as a red test.
- `required_tool_edit_file_not_called` is defined in the shared policy, but no targeted recovery-hook test currently exercises the branch where `goal !== "transform_existing_file"` and `required_tool_names` includes `edit_file`. Add a verifier/test case for that branch before declaring the policy complete.
- The uncommitted `success-contract-validator.mjs` required-tool enforcement remains outside the new commit. That behavior change still needs its own clean commit once the red test and coverage gap are fixed.
- Historical review text in this handoff still records the earlier blocker (`agent-loop.mjs` owned `artifactRecoveryBlockedReason`). The latest status now supersedes that, but before any migration-complete declaration, make sure the current summary/plan does not leave stale owner assertions that look like present-tense truth.

Verification rerun by Codex:
- `node --check src/service/core/artifact-fallback-policy.mjs`: passed.
- `node --check src/service/executors/tool_using/agent-loop.mjs`: passed.
- `node --check scripts/verify-artifact-recovery-hook.mjs`: passed.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 46/46.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: failed 18/19; launch ambiguity final answer assertion failed.
- `npm run check:fast`: failed at `node scripts/verify-behavior-tests.mjs` with TAP summary `pass 985 / fail 1`.

Decision:
- Accept the policy centralization architecture direction in `9d31164`.
- Do not mark `9d31164` or the required-tool/artifact-recovery work complete while `agent-loop-sequencing` is red.
- Next DeepSeek action should fix the launch disambiguation contract mismatch and add explicit coverage for the `required_tool_edit_file_not_called` recovery-block branch.

## Codex Review: Launch Disambiguation + Required Edit-File Branch

Review date: 2026-05-10.

DeepSeek commit reviewed:
- `144cdf0` - `fix: match actual launch disambiguation text; add edit_file branch test`.

Accepted:
- The previous red behavior test is fixed: `node tests/behavior/agent-loop-sequencing.test.mjs` now passes 19/19.
- `scripts/verify-artifact-recovery-hook.mjs` now includes explicit coverage for the required-tool branch where:
  - `goal !== "transform_existing_file"`;
  - `success_contract.required_tool_names` includes `edit_file`;
  - deterministic recovery does not call `generate_document`;
  - `artifact_recovery.reason` is `required_tool_edit_file_not_called`.
- The broader launch-disambiguation assertion is acceptable in this test because the actual LLM-composed Chinese output varies, while the test still requires a stable disambiguation signal plus both candidate app names and no internal `launch_args`. The stronger exact finalization phrase remains covered in `tests/behavior/agent-loop-finalization.test.mjs`.
- `npm run check:fast` passed 69/69 in this review run, so the previously recurring fast-gate failure did not reproduce this time.

Minor cleanup note:
- The new recovery-hook test's `generateImpl` body references `toolId`, which is not defined in that closure. The test still passes because the correct behavior is that `generateImpl` is never called. Clean this up in a future small verifier hygiene pass so a failure path reports a clean intentional error instead of relying on an incidental `ReferenceError`.

Remaining review notes:
- The uncommitted `src/service/core/policy/success-contract-validator.mjs` change is still a separate behavior-changing product-source edit. It enforces `success_contract.required_tool_names` generally, and should be committed or reviewed as its own clean unit after confirming its verifier coverage is intentional.
- Historical review text in this file still contains older present-tense blocker descriptions for `artifactRecoveryBlockedReason()`. Those are audit history, not current state. Before a migration-complete declaration, add a fresh current-state summary or sweep so no stale owner assertion is mistaken for active truth.

Verification rerun by Codex:
- `node --check tests/behavior/agent-loop-sequencing.test.mjs`: passed.
- `node --check scripts/verify-artifact-recovery-hook.mjs`: passed.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 49/49.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: passed 19/19.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 69/69.

Decision:
- Accept `144cdf0`.
- The `9d31164`/`144cdf0` artifact-recovery policy centralization sequence is now acceptable as a complete structural fix for the earlier agent-loop ownership blocker.
- Do not roll the remaining uncommitted required-tool validator change into this conclusion; review and commit it separately.

## Codex Review: Required Tool Validator Commit + Verifier Hygiene

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `8d02914` - `chore: clean up dead toolId reference in recovery-hook verifier`.
- `d16bbae` - `feat: enforce success_contract.required_tool_names in validator`.

Accepted:
- `8d02914` resolves the verifier hygiene note from the previous review. The recovery-hook branch test now throws a clean intentional error if `generate_document` is incorrectly called, instead of referencing an undefined `toolId`.
- `d16bbae` cleanly commits the previously uncommitted required-tool enforcement behavior in `src/service/core/policy/success-contract-validator.mjs`.
- The required-tool validator now treats `success_contract.required_tool_names` as runtime contract data:
  - no matching tool result creates `<tool>_required_not_called`;
  - only failed matching tool results create `<tool>_required_all_failed`;
  - at least one successful matching tool result satisfies the tool-specific requirement.
- This is consistent with the artifact recovery policy: `edit_file` can be required as a hard contract, and deterministic recovery must not paper over a missing required edit.

Review notes:
- This sequence is a real behavior change, but it is framework-level rather than a phrase/task-specific patch. It generalizes across required tool ids.
- The current targeted verifier coverage is strongest for `edit_file`; before using `required_tool_names` for more high-risk tool families, add explicit cases for those families or lock them through their existing action/approval verifiers.
- Historical handoff/plan sections still contain older blocker text saying `agent-loop.mjs` owned `artifactRecoveryBlockedReason()`. That is audit history, not current state. The current source/verifier state has the policy in `src/service/core/artifact-fallback-policy.mjs`.

Verification rerun by Codex:
- `node --check src/service/core/policy/success-contract-validator.mjs`: passed.
- `node --check scripts/verify-success-contract-groups.mjs`: passed.
- `node --check scripts/verify-artifact-recovery-hook.mjs`: passed.
- `node scripts/verify-success-contract-groups.mjs`: passed 36/36.
- `node scripts/verify-artifact-recovery-hook.mjs`: passed 49/49.
- `node tests/behavior/agent-loop-sequencing.test.mjs`: passed 19/19.
- `node scripts/verify-artifact-generation-invariant.mjs`: passed 59/59.
- `node scripts/verify-artifact-action-contract.mjs`: passed.
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `npm run check:fast`: passed 69/69.

Decision:
- Accept `8d02914` and `d16bbae`.
- The required-tool/artifact-recovery work reviewed across `9d31164`, `144cdf0`, `8d02914`, and `d16bbae` is now structurally acceptable and verifier-backed.
- Before declaring a broader phase complete, add or reference a current-state sweep so historical review text is not mistaken for active owner assertions.

## Codex Review: Handoff Header + AGENTS Sweep Rule + REPO-0 Directory Map

Review date: 2026-05-10.

DeepSeek commits reviewed:
- `075fb76` - `docs: update handoff status header to reflect resolved state`.
- `1684d74` - `docs: add migration-phase verifier sweep rule to AGENTS.md`.
- `4b6d896` - `docs: Phase REPO-0 repository directory architecture map`.

Accepted:
- `1684d74` is accepted. The AGENTS.md rule formalizes the migration discipline we need: every phase must sweep docs/verifiers/scripts for moved names, old owner paths, channels, routes, and event strings. This directly supports the current rule: no migration-complete claim without proving stale old-owner assertions are not active truth.
- `4b6d896` is accepted as a useful REPO-0 draft inventory. It adds the current-vs-target repository layout and correctly frames `apps/` + `packages/` as a long-term target rather than an immediate cosmetic reshuffle.
- `075fb76` correctly records that the required-tool/artifact-recovery blocker sequence has been resolved and that `check:fast` is green in the current review run.

Blocking/required cleanup before treating REPO-0 as complete:
- The Phase REPO-0 plan in `linxi_codebase_reorganization_execution_plan.md` explicitly called for `scripts/verify-repository-directory-architecture.mjs`, but `4b6d896` only added the doc. `Test-Path scripts/verify-repository-directory-architecture.mjs` returned `False`. Add the verifier and wire it into the check manifest before marking REPO-0 complete.
- The handoff header says `Phases 2B-2G + CAP-0 Complete`. This is too broad unless the intended meaning is "current checkpoint/inventory layers complete." Phase 2D was explicitly closed as a low-risk checkpoint, not all tool families extracted; CAP-0 is inventory only, not capability migration complete. Tighten this header so it cannot be read as "all deferred high-risk tools/capability moves are done."
- `docs/architecture/repository-directory-architecture.md` current layout omits several current `src/service/**` directories (`audio`, `cost`, `events`, `failures`, `https`, `memory`, `metrics`, `preview`, `retry`, `scheduler`, `templates`, `utils`) and omits the current native host root. Either make the map explicitly "major selected directories" or include the omitted roots so the document remains a reliable current-state inventory.
- The REPO-0 status table says `2D | Tool family extraction complete (7 modules, 21 tools)`. This should be reworded to `2D low-risk checkpoint complete` or equivalent, with high-risk tool families deferred. Do not imply `write_file`, `edit_file`, `run_script`, `generate_document`, GUI automation, or capability creator moves are complete.

Verification rerun by Codex:
- `node scripts/verify-runtime-upgrade-guardrails.mjs`: passed.
- `node scripts/verify-structure.mjs`: passed.
- `node scripts/verify-capability-roots.mjs`: passed.
- `node --check scripts/check-manifest.mjs`: passed.
- `node scripts/verify-provider-boundary.mjs`: passed.
- `node scripts/verify-tool-registry-snapshot.mjs`: passed.
- `npm run check:fast`: passed 69/69.
- `Test-Path docs/architecture/repository-directory-architecture.md`: true.
- `Test-Path scripts/verify-repository-directory-architecture.mjs`: false.

Decision:
- Accept `1684d74`.
- Accept `075fb76` only after wording is tightened from broad "Complete" to checkpoint/inventory-complete language.
- Accept `4b6d896` as REPO-0 draft documentation, but do not mark REPO-0 complete until the repository-directory verifier exists and the current-layout/status wording is corrected.
