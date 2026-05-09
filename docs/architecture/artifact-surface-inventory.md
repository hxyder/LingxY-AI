# Artifact Surface Inventory

Phase 2A boundary inventory for artifact creation, registration, extraction, lineage, preview, and quality gates.

Status: verified against the current repository on 2026-05-09.

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
| File reversibility helpers | `src/service/action_tools/file-reversibility.mjs` | Service runtime |

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
| `account_download_file` | downloads connector files into local artifact/storage surfaces |

## Artifact Kinds In Current Surface

Primary requested/generated kinds: `pptx`, `docx`, `xlsx`, `pdf`, `html`, `svg`, `png`, `txt`, `md`, `csv`, `json`.

Document outline quality kinds: `pptx`, `docx`, `xlsx`, `html`, `pdf`.

## Boundary Rules

- Artifact registration belongs in service runtime code, not renderer UI.
- Artifact ids, paths, kinds, source/action metadata, extracts, and lineage are storage/runtime contracts; do not rename fields during reorganization.
- Background extraction must stay off the Electron main process and renderer.
- Preview rendering surfaces must not become artifact source-of-truth storage.

## Verification

Run:

```powershell
node scripts/verify-artifact-surface-snapshot.mjs
```

The verifier checks documented artifact owner paths, artifact-producing tool ids, current artifact kinds, and document-outline quality kinds.
