# Artifact Surface Inventory

Phase 2A boundary inventory for artifact creation, registration, extraction, lineage, preview, and quality gates.

Status: verified against the current repository on 2026-05-18.

## Owner Surfaces

| Surface | Current path | Owner |
| --- | --- | --- |
| Artifact store facade | `src/service/store/artifact-store.mjs` | Service runtime |
| Artifact metadata helpers | `src/service/core/store/artifact-metadata.mjs` | Service runtime |
| Tool artifact contract | `src/service/core/artifact-action-contract.mjs` | Service runtime |
| Artifact quality gate | `src/service/core/artifact-quality.mjs` | Service runtime |
| Artifact fallback policy | `src/service/core/artifact-fallback-policy.mjs` | Service runtime |
| Tool execution persistence | `src/service/core/action-tool-submission.mjs` | Service runtime |
| Browser submission persistence | `src/service/core/browser-submission.mjs` | Service runtime |
| Artifact extraction service | `src/service/core/artifact-extracts/artifact-extract-service.mjs` | Service runtime |
| Artifact extraction background lane | `src/service/core/artifact-extracts/artifact-extract-background-lane.mjs` | Service runtime / worker lane |
| Artifact extract worker | `src/service/workers/artifact-extract-worker.mjs` | Service worker |
| Artifact lineage service | `src/service/core/artifact-lineage/artifact-lineage-service.mjs` | Service runtime |
| Artifact transform service | `src/service/core/artifact-transforms/artifact-transform-service.mjs` | Service runtime |
| Preview registry | `src/service/preview/registry.mjs` | Service runtime |
| Preview HTTP routes | `src/service/core/http-routes/preview-file-routes.mjs` | Service runtime |
| File reversibility helpers | `src/service/capabilities/tools/file-reversibility.mjs` | Service runtime |
| Browser/web artifact download tools | `src/service/capabilities/tools/browser-web-tools.mjs` | Service runtime |
| File mutation / execution tools | `src/service/capabilities/tools/file-mutation-execution-tools.mjs` | Service runtime |
| Document artifact helpers | `src/service/capabilities/tools/document-artifact-helpers.mjs` | Service runtime |
| Document render tools | `src/service/capabilities/tools/document-render-tools.mjs` | Service runtime |
| Artifact path helper | `src/service/core/artifact-path-helper.mjs` | Service runtime (Phase 2E.1) |

## Artifact-Creating Tool Surfaces

| Tool id | Role |
| --- | --- |
| `take_screenshot` | captures a PNG artifact path |
| `write_file` | writes requested file artifacts |
| `edit_file` | mutates file artifacts with reversibility support |
| `generate_document` | creates document/spreadsheet/presentation/PDF artifacts |
| `render_diagram` | creates rendered diagram artifacts |
| `render_svg` | creates SVG artifacts |
| `register_artifact` | registers an existing path as an artifact |
| `download_file` | downloads public web files into local artifact/storage surfaces |
| `account_download_file` | downloads connector files into local artifact/storage surfaces |

## Artifact Kinds In Current Surface

Primary requested/generated kinds: `pptx`, `docx`, `xlsx`, `pdf`, `html`, `image`, `svg`, `png`, `jpg`, `webp`, `txt`, `md`, `csv`, `json`, `js`, `mjs`, `py`, `ps1`.

Document outline quality kinds: `pptx`, `docx`, `xlsx`, `html`, `pdf`.

## Boundary Rules

- Artifact registration belongs in service runtime code, not renderer UI.
- Artifact ids, paths, kinds, source/action metadata, extracts, and lineage are storage/runtime contracts; do not rename fields during reorganization.
- Background extraction must stay off the Electron main process and renderer.
- Preview rendering surfaces must not become artifact source-of-truth storage.

## Artifact Boundary Call Sites (Phase 2E.0 Inventory, 2026-05-10)

### 1. Kind Inference

| File | Role |
|------|------|
| `src/service/capabilities/tools/document-artifact-helpers.mjs` | `OUTLINE_KINDS`, `KIND_EXTENSIONS`, `artifactKindFromTarget` |
| `src/service/capabilities/tools/document-render-tools.mjs` | `generate_document`, `render_diagram`, `render_svg` artifact write paths |
| `src/service/core/store/artifact-metadata.mjs` | `inferArtifactKind` |
| `src/service/core/artifact-action-contract.mjs` | `artifactRegistrationOptionsForPath` |
| `src/service/core/policy/success-contract-validator.mjs` | `artifact_kind` validation |
| `src/service/executors/agentic/planner.mjs` | `artifact_kind` usage |
| `src/service/executors/tool_using/planner-mode.mjs` | `artifact_kind` usage |
| `src/service/executors/tool_using/phase-gate.mjs` | `artifact_kind` usage |

~8 files, ~25 lines. Kind inference is spread across tools and executors.

### 2. Path Inference (heaviest category)

