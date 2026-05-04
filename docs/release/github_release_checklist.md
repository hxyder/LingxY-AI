# GitHub Release Checklist

This checklist is for publishing the repository to GitHub. It is separate from
the trial package checklist because a clean GitHub repo needs to avoid local
runtime data, credentials, generated packages, and unclear public-facing docs.

## Required Before Push

- Run `npm run verify:github-readiness`.
- Run `npm run verify:security-policy`.
- Review all advisory warnings from `verify:github-readiness`, especially
  root Markdown docs that would become public.
- If using GitHub Pages for OAuth verification, run
  `npm run verify:github-pages-readiness`.
- Run `npm run check`.
- Confirm `git status --short` contains only intentional changes.
- Confirm `.github/workflows/repo-baseline.yml` passes after push.
- Before release branches or public announcement, run the `Release Gate`
  workflow or push through a `release/**` branch.
- Before publishing installer artifacts, run the `Release Artifacts` workflow.
  Confirm it uses Node 22.12.0, runs `npm run check`, refreshes
  `THIRD_PARTY_LICENSES.md`, generates `checksums.sha256`, and uploads the
  Windows installer artifacts.
- Confirm release workflows run `npm run verify:audit-high`. Current policy
  blocks high/critical advisories; documented moderate advisories must be
  reviewed in `docs/release/known_issues.md` instead of force-fixed blindly.
- For local `npm run pack` smoke on Windows, confirm Visual Studio Build Tools
  with the Desktop development with C++ workload is installed; Electron 39
  rebuilds native modules such as `better-sqlite3` during packaging.
- Confirm local files under `models/`, `dist/`, `logs/`, `artifacts/`,
  `outputs/`, `.tmp/`, `internal/`, and `.claude/settings.local.json` are
  not tracked.
- Confirm `.env` files and runtime config files are not tracked.
- Review `docs/public/privacy.html` and `docs/public/terms.html` before using
  GitHub Pages for OAuth verification.

## Public/Open-Source License

- Keep the root `LICENSE` and matching `package.json` license in sync.
- Preserve third-party notices in `THIRD_PARTY_LICENSES.md` when distributing
  source or packaged builds.
- Keep `SECURITY.md` and `.github/dependabot.yml` tracked; they are part of
  the public repository readiness lock.
- Keep `package.json` as `"private": true` unless npm publication is intended.

## Allowed Placeholder Exceptions

- `external/paddle_ocr_runtime/README.md` is allowed as a placeholder.
- Actual OCR runtime binaries, Python environments, downloaded models, and
  generated package outputs must stay untracked.

## Final Manual Review

- Search GitHub's web UI after push for obvious private terms, machine paths,
  and credentials.
- Review root-level planning/design Markdown docs before making the repo public.
- Confirm `git ls-files internal phases` returns no files.
- Create a fresh clone and run `npm install` plus the documented quick-start
  path from `README.md`.
- Check the Repo Baseline GitHub Actions run: it should execute
  `npm ci`, `verify:github-readiness`, `verify:dependency-hygiene`,
  `verify:security-policy`, `verify:structure`, `verify:doc-references`,
  `verify:local-http-surface`, and
  `verify:behavior-tests`.
- Check the Release Gate GitHub Actions run before any release: it should
  execute `npm ci` and the full `npm run check`.
- Check the Release Artifacts GitHub Actions run before making a GitHub
  Release public: it should upload the installer, `latest.yml` when produced
  by electron-builder, `checksums.sha256`, `LICENSE`, and
  `THIRD_PARTY_LICENSES.md`.
- Only publish GitHub Pages after checking the final URLs and contact emails.
