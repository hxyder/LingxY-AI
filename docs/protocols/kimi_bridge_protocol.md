# Kimi Bridge Protocol v1

## Purpose

Define the normalized contract between LingxY and a code-oriented CLI executor such as Kimi Code CLI.

## Transport

- subprocess stdin: JSON request envelope
- subprocess stdout: JSON Lines event stream
- subprocess stderr: raw diagnostic logs

## Request Envelope

```json
{
  "task_id": "TASK-20260408-0001",
  "task_type": "report_generation",
  "user_command": "Analyze the selected file and produce a report",
  "context": {
    "source_type": "file",
    "file_paths": ["C:/docs/example.pdf"]
  },
  "output_requirements": {
    "primary": "markdown_report",
    "save_required": true,
    "output_dir": "C:/Users/<user>/AppData/Roaming/UCA/outputs/2026-04-08/TASK-20260408-0001"
  },
  "rules": {
    "must_emit_progress": true,
    "must_return_artifact_paths": true,
    "max_runtime_seconds": 600
  },
  "trace_id": "trace_xxx"
}
```

## Event Stream

Each stdout line must be a valid JSON object.

Supported event types:

- `accepted`
- `started`
- `step_started`
- `log`
- `step_finished`
- `artifact_created`
- `warning`
- `success`
- `failed`

## Cancellation

- LingxY first requests graceful shutdown
- if the process does not exit within grace period, LingxY force-kills it
- partial logs and artifacts must remain attached to the parent task

## Recovery Notes

- a crashed CLI process marks the parent task failed or interrupted depending on execution stage
- checkpoint resume is optional and must be declared by the adapter capability
