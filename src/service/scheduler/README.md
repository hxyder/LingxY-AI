# Scheduler

Scheduler runtime owns:

- schedule definitions
- trigger normalization
- pending approval queue for unattended high-risk actions
- misfire recovery
- schedule run history
- failure guards and auto-disable rules

Lifecycle rules:

- `trigger_type: "at"` is native one-shot. It is complete after one dispatch
  even if the caller did not set `metadata.one_shot`.
- `metadata.one_shot: true` remains supported for interval-based short
  reminders created by the desktop UI.
- `enabled` controls automatic firing only. A user-initiated manual "Run now"
  may dispatch a paused or completed schedule without re-enabling it.
- `enabled && next_run_at == null` is valid for watcher triggers, but for
  one-shot schedules it is a terminal/expired state and should be normalized
  out of the active queue.

Current scope is a local single-process scaffold for cron / interval / file-watch semantics.
