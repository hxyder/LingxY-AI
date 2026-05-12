# Desktop Product Evidence Pack

This is the DXR-001 evidence format for desktop product acceptance. It turns
manual, Electron GUI, live provider, connector, browser, Office, hardware, and
packaged-build evidence into one local JSON record per release candidate or
large product workflow change.

Source of truth:

- `src/shared/desktop-product-evidence-pack.mjs`
- `docs/release/evidence/desktop-product-evidence.template.json`
- `scripts/verify-desktop-product-evidence-pack.mjs`
- `tests/behavior/desktop-product-evidence-pack.test.mjs`

## Rules

- Keep `docs/release/desktop_product_acceptance_matrix.md` as the workflow
  matrix.
- Use this evidence pack to record which rows were exercised, with
  `pass`, `partial`, `fail`, or `not_run`.
- Every `partial` or `fail` row must link to `docs/release/known_issues.md` or
  another explicit known-issue entry.
- Real provider/API/OAuth/browser/Office/hardware/packaged-build evidence must
  include a redaction note and must not contain credentials, tokens, cookies,
  authorization headers, raw email bodies, raw file contents, or prompt secrets.
- `npm run check:fast` alone is not enough for user-visible desktop workflow
  changes; pair it with row-specific gates and real evidence when the row
  depends on real surfaces.

## Required fields

- `schemaVersion`
- `commit`
- `branch`
- `generatedAt`
- `checkFast`
- `electronGuiSmoke`
- `realEnvironments`
- `rows`
- `knownIssues`

Each row must include:

- `workflow`
- `status`
- `automatedGates`
- `manualEvidence`
- `knownIssue` when status is `partial` or `fail`

## Verification

Run:

```powershell
node scripts/verify-desktop-product-evidence-pack.mjs
node --test tests/behavior/desktop-product-evidence-pack.test.mjs
```
