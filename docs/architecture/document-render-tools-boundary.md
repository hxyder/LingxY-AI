# Document Render Tools Boundary

CAP-5G high-risk artifact tool migration. Status: 2026-05-11, moved to
`src/service/capabilities/tools/document-render-tools.mjs` after contract and
runtime verification.

## Current State

- File: `src/service/capabilities/tools/document-render-tools.mjs`
- Aggregator: `src/service/action_tools/tools/index.mjs`
- Tool ids: `generate_document`, `render_diagram`, `render_svg`
- Shared helpers:
  - `src/service/capabilities/tools/document-artifact-helpers.mjs`
  - `src/service/capabilities/tools/document-renderer.mjs`
  - `src/service/capabilities/tools/mermaid-assets.mjs`
  - `src/service/capabilities/tools/svg-sanitize.mjs`
  - `src/service/core/artifact-path-helper.mjs`

## Public Contract

- Tool ids, schema names, registry order, risk level, confirmation behavior,
  required capabilities, artifact paths, MIME metadata, `preview_html_path`,
  PDF fallback metadata, and file reversibility metadata must stay stable.
- `render_diagram` must continue using the local Mermaid asset helper and must
  retain its fallback HTML behavior.
- `render_svg` must sanitize standalone SVG artifacts before writing.
- `generate_document` must continue writing preview sidecars and checkpointing
  primary and sidecar artifacts before overwrite.

## No-Touch Areas

- Do not change IPC channels, HTTP routes, provider ids, tool ids, artifact
  kinds, storage schema, approval behavior, or desktop UI behavior in this
  phase.
- Do not move `draft_capability` or `save_capability_draft` as part of this
  boundary.
- Do not add compatibility barrels or parallel old/new document-render tool
  implementations.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Generated artifacts lose preview metadata | High | Contract verifier locks `preview_html_path` and runtime HTML generation |
| PDF fallback metadata changes | High | Contract verifier locks `needs_pdf_conversion` text and runtime contract |
| Diagram output loads remote Mermaid | High | Runtime verifier checks generated HTML for CDN URLs |
| SVG output writes active content | High | Runtime verifier executes `render_svg` and inspects sanitized output |
| Old owner text remains reachable | Medium | Registry, roots, and document-render verifier reject inline tool bodies in `index.mjs` |

## Decision

Moved from inline ownership in `src/service/action_tools/tools/index.mjs` to
`src/service/capabilities/tools/document-render-tools.mjs`. The aggregator keeps
named re-exports for current import compatibility, but all implementation owner
text now lives in the capability module.
