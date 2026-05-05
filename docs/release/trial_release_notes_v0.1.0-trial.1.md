# LingxY Trial Release Notes — 0.1.0-trial.1

## Focus

This trial release packages the local-first LingxY runtime around configurable
model providers, code CLI adapters, native Windows entry points, browser
capture, Office bridge scaffolds, template persistence, and DAG resume.

## Included Highlights

- Persistent local runtime with SQLite, HTTP, SSE, and runtime config storage
- Configurable cloud/local model providers plus code CLI adapter discovery
- Explorer helper, browser native host, and Office add-in sideload assets
- Operator console runtime client with retry, cancel, approvals, schedules, templates, budget, and history views
- User template persistence and local DAG checkpoint/resume

## Trial Constraints

- Trial users must configure at least one model provider or code CLI adapter before running live AI tasks
- Kimi Code CLI remains a supported adapter path when available and quota permits
- Browser extension and Office add-in remain manual sideload installs
- Real provider/API behavior depends on the user's own credentials and upstream service availability
