# UCA Remediation Task List

This checklist tracks the cleanup from the README/root-directory audit.

## P0 - Blockers

- [ ] Fix Electron packaging so `npm run pack` and `npm run dist` can run.
  - [x] Move `electron` to `devDependencies`.
  - [x] Add package metadata required by electron-builder.
  - [x] Remove or replace the missing `assets/icon.ico` reference.
  - [x] Re-run after stopping the currently running UCA Electron/Node processes that lock `better_sqlite3.node`.
  - [x] Make `npm run pack` usable for local directory packaging by disabling Windows executable signing/editing in the pack script.
  - [x] Add an electron-builder wrapper that rebuilds `better-sqlite3` back to the current Node ABI after packaging attempts.
  - [ ] Resolve Windows symlink privilege issue while electron-builder extracts `winCodeSign`.
- [x] Wire `TaskSpec` into the runtime task creation path.
  - [x] Ensure every created task has `task_spec`.
  - [x] Preserve route metadata and executor overrides.
  - [x] Add validation metadata without blocking existing flows.
  - [x] Inject TaskSpec contract into the agentic system prompt.
  - [x] Fix Chinese current-data keyword detection for `最新` / `搜索` / `新闻`.
- [ ] Re-run `npm run pack` and `npm run check`.
  - [x] `npm run check` passed after remediation.
  - [x] `npm run pack` passes and writes `dist\win-unpacked`.
  - [ ] `npm run dist` still reaches `dist\win-unpacked`, but is blocked by the `winCodeSign` symlink extraction privilege error.

## P1 - Behavior Gaps

- [x] Replace `take_screenshot` text placeholder with a real screenshot artifact.
- [x] Replace document generation fixture path with production renderers.
  - [x] PPTX: real slide renderer.
  - [x] DOCX: real document renderer.
  - [x] XLSX: real workbook renderer.
  - [x] PDF: real HTML-to-PDF path or explicit fallback state.
- [x] Replace file/OCR placeholder extraction.
  - [x] DOCX/XLSX/PPTX text extraction.
  - [x] PDF OCR extraction.
  - [x] Image OCR fallback reporting.
  - [x] Use `pdftoppm` + image OCR for scanned PDFs when available.
  - [x] Remove synthetic scanned-PDF OCR placeholder text and report `pdf_ocr_unavailable` when no raster OCR engine is configured.
- [x] Replace browser submission placeholder paths.
  - [x] Replace `Browser image placeholder` with a fetched image artifact.
  - [x] Replace `web_fetch_placeholder` with a real fetch step and fetched page artifact.
- [x] Harden native host install flow by requiring real Chrome/Edge extension IDs.

## P2 - Alignment

- [x] Hide or relabel legacy MCP stubs (`local-fs`, `figma`) in Console/runtime status.
- [x] Update README to separate stable features from trial limitations.
- [x] Sync `docs/release/known_issues.md` with the README feature matrix.
- [x] Generate a full third-party license/SBOM report for transitive dependencies.
- [ ] Split the large dirty worktree into focused commits.
  - Suggested split:
    1. Packaging / electron-builder / native host setup.
    2. TaskSpec and agentic prompt contract.
    3. Runtime tool behavior fixes: screenshot, browser fetch, document generation, OCR.
    4. MCP status relabeling and Console alignment.
    5. Documentation and license inventory.
  - This remains pending because the worktree already contains unrelated user changes.

## Verification Notes

- `npm run check` passed before this remediation started.
- `node --check` passed for 208 JS/MJS/CJS files before this remediation started.
- `npm run pack` failed before this remediation started because `electron` was in `dependencies`.
- `npm run pack` reached native dependency rebuild, but previously failed because running local Electron/Node processes locked `node_modules/better-sqlite3/build/Release/better_sqlite3.node`.
- `npm run pack` later rebuilt `better-sqlite3` and reached `dist\win-unpacked`, but failed while extracting `winCodeSign` because the current Windows session lacks symlink creation privilege.
- Retrying `npm run pack` with `CSC_IDENTITY_AUTO_DISCOVERY=false` still failed at the same `winCodeSign` symlink extraction step.
- `npx electron-builder --dir --config.win.signAndEditExecutable=false` passed, so `npm run pack` now uses the same local-packaging flag.
- `npm run pack` passed through `scripts/run-electron-builder.mjs`, then rebuilt `better-sqlite3` for Node.
- `npm run dist` still fails at the `winCodeSign` symlink extraction step; this remains a release/installer environment issue.
- `npm run dist` now also runs through the wrapper and rebuilds `better-sqlite3` after the expected failure.
- `node -e "require('better-sqlite3')"` passed after the failed `dist` run, confirming the Node ABI was restored.
- `npm install --package-lock-only` completed, but reported Node `22.11.0` below `@electron/rebuild` / `node-abi` engine requirement `>=22.12.0` and 4 high-severity audit findings.
- `npm run verify:service-core` passed after TaskSpec wiring.
- `npm run verify:agentic-planner` passed after TaskSpec prompt injection.
- `npm run verify:action-tools` passed after replacing the screenshot placeholder with a PNG artifact.
- `node scripts/verify-native-integrations.mjs` passed after native host script hardening.
- PowerShell parser checks passed for `scripts/install-native-host.ps1` and `scripts/setup-trial.ps1`.
- `node scripts/verify-browser-extension.mjs` passed after replacing browser capture placeholders.
- `node scripts/verify-ai-integrations.mjs` and `node scripts/verify-desktop-renderer.mjs` passed after relabeling legacy MCP stubs.
- `node scripts/verify-action-tools.mjs` and `node scripts/verify-file-kimi.mjs` passed after switching runtime document generation to `scripts/render-document.ps1`.
- `node scripts/verify-pdf-ocr.mjs` passed after adding optional `pdftoppm` scanned-PDF OCR and explicit unavailable-state reporting.
- README and `docs/release/known_issues.md` now call out local pack support, release `winCodeSign` symlink privilege, scanned-PDF OCR unavailability, MCP legacy entries, and Kimi quota skip behavior.
- `npm run licenses` generated `THIRD_PARTY_LICENSES.md` with 550 package entries from `package-lock.json` / installed metadata.
- `npm run check` passed after this remediation pass.
- `npm run pack` passed after this remediation pass.
- `node -e "require('better-sqlite3')"` passed after the final `npm run pack`, confirming the wrapper restored the Node ABI.
- Kimi real runtime verification was skipped because the configured account quota was exhausted.
