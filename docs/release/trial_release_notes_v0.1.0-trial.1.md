# LingxY Trial Release Notes — 0.1.0-trial.1

## Focus

This trial release packages the local-first LingxY runtime around `Kimi Code CLI`, native Windows entry points, browser capture, Office bridge scaffolds, template persistence, and DAG resume.

## Included Highlights

- Persistent local runtime with SQLite, HTTP, SSE, and runtime config storage
- Real Kimi Code CLI detection and print-mode execution
- Explorer helper, browser native host, and Office add-in sideload assets
- Operator console runtime client with retry, cancel, approvals, schedules, templates, budget, and history views
- User template persistence and local DAG checkpoint/resume

## Trial Constraints

- Trial users should prefer `Kimi Code CLI` as the active executor path
- Browser extension and Office add-in remain manual sideload installs
- Cloud provider execution is intentionally not the primary path in this release
