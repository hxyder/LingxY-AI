# scripts/

This directory holds three families of executables:

1. **Verifiers** (`verify-*.mjs`) — pre-merge / pre-release contract
   gates. They never touch production state; they read source files
   and assert invariants. The full chain is enumerated in
   `check-manifest.mjs` and run by `npm run check` (140 commands)
   or `npm run check:fast` (10 commands, the subset we run on every
   commit during dev).
2. **Build / release helpers** — `run-electron-builder.mjs`,
   `build-trial-package.mjs`, `generate-third-party-licenses.mjs`,
   `generate-brand-icons.py`, `generate-brand-mark-svg.py`. These
   shape the artifacts that go into `dist/`; some are wired to
   `npm run dist`, others are run manually before release.
3. **Runtime sidecars** — Python / PowerShell helpers consumed by
   the Electron main process: `local-whisper-transcribe.py`,
   `local-sherpa-kws.py`, `capture-screenshot.ps1`,
   `active-window-probe.ps1`, etc. These are bundled into the
   Electron app via `package.json` `build.extraResources` /
   `build.files`.

## Day-to-day commands

```bash
# Lightning-fast pre-commit (10 verifiers, ~15s):
npm run check:fast

# Full release-gate chain (~5 min):
npm run check

# Single verifier:
npm run verify:brand-assets        # or any other verify:* script
```

Each `verify:*` script is exposed as an npm script in `package.json`
so CI can target them individually.

## Sub-directories

- `app_launcher/` — Python helpers the action_tools tool registry
  uses to launch native apps via Windows shell APIs. Bundled.
- `real-llm-test/` — corpus runner + diff tooling. `corpus.mjs` is
  the 109-item test suite; `run-corpus.mjs` drives it against a
  running runtime; `diff-runs.mjs` compares two reports;
  `mock-shadow-run.mjs` exercises the route verifier against the
  corpus with stubbed providers (no API key needed). Reports
  (`report-*.json`/`.md`) and `mock-shadow.jsonl` are gitignored.
- `__pycache__/` — gitignored.

## Adding a new verifier

1. Write `scripts/verify-<topic>.mjs`. It must `process.exit(1)` on
   failure with a clear stderr message; emit `ok verify-<topic>` on
   success.
2. Add an npm script alias in `package.json` so CI can target it.
3. Append the command to `CHECK_COMMANDS` (or `FAST_CHECK_COMMANDS`
   for fast-path inclusion) in `check-manifest.mjs`.
4. Run `node scripts/verify-check-runner.mjs` to confirm the chain
   stays well-formed.
