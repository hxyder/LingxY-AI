# Risk Register v1

| ID | Risk | Impact | Likelihood | Mitigation | Validation Phase |
|---|---|---|---|---|---|
| R-001 | Explorer selection behavior differs across Windows versions | High | Medium | keep registry menu plus hotkey path | 1b |
| R-002 | Win11 context menu hides entry under secondary menu | Medium | High | promote hotkey entry and accept folded menu for MVP | 1b |
| R-003 | Native helper integration destabilizes Electron shell | High | Medium | isolate helper in separate process | 1b |
| R-004 | Browser native messaging registration fails | Medium | Medium | keep install diagnostics and manual recovery guide | 1c |
| R-005 | Office localhost HTTPS blocked by enterprise policy | High | High | time-box spike and keep fallback path | 4 |
| R-006 | OCR runtime installation is too heavy | Medium | Medium | keep OCR runtime external and on-demand | 5 |
| R-007 | Redaction state cannot recover after crash | High | Medium | fail-closed and require explicit rerun | 2.5 |
| R-008 | Scheduler unattended actions bypass user intent | High | Medium | execution_mode plus pending approval queue | Scheduler |
| R-009 | Action tools become arbitrary command execution | High | Medium | strict registry and schema validation | Action Tools |
| R-010 | Long-running tasks produce unbounded event volume | Medium | Medium | event batching and UI virtualization | 2 |
| R-011 | AI provider costs exceed budget expectations | High | Medium | model routing and budget controls | 6 |
| R-012 | File parsing for large PDFs causes memory pressure | High | Medium | size limits and child-process extraction | 1b/5 |
| R-013 | Global shortcuts conflict with OS or user tools | Medium | High | detect conflict and allow rebind | 1a |
| R-014 | Presenter Mode is not visible enough during live demos | High | Medium | tray badge, banner, hotkey, audit trail | 2.5 |
| R-015 | Team implements divergent contract names in early phases | High | Medium | freeze schemas before Phase 1 implementation | 0 |
| R-016 | Kimi CLI protocol drifts from assumptions | Medium | Medium | formalize bridge protocol and spike with real CLI | 0/1b |
| R-017 | SQLite ownership is unclear across processes | High | Medium | single service-owned connection model | 0/1a |
| R-018 | Pending approvals become invisible dead letters | High | Medium | tray badge, console queue, TTL and superseded rules | Scheduler |
