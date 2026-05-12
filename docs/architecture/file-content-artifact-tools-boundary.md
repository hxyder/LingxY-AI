# File Content And Artifact Tools Boundary

CAP inline medium/high-risk family extraction. Status: 2026-05-11, moved to
`src/service/capabilities/tools/file-content-tools.mjs` after static and
runtime-contract preflight verification.

## Current State

- Current owner: `src/service/capabilities/tools/file-content-tools.mjs`
- Registry aggregator: `src/service/action_tools/tools/index.mjs`
- Tool family:
  - `read_file_text`
  - `read_folder_text`
  - `search_file_content`
  - `index_file_content`
  - `register_artifact`
  - `resolve_output_path`
- Shared helpers:
  - `clampNumber`
  - `emitFileReadEvent`
  - `emitToolFileReadTiming`
  - `fileReadResultFromTranscriptEntry`
- External dependencies:
  - `src/service/extractors/file-ingest.mjs`
  - `src/service/core/local-file-collection.mjs`
  - `src/service/core/file-read-budget.mjs`
  - `src/service/core/file-evidence-coverage.mjs`
  - `src/service/core/file-content-index-records.mjs`
  - `src/service/capabilities/tools/file-manifest-helpers.mjs`
  - `src/service/embeddings/store.mjs`

## Contract

- `read_file_text`, `read_folder_text`, `search_file_content`,
  `register_artifact`, and `resolve_output_path` remain non-confirmation tools.
- `index_file_content` remains high risk and confirmation-required.
- Tool ids, schema keys, risk levels, required capabilities, registry order,
  metadata names, event names, and artifact result shape must remain stable.
- `read_file_text` must delegate directory paths to `read_folder_text` and pass
  through `ctx` so task file-read budgets apply.
- Fresh reads must emit file-read progress/timing events and coverage metadata.
- `search_file_content` must query only the file-content embedding namespace and
  must not read disk.
- `index_file_content` must index only prior successful transcript reads and
  must not read disk directly.
- `register_artifact` must return `artifactPaths: [filePath]`.
- `resolve_output_path` must remain path-resolution only; it does not create an
  artifact and must not satisfy artifact creation.

## No-Touch Areas

- Do not change IPC channels, HTTP routes, provider ids, storage schema, tool
  ids, artifact kinds, or storage records.
- Do not change risk levels, confirmation gates, schema keys, required
  capabilities, registry order, embedding namespace, file-read event names, or
  artifact manifest shape.
- Do not move this family into Electron main, preload, renderer, desktop UI, or
  workers without a separate worker-backed design and verifier.
- Do not add a compatibility barrel or duplicate reachable implementation.

## Verification

- `scripts/verify-file-content-tools-contract.mjs` locks the moved owner,
  helper presence, tool metadata, source dependencies, file-read coverage,
  index no-disk-read invariant, register-artifact artifact path shape,
  resolve-output non-artifact behavior, old inline body absence, and this
  document.
- Existing targeted behavior coverage includes:
  - `tests/behavior/read-file-text-tool.test.mjs`
  - `tests/behavior/local-file-fresh-read-contract.test.mjs`
  - `tests/behavior/file-content-index-records.test.mjs`
## Decision

Moved. The current owner is
`src/service/capabilities/tools/file-content-tools.mjs`.
`src/service/action_tools/tools/index.mjs` remains the live aggregator and must
not reintroduce inline file-content/artifact helper or tool bodies.
