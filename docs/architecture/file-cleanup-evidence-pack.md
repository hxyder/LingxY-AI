# File Cleanup Evidence Pack

This evidence pack turns file cleanup into a typed runtime-maintenance contract.
It is intentionally evidence-only: the runner may list candidates and write a
report, but it must not delete, archive, or move files.

Use it for PMAT-014 cleanup work after the global execution efficiency pass has
identified a measurable speed, cost, redundancy, answer-quality, or large-file
ownership reason to touch the file.

## Candidate Categories

- `local_generated_output`: `.tmp/`, `tmp/`, transient logs, and disposable
  reports that can be regenerated.
- `historical_evidence`: old live-provider, release, or acceptance reports that
  may need retention or archive policy before any cleanup.
- `old_reachable_implementation`: legacy code, compatibility paths, retired
  route/tool surfaces, duplicate exports, and adapters.
- `large_mixed_responsibility_file`: source files that need boundary-first
  extraction before any deletion can be considered.

## Decisions

- `candidate`: needs review or more evidence.
- `retain`: keep as current evidence or reachable implementation.
- `archive_ready`: may be moved only after all required tracked-source sweeps
  pass.
- `delete_ready`: may be deleted only after all required tracked-source sweeps
  pass, except for disposable local generated output.
- `split_required`: must be decomposed by owner boundary before deletion work.
- `blocked`: explicitly not safe to clean up yet.

## Required Evidence

Tracked source files marked `archive_ready` or `delete_ready` must include:

- `referenceSweep`: import and reference sweep across `src/`, `scripts/`,
  `tests/`, and `docs/`.
- `packageScriptSweep`: package scripts, script registrations, and public
  command entries.
- `publicExportSweep`: exported APIs and barrels.
- `interfaceSweep`: IPC channels, HTTP routes, tool ids, artifact kinds,
  provider ids, storage schemas, and task event names where relevant.
- `replacementVerifier`: targeted behavior test or verifier proving the new
  path.
- `rollbackOrArchivePath`: explicit rollback note or archive destination.
- `checkFast`: `npm run check:fast` after the cleanup.

`local_generated_output` can be `delete_ready` without source sweeps only when
it is untracked and under an approved disposable path. The runner still reports
the candidate and leaves deletion to a deliberate follow-up action.

## Commands

- `npm run verify:file-cleanup-evidence-pack` verifies the shared contract,
  docs, template, behavior tests, and check manifest wiring.
- `node scripts/run-file-cleanup-candidates.mjs` writes a non-destructive
  candidate report under `.tmp/file-cleanup-candidates/`.

## Guardrails

Do not clean up `node_modules/`, `dist/`, runtime databases, user data, secrets,
or roadmap-linked release evidence through this pack. Large-file cleanup starts
with ownership and verifier coverage, then extraction, then old-path retirement
once the replacement is proven.
