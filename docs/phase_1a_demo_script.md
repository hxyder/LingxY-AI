# Phase 1a Demo Script

## Demo Goal

Show the first end-to-end usable loop without relying on file or Office integrations.

## Scenario

Clipboard text -> overlay -> summarize -> task history

## Steps

1. Launch LingxY and verify tray is running.
2. Copy a paragraph of text into the clipboard.
3. Trigger the fixed overlay with the configured hotkey.
4. Click "Read Clipboard".
5. Confirm the overlay shows a preview of the captured text.
6. Choose the "Summarize" action.
7. Verify a task record is created immediately.
8. Verify streaming output appears in the overlay.
9. Open the console.
10. Verify the task is visible in the task list.
11. Open task detail and verify:
    - stored command
    - captured context
    - event timeline
    - final result

## Pass Criteria

- the user can complete the flow without restarting the app
- a task record exists after completion
- the result is visible both in the overlay path and in task history
