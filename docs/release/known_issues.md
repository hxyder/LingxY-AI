# Known Issues

## Accepted For Trial

- Electron shell is still a runtime-connected scaffold; trial operation relies on service/runtime verification more than polished renderer UX.
- On the current Windows environment, Electron bootstrap for the local shell can fail before the overlay UI renders because `require('electron')` resolves to the npm stub path instead of runtime API bindings.
- Cloud AI providers expose health/config discovery only; current primary execution path is `Kimi Code CLI`.
- Office integration ships with protocol-handler-first fallback; localhost HTTPS is not a release blocker for the trial channel.
- DAG resume currently replays through a platform placeholder executor path rather than real per-node business executors.
- History search uses a lightweight lexical embedding approximation and is suitable for local recall, not semantic ranking parity with production vector services.

## Operator Notes

- Windows may warn on unsigned install scripts or local helper binaries.
- Browser extension and Office add-in still require manual sideload steps.
- JSON module imports emit Node `ExperimentalWarning` on current runtime, but they do not block verification.
