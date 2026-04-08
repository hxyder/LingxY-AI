# Kimi CLI Setup

## Required

- A local Kimi-compatible CLI executable
- UTF-8 stdio support
- JSON Lines progress events on stdout

## Expected Contract

- stdin receives one JSON task package
- stdout emits JSON Lines events
- created artifacts must be written under the provided `output_dir`

## Current Dev Verification

Repository verification uses `tests/fixtures/mock-kimi-cli.mjs` as a stand-in executable.

Replace it with the real executable by wiring:

- `command`: CLI binary path
- `args`: provider-specific arguments
- `env`: required provider credentials
