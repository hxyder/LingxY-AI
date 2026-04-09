# Office Add-in Sideload

Current scaffold ships three manifest files:

- `office_addin/word/manifest.xml`
- `office_addin/excel/manifest.xml`
- `office_addin/ppt/manifest.xml`

Recommended local validation steps:

1. Open the target Office host on Windows.
2. Use the Office Add-in sideload flow for the matching manifest.
3. Verify the Task Pane loads `office_addin/shared/task_pane.html`.
4. Confirm selection capture can build an `office_selection` payload.
5. Confirm the transport banner shows the selected fallback strategy.

Phase 4 base ship assumes manual sideload rather than AppSource distribution.
