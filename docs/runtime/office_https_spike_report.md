# Office HTTPS Spike Report

## Result

- Timebox: `5` working days
- Selected path for Phase 4 base ship: `C. protocol handler fallback`
- Deferred enhancement path: `A. localhost HTTPS with self-signed root`

## Why this path was selected

- It preserves the required base flow: selection capture -> submit -> task visible in console.
- It avoids blocking Phase 4 on local certificate trust and enterprise policy issues.
- It keeps a clean upgrade path to direct `https://localhost:9413` later.

## What remains open

- True Task Pane streaming from localhost HTTPS
- Direct writeback without leaving the Add-in transport
- Real certificate installation / removal scripts

## Phase 4 ship boundary

- Base ship supports Office selection capture and task submission.
- Base ship does not require document writeback.
- Direct localhost HTTPS is tracked as a follow-up enhancement, not a release blocker.
