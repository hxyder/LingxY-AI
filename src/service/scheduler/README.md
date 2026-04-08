# Scheduler

Scheduler runtime owns:

- schedule definitions
- trigger normalization
- pending approval queue for unattended high-risk actions
- misfire recovery
- schedule run history
- failure guards and auto-disable rules

Current scope is a local single-process scaffold for cron / interval / file-watch semantics.
