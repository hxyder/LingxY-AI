# Release Readiness

This section tracks the trial release baseline for LingxY.

Current positioning:

- The current output is a repo-local trial kit for Windows, not a standalone signed installer
- The preferred launch path is the desktop shell via `scripts/start-trial.ps1`
- The generated bundle in `dist/trial/<version>/` now includes `Check LingxY Desktop Trial.cmd`, `Setup LingxY Desktop Trial.cmd`, plus one-click launchers for starting and stopping the desktop app from the same workspace
- The generated bundle also includes `TRIAL_READINESS_REPORT.md` / `.json` to capture the local machine's current preflight and release validation snapshot
- Release verification now includes a desktop smoke launch via `scripts/verify-trial-launch.mjs`, so the Electron shell startup path is part of the trial readiness baseline

Included documents:

- `trial_release_notes_v0.1.0-trial.1.md`
- `e2e_matrix.md`
- `functional_acceptance_matrix.md`
- `known_issues.md`
- `rollback_plan.md`
- `external_trial_checklist.md`
- `trial_feedback_template.md`

The generated sideload bundle is produced by `npm run build:trial-package`.

For installer artifacts, use the `Release Artifacts` GitHub Actions workflow.
It runs on Windows, executes `npm run check`, rebuilds the third-party license
inventory, runs `npm run dist`, generates SHA256 checksums, uploads the
artifacts, and can create or update a draft GitHub Release for a tag. Treat
runtime auto-update as a later step that depends on this release artifact
channel being stable.
