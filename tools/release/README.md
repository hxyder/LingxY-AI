# Release Tools

This directory contains release-time configuration and packaging
metadata for two distribution paths:

## v1.0+ public release (canonical, going forward)

The public path uses **`electron-updater`** wired to GitHub Releases
(`lingxy-ai/lingxy-desktop`). Release config lives in
`package.json` under the `build.publish` key; the artifact pipeline
is `.github/workflows/release-artifacts.yml` (publish job gated on
`github.repository == 'lingxy-ai/lingxy-desktop'` so forks cannot
pollute the canonical update feed).

User-side flow:

1. Tag and push (`v1.0.0` etc.).
2. `release-artifacts.yml` builds the NSIS installer and uploads
   it + `latest.yml` (the electron-updater metadata) to a GitHub
   Release.
3. Installed clients see the new version on their next
   strategy-driven check (`off / manual / notify / auto`, set by
   the user during first-run consent).

## Legacy `trial` channel (sideload distribution kit)

`release-config.json` and the `scripts/*trial*` helpers are
**legacy** — they predate the auto-update path and remain only to
support the existing trial-kit sideload workflow. New users should
use the v1.0+ installer.

The legacy chain:

- `tools/release/release-config.json` — `channel: trial`,
  `trial_version`, required asset list.
- `scripts/build-trial-package.mjs` — assembles the trial bundle
  under `dist/trial/<trial_version>/`.
- `scripts/setup-trial.ps1` / `start-trial.ps1` / `stop-trial.ps1`
  — operator-side bring-up scripts inside the bundle.
- `scripts/verify-trial-launch.mjs` /
  `scripts/generate-trial-readiness-report.mjs` — release-time gates.

Plan: keep this kit runnable for now; archive (or extract to a
separate maintenance branch) once the v1.0 GitHub Releases path
covers everyone the trial currently serves.
