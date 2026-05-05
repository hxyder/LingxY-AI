# Rollback Plan

## Trigger Conditions

- Local runtime cannot start or fails `/health`
- Configured model provider or code CLI adapter becomes unavailable on test machines
- Native integrations fail to submit to the runtime
- Trial package install instructions no longer match the generated bundle

## Steps

1. Stop the local runtime and helper processes.
2. Remove sideloaded browser extension and Office add-in manifests from the test machine.
3. Unregister Explorer entry and native host with the shipped PowerShell scripts in reverse order.
4. Archive the generated `dist/trial/<version>/` directory plus `release-manifest.json` for postmortem.
5. Restore the previous known-good trial bundle and rerun the release readiness verification.

## Data Notes

- Runtime user data currently lives under the legacy `%APPDATA%\\UCA` namespace unless overridden. Keep this path stable until a migration plan is explicit and tested.
- Before rollback, copy `config/`, `data/`, and `logs/` if task history or templates need to be preserved.
