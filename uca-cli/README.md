# LingxY CLI (legacy `uca-cli` path)

This folder is the **lightweight task-submission entry point** for
Explorer context menus and other shell integrations. It hands off
to the local LingxY runtime over HTTP — purposefully provider-
agnostic so Code CLI adapters and future shell integrations can
reuse the same submission contract.

## Why the directory is named `uca-cli/`

The package directory + executable are kept in the legacy
`uca-*` namespace so that already-installed Explorer registry
entries, Chrome native messaging hosts (`com.uca.host`), and
the per-user data directory (`%APPDATA%\UCA`) keep working
without forcing a coordinated migration. The product name is
LingxY; the namespace migration is tracked as a follow-up.

## Scope

- parse `submit --files ...` arguments
- batch multiple launches into one `file_group`
- hand off a normalized payload to the service transport
- submit to the local runtime over HTTP via
  `uca-cli/src/runtime-client.mjs`

See `src/cli.mjs` for the entry point and
`src/runtime-client.mjs` for the HTTP client used by every
submission path.
