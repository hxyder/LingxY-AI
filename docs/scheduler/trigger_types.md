# Trigger Types

- `cron`: scheduled by cron expression and timezone
- `interval`: every N seconds
- `file_watch`: external watcher event forwarded into scheduler
- `clipboard_watch`: periodic poll placeholder

`file_watch` currently exposes dispatch hooks and does not yet wire a real `chokidar` watcher.
