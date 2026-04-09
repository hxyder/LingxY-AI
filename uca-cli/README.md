# UCA CLI

`uca-cli` is the lightweight submission entry point for Explorer context menus and future shell integrations.

Current scope in `UCA-005`:

- parse `submit --files ...` arguments
- batch multiple launches into one `file_group`
- hand off a normalized payload to the service transport
- submit to the local runtime over HTTP via `uca-cli/src/runtime-client.mjs`

This folder stays provider-agnostic so later Code CLI adapters can reuse the same submission contract.
