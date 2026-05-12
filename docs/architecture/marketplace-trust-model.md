# Marketplace Trust Model

Date: 2026-05-12

PM-001 defines a shared trust preview for skills, connector plugins, and MCP
servers. The model is service-owned and does not enable any new external
marketplace by default.

## Owner

`src/service/capabilities/marketplace/trust-model.mjs`

## States

Every marketplace-like entry can carry these stable flags:

- `trusted`: built-in code shipped with the app.
- `local_only`: local runtime config, editable local skills, or local-only data.
- `third_party`: GitHub-installed skills, installed connector plugins, external
  marketplace entries, or MCP entries supplied by plugins.
- `unsigned`: third-party entry without verified signature metadata.
- `disabled`: entry exists but is not active.
- `deleted`: recoverable deleted/archive state.

The flags are composable. For example, a GitHub skill is both `third_party` and
`local_only`, and a disabled plugin MCP server is `third_party`, `unsigned`, and
`disabled`.

## Surfaces

- Skill registry list/status entries expose `trustPreview`.
- GitHub skill staging exposes `trustPreview` before install confirmation.
- Skill install action metadata surfaces `trust_preview`.
- MCP server status entries expose `trustPreview`.
- Plugin registry entries expose `trustPreview`.
- Plugin registry exposes `previewInstall()` so install UI can show trust
  information before copying plugin files.

## Invariants

- Trust preview is additive metadata; it must not change install, enable, route,
  tool id, provider id, storage schema, IPC channel, or HTTP route behavior.
- Third-party unsigned entries require user review in the preview model.
- Disabled and deleted entries stay visible as state, not as active capability.
- Future signing work must populate signature verification fields instead of
  inventing a second trust vocabulary.

## Verification

```powershell
node scripts/verify-marketplace-trust-model.mjs
node --test tests/behavior/marketplace-trust-model.test.mjs
```
