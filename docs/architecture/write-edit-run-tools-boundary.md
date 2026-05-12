# Write Edit Run Tools Boundary

CAP high-risk inline family extraction. Status: 2026-05-11, moved to
`src/service/capabilities/tools/file-mutation-execution-tools.mjs` after
static and runtime-contract preflight verification.

## Current State

- Current owner: `src/service/capabilities/tools/file-mutation-execution-tools.mjs`
- Registry aggregator: `src/service/action_tools/tools/index.mjs`
- Shared document helper owner:
  `src/service/capabilities/tools/document-artifact-helpers.mjs`
- Tool family:
  - `write_file`
  - `edit_file`
  - `run_script`
- Current helper set that must move with the family:
  - `decodeWriteFileContent`
  - `RUN_SCRIPT_LANGUAGES`
  - `clampTimeout`
  - `spawnScript`
  - `resolveEditableTargetForEdit`
- Shared dependencies that must stay shared, not duplicated:
  - `src/service/core/artifact-path-helper.mjs`
  - `src/service/capabilities/tools/file-reversibility.mjs`
  - `src/service/capabilities/tools/document-artifact-helpers.mjs`

## Contract

- Tool ids, schema keys, risk levels, required capabilities, confirmation
  gates, registry order, metadata names, and artifact path shapes must remain
  stable.
- `write_file` must continue to:
  - resolve targets through `resolveSandboxedTarget`;
  - reject `..` path traversal;
  - reject existing files unless `overwrite: true`;
  - allow absolute paths only under configured writable artifact roots;
  - create a file reversibility checkpoint before mutation;
  - return `artifactPaths: [absTarget]` on success.
- `edit_file` must continue to:
  - require a target path;
  - resolve absolute paths only under editable artifact roots;
  - create a file reversibility checkpoint before mutation;
  - update existing outline-backed documents in place;
  - return `artifactPaths: [absTarget]` on success.
- `run_script` must continue to:
  - allow only `powershell`, `node`, and `python`;
  - write temporary scripts under the task output directory;
  - run subprocesses with `windowsHide: true`;
  - clamp timeout to 1-20 seconds;
  - return bounded stdout/stderr in observations.

## No-Touch Areas

- Do not change IPC channels, HTTP routes, provider ids, storage schema, tool
  ids, artifact kinds, storage records, or GUI behavior in CAP-5F.
- Do not change file-reversibility metadata names, checkpoint operations,
  recovery HTTP/IPC routes, or artifact preview behavior.
- Do not move `generate_document`, `render_diagram`, `render_svg`,
  `draft_capability`, or `save_capability_draft` in CAP-5F.
- Do not add a compatibility barrel or duplicate reachable implementation.
- Do not move this family into Electron main, preload, renderer, desktop UI, or
  workers.

## Verification

- `scripts/verify-write-edit-run-tools-contract.mjs` locks the moved owner,
  shared helper owner, tool metadata, registry order, helper/dependency
  presence, old inline body absence, write/edit/run runtime smoke behavior,
  file-reversibility coverage, approval-resume gate coverage, and this
  document.

## Decision

Moved. The current owner is
`src/service/capabilities/tools/file-mutation-execution-tools.mjs`.
`src/service/action_tools/tools/index.mjs` remains the live aggregator and must
not reintroduce inline write/edit/run helper or tool bodies.
