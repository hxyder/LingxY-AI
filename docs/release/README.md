# Release Readiness

This section tracks the trial release baseline for UCA.

Current positioning:

- The current output is a repo-local trial kit for Windows, not a standalone signed installer
- The preferred launch path is the desktop shell via `scripts/start-trial.ps1`
- The generated bundle in `dist/trial/<version>/` now includes one-click launchers for starting and stopping the desktop app from the same workspace

Included documents:

- `trial_release_notes_v0.1.0-trial.1.md`
- `e2e_matrix.md`
- `known_issues.md`
- `rollback_plan.md`

The generated sideload bundle is produced by `npm run build:trial-package`.
