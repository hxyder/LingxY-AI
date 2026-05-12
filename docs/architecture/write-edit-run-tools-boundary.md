# Write Edit Run Tools Boundary

CAP high-risk inline family extraction preflight. Status: 2026-05-11,
preflight locked; physical move not started.

## Current State

- Current owner: `src/service/action_tools/tools/index.mjs`
- Target owner after physical move:
  `src/service/capabilities/tools/file-mutation-execution-tools.mjs`
- Registry aggregator: `src/service/action_tools/tools/index.mjs`
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
  - document-rendering helpers currently still inline in
    `src/service/action_tools/tools/index.mjs`

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

- `scripts/verify-write-edit-run-tools-contract.mjs` currently locks the
  preflight state: current owner, target owner absence, tool metadata, registry
  order, helper/dependency presence, write/edit/run runtime smoke behavior,
  file-reversibility coverage, approval-resume gate coverage, and this
  document.
- Before physical migration, update the verifier in the same commit so it
  requires:
  - `src/service/capabilities/tools/file-mutation-execution-tools.mjs` exists;
  - `src/service/action_tools/tools/index.mjs` imports the three tools from the
    capability owner;
  - old inline helper/tool definitions are absent from `index.mjs`;
  - registry order and runtime behavior are unchanged.

## Decision

Preflight only. The current owner remains
`src/service/action_tools/tools/index.mjs`. Physical migration must be a
separate CAP-5F move after this verifier and targeted gates pass.
