# Release Evidence Bundle

REL-001 collects release readiness evidence into one local JSON bundle.

Source of truth:

- `src/shared/release-evidence-bundle.mjs`
- `docs/release/evidence/release-evidence-bundle.template.json`
- `scripts/verify-release-evidence-bundle.mjs`
- `tests/behavior/release-evidence-bundle.test.mjs`

## Required Evidence

- `npm run check:fast` result.
- `npm run verify:desktop-gui-smoke` result.
- `node scripts/verify-release-readiness.mjs` result.
- Desktop product evidence pack rows.
- Real provider/OAuth/sandbox evidence references when those surfaces are
  release-relevant.
- Policy trace references when policy behavior changed.
- Known issues for every partial or failed release decision.
- Environment notes: OS, Node, Electron, hardware or account constraints.

## Rules

- Live evidence must include a redaction note.
- A partial or failed release decision must include known issues.
- The bundle references evidence files or summaries; it must not embed secrets,
  tokens, cookies, raw email bodies, raw file contents, or prompt secrets.
- `check:fast` alone is never enough for a user-visible release candidate.

## Verification

```powershell
node --test tests/behavior/release-evidence-bundle.test.mjs
node scripts/verify-release-evidence-bundle.mjs
```
