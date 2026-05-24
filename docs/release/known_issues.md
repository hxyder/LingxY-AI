# Known Issues

## Accepted For Trial

- Electron shell is still a runtime-connected scaffold; trial operation relies on service/runtime verification more than polished renderer UX.
- Live model execution depends on user-configured provider credentials or a configured code CLI adapter. Kimi Code CLI is supported as one adapter path, not the only primary path.
- Office integration ships with protocol-handler-first fallback; localhost HTTPS is not a release blocker for the trial channel.
- DAG resume currently replays through a platform placeholder executor path rather than real per-node business executors.
- History search uses a lightweight lexical embedding approximation and is suitable for local recall, not semantic ranking parity with production vector services.
- Scanned PDFs without a text layer use `pdftoppm` + image OCR when available; otherwise they return `pdf_ocr_unavailable`.
- `npm run dist` can fail while electron-builder extracts `winCodeSign` if the Windows session lacks symlink creation privilege; `npm run pack` remains available for local directory packaging.
- Legacy MCP descriptors `local-fs` and `figma` are status-only entries. Use `mcp-filesystem`; Figma requires an external MCP plugin.
- `npm audit` currently reports a moderate `uuid` advisory through `exceljs`. Release workflows block high/critical advisories with `npm run verify:audit-high`; do not run `npm audit fix --force` for this item because npm proposes a breaking `exceljs` downgrade rather than a safe patch upgrade.

## Operator Notes

- Windows may warn on unsigned install scripts or local helper binaries.
- Browser extension and Office add-in still require manual sideload steps.
- JSON module imports emit Node `ExperimentalWarning` on current runtime, but they do not block verification.
- Kimi real runtime verification is skipped when the configured account quota is exhausted.
