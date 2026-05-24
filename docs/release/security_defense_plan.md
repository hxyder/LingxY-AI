# Security Defense Plan

This plan records the current GitHub/public-release security posture and the
next hardening steps for LingxY desktop.

## Current Snapshot

- GitHub Code Scanning alerts cannot be read from this checkout without an
  authenticated GitHub client. The local checkout has no `git remote`, and the
  GitHub API returns unauthorized/not found for `lingxy-ai/lingxy-desktop`.
- CodeQL workflow shape and workflow permissions pass local verification.
- Dependency audit has no high or critical advisories after the lockfile
  refresh. The remaining advisory is the documented moderate `exceljs -> uuid`
  issue; npm proposes a breaking `exceljs` downgrade, so it remains accepted
  until a compatible upstream fix or replacement path exists.
- GitHub readiness no longer reports OpenAI-style API key literals after the
  test fixture was changed to runtime construction.
- GitHub readiness still fails because `AGENTS.md` and `CHANGELOG.md` are
  tracked root Markdown files, which conflicts with the current public-release
  policy that only standard community/product Markdown stays at the root.
- File-size inventory still flags `src/desktop/renderer/console.js` as over the
  release line-count limit; that is maintainability and reviewability risk, not
  an immediate secret or dependency exposure.

## P0 Gates Before Public Push

- Fetch live Code Scanning alerts with an authenticated client:
  `gh api repos/lingxy-ai/lingxy-desktop/code-scanning/alerts?state=open`.
- Triage alerts by reachable trust boundary first: local HTTP mutations,
  Electron preload/renderer, browser extension content scripts, connector
  tokens, file/process execution, and release workflows.
- Keep `npm run verify:codeql-workflow`, `npm run verify:workflow-permissions`,
  `npm run verify:dependency-hygiene`, and `npm run verify:audit-high` green.
- Run `npm run verify:github-readiness` and resolve the root Markdown policy
  decision before public release. Do not delete `AGENTS.md` only to pass the
  gate; move or replace it only after architecture guardrail verifiers are
  updated.
- Confirm `git ls-files internal models dist node_modules .tmp .claude .env`
  returns no tracked local data or generated output.

## P1 Runtime And Desktop Hardening

- Replace static desktop actor checks with a per-session local capability token
  for guarded local HTTP mutation routes. Keep CORS custom headers closed to
  web pages, and add tests proving arbitrary browser origins cannot mutate.
- Review preload bridge methods that expose filesystem or shell capabilities
  (`openPath`, `openExternal`, `readTextFile`, `listDirectory`,
  `readFileAsDataUrl`) and route sensitive operations through explicit IPC
  validators with path budgets and URL scheme allowlists.
- Continue splitting large renderer surfaces so XSS review is tractable. New
  renderer modules should use escaped HTML helpers or DOM construction by
  default, and rich HTML should be isolated in sandboxed iframes.
- Keep Electron windows on `contextIsolation: true`; use `sandbox: true` where
  preload is not required. Any `sandbox: false` window should have a documented
  preload/API reason and a verifier.

## P1 Browser Extension Hardening

- Reduce `host_permissions` from `<all_urls>` where possible, or move broad
  access behind optional host permissions and active-tab flows.
- Treat `world: "MAIN"` page-source capture as privileged. Keep the exported
  page function minimal, idempotent, and free of extension secrets.
- Keep standalone provider API keys out of logs and diagnostics. Prefer desktop
  Secret Store handoff for non-local provider keys when the desktop runtime is
  available.
- Add a browser-extension security verifier that checks permission breadth,
  MAIN-world script exposure, and Markdown rendering escape behavior.

## P1 Supply Chain And Release Defense

- Keep Dependabot enabled for npm and GitHub Actions. For transitive advisories
  that cannot be safely auto-fixed, document the accepted risk in
  `docs/release/known_issues.md`.
- Add a release check that fails on high/critical `npm audit` findings and on
  OpenAI/GitHub/AWS/Google/Slack/private-key literals in tracked files.
- Keep generated assets, local models, packaged installers, screenshots, and
  runtime outputs ignored unless a release checklist explicitly allows them.
- Regenerate `THIRD_PARTY_LICENSES.md` before packaged releases and keep
  `LICENSE` plus notices in Electron packaged files.

## P2 Continuous Review

- Add a weekly security review loop: Code Scanning alerts, Dependabot PRs,
  secret scan, public file inventory, browser extension permissions, and local
  HTTP route inventory.
- Track every accepted advisory with owner, reason, affected boundary, and
  next review date.
- Add threat-model notes for connectors and provider credentials: token
  storage, refresh, revocation, diagnostic export, and account disconnect.
- Before broad runtime changes, follow the AGENTS upgrade intake protocol and
  update the relevant architecture inventories and specialty verifiers.