| File | Role |
|------|------|
| `src/service/core/artifact-path-helper.mjs` | `resolveOutputDirForTool`, `ensureOutputDir`, `resolveSandboxedTarget` |
| `src/service/core/artifact-action-contract.mjs` | Path validation |
| `src/service/store/artifact-store.mjs` | `inspectArtifactPath` |
| `src/service/core/action-tool-submission.mjs` | `persistArtifacts` |
| `src/service/core/browser-submission.mjs` | `outputDir`, `artifact_paths` |
| `src/service/core/context-submission.mjs` | `outputDir`, `artifact_paths` |
| `src/service/executors/tool_using/agent-loop.mjs` | `artifact_paths` extraction |
| `src/service/executors/agentic/planner.mjs` | `outputDir`, `artifactPaths` |
| `src/service/core/http-routes/task-routes.mjs` | `artifactPathFromValue` |
| `src/service/core/policy/success-contract-validator.mjs` | `artifactPathsFromEntry`, `artifactPathMatchesKind` |
| `src/service/core/task-runtime/conversation-lifecycle.mjs` | `isPrimaryArtifactPath` |
| `src/service/executors/kimi/output-format.mjs` | `outputDir` |

~25 files, 200+ lines. Heaviest category; paths are inferred in multiple layers.

### 3. Registration

| File | Role |
|------|------|
| `src/service/store/artifact-store.mjs` | `registerArtifact` |
| `src/service/capabilities/tools/file-content-tools.mjs` | `REGISTER_ARTIFACT_TOOL` |
| `src/service/core/action-tool-submission.mjs` | `persistArtifacts` caller |
| `src/service/core/browser-submission.mjs` | 4x `registerArtifact` calls |
| `src/service/core/context-submission.mjs` | 2x `registerArtifact` calls |
| `src/service/core/file-submission.mjs` | 1x call |
| `src/service/core/image-submission.mjs` | 1x call |
| `src/service/core/task-spec.mjs` | Registration reference |

~16 files, ~30 lines. Registration is spread across submission pipeline.

### 4. Preview / Open / Reveal

| File | Role |
|------|------|
| `src/service/capabilities/tools/os-app-tools.mjs` | `REVEAL_IN_EXPLORER_TOOL` |
| `src/service/executors/tool_using/tool-surface.mjs` | `DIRECT_FILE_OPEN_TOOL_IDS` |

~5 files, ~8 lines. Lightest category; mostly tool-surface gating.

### 5. Lineage ✅ Well-factored

Dedicated service: `src/service/core/artifact-lineage/artifact-lineage-service.mjs`
Used by: `runtime-services.mjs` (wiring), `sqlite-schema.mjs` (storage), `artifact-transform-service.mjs` (transform lineage).

### 6. Transform ✅ Well-factored

Dedicated service: `src/service/core/artifact-transforms/artifact-transform-service.mjs`
Used by: `runtime-services.mjs` (wiring).

### 7. Fallback

| File | Role |
|------|------|
| `src/service/core/artifact-fallback-policy.mjs` | Dedicated policy module |
| `src/service/core/browser-submission.mjs` | Import only |
| `src/service/core/context-submission.mjs` | Import only |

~3 files. Fallback policy is factored but sparsely referenced.

### 8. Extract ✅ Well-factored

Dedicated service: `src/service/core/artifact-extracts/artifact-extract-service.mjs`
Background lane: `src/service/core/artifact-extracts/artifact-extract-background-lane.mjs`
Worker: `src/service/workers/artifact-extract-worker.mjs`

### Phase 2E Consolidation Priorities

1. **Path inference** ✅ Phase 2E.1 — consolidated into `src/service/core/artifact-path-helper.mjs`.
2. **Registration** ✅ Phase 2E.2 — call sites verified and invariants locked:
   - `artifact-store.mjs` `registerArtifact` returns `artifact_id` + `task_id` fields
   - `artifact-action-contract.mjs` `artifactRegistrationOptionsForPath` for metadata-aware registration
   - 4 submission files (`browser`, `context`, `file`, `image`) must call `registerArtifact` + `appendArtifact`
   - Broker/facade consolidation deferred — call sites are heterogeneous (different metadata sources, event handling)
3. **Kind inference** — `artifactKindFromTarget` now lives in `src/service/capabilities/tools/document-artifact-helpers.mjs`; generate/render tool writes now live in `src/service/capabilities/tools/document-render-tools.mjs`.
4. **Lineage, Transform, Extract** — already well-factored with dedicated services; no immediate consolidation needed.
5. **Preview/Open/Reveal** — already thin; no immediate consolidation needed.
6. **Fallback** — dedicated module exists but is sparsely referenced; ensure callers consistently use it.

## Verification

Run:

```powershell
node scripts/verify-artifact-surface-snapshot.mjs
```

The verifier checks documented artifact owner paths, artifact-producing tool ids, current artifact kinds, document-outline quality kinds, and Phase 2E.0 call-site inventory sections.
