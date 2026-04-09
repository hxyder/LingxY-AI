# Console

Main workspace / task center UI placeholder.

Phase 2 additions:

- task detail timeline view model
- task list filter model
- summary cards for running / queued / today success / today failed

Current runtime-connected additions:

- console shell model now accepts runtime health, Code CLI status, provider health, and budget state
- first-run wizard now recommends Kimi Code CLI as the primary backend for the current phase
- task detail view now exposes provider, model, retry, and cost summaries
- console runtime client now loads HTTP snapshots and builds approvals / schedules / budget / history / audit view models
- console runtime client now exposes task detail loading, SSE subscriptions, retry / cancel actions, approval actions, and manual schedule dispatch
