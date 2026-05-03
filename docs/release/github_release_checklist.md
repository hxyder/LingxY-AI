# GitHub Release Checklist

This checklist is for publishing the repository to GitHub. It is separate from
the trial package checklist because a clean GitHub repo needs to avoid local
runtime data, credentials, generated packages, and unclear public-facing docs.

## Required Before Push

- Run `npm run verify:github-readiness`.
- If using GitHub Pages for OAuth verification, run
  `npm run verify:github-pages-readiness`.
- Run `npm run check`.
- Confirm `git status --short` contains only intentional changes.
- Confirm `.github/workflows/repo-baseline.yml` passes after push.
- Before release branches or public announcement, run the `Release Gate`
  workflow or push through a `release/**` branch.
- Confirm local files under `models/`, `dist/`, `logs/`, `artifacts/`,
  `outputs/`, `.tmp/`, and `.claude/settings.local.json` are not tracked.
- Confirm `.env` files and runtime config files are not tracked.
- Review `docs/public/privacy.html` and `docs/public/terms.html` before using
  GitHub Pages for OAuth verification.

## Public/Open-Source Decision

- Choose a root `LICENSE` before presenting the repo as open source.
- Add the matching `license` field to `package.json`.
- Keep `package.json` as `"private": true` unless npm publication is intended.

## Allowed Placeholder Exceptions

- `external/paddle_ocr_runtime/README.md` is allowed as a placeholder.
- Actual OCR runtime binaries, Python environments, downloaded models, and
  generated package outputs must stay untracked.

## Final Manual Review

- Search GitHub's web UI after push for obvious private terms, machine paths,
  and credentials.
- Create a fresh clone and run `npm install` plus the documented quick-start
  path from `README.md`.
- Check the Repo Baseline GitHub Actions run: it should execute
  `npm ci`, `verify:github-readiness`, `verify:structure`,
  `verify:local-http-surface`, and `verify:behavior-tests`.
- Check the Release Gate GitHub Actions run before any release: it should
  execute `npm ci` and the full `npm run check`.
- Only publish GitHub Pages after checking the final URLs and contact emails.
