# Changelog

All notable changes to LingxY are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project tracks [Semantic Versioning](https://semver.org/) where it
applies.

## [Unreleased]

### Added
- **Auto-update**: electron-updater wired to GitHub Releases
  (`lingxy-ai/lingxy-desktop` channel). Four-tier user strategy
  (`off / manual / notify / auto`) with first-run consent shown via
  the brand popup card. Strategy persists in runtime config; IPC
  channels exposed for a future Settings UI.
- **Image-based brand mark**: every consumer point (SVG / wordmark /
  console rail / icons.mjs / Electron taskbar / Windows tray /
  notification fallback / dialog header) now renders the canonical
  `assets/icons/lingxy-*.png`. AppUserModelID set to `com.uca.desktop`
  so the Windows taskbar groups under LingxY rather than inheriting
  Electron's default.
- **Route verifier (shadow)**: structured `router_judge` LLM audits
  the Semantic Router's policy decisions in shadow mode. Replaces the
  topic-regex `stable-qa-override` with an evidence-axis algebra
  (`evidence-axes.mjs`), schema-bound judge contract, directional
  hard-signal veto, dual-track shadow telemetry, and a mechanical
  readiness gate (`scripts/verify-route-verifier-readiness.mjs`).
  Stays in shadow until labelled corpus precision lands; enforce flip
  is gated by a deliberate config flag, not env-var alone.
- **Cross-run regression diff**: `scripts/real-llm-test/diff-runs.mjs`
  compares two corpus reports and surfaces new regressions / new
  passes / reason changes / latency drift / corpus drift. Exit code
  1 on new regressions, 0 otherwise.
- **Brand verifier**: `scripts/verify-brand-assets.mjs` enforces
  image-based mark + native icon domain invariants (PNG sizes
  present, AUMID drift, raw `BrowserWindow`/`Notification`/`dialog.
  showMessageBox` constructors must go through brand wrappers).

### Changed
- **EvidencePolicy normalization**: `evidence-policy.mjs` derives
  `needs_external_info` from the three normalized fields
  (`web_policy`, `source_mode`, `needs_current_information`) instead
  of trusting the raw value. Prevents a stale `false` from SR or
  verifier-corrected decisions from short-circuiting downstream
  policy. Shared algebra lives in `intent/evidence-axes.mjs`.
- **`DESKTOP_SHELL_MANIFEST.appId` → `runtimeNamespace`**: the
  manifest's logical namespace was renamed to disambiguate it from
  the Windows AppUserModelID (`com.uca.desktop`, lives in
  `package.json` build.appId / `BRAND_AUMID`).
- **Release workflow**: `.github/workflows/release-artifacts.yml`
  publish job now gated on `github.repository == 'lingxy-ai/lingxy-
  desktop'` so forks cannot pollute the canonical update feed; the
  job also enforces `latest.yml` is present in dist (electron-updater
  metadata).

### Documentation
- README rewritten as product-tier; `LICENSE` (MIT) + `THIRD_PARTY_
  LICENSES.md` + `SECURITY.md` + `CONTRIBUTING.md` + `CODE_OF_CONDUCT.md`
  + `.github/ISSUE_TEMPLATE/*` + `.github/PULL_REQUEST_TEMPLATE.md`
  added in earlier rounds; this entry consolidates the public-readiness
  surface.

### Known limitations
- **Windows code signing** is not yet wired (`CSC_IDENTITY_AUTO_DISCOVERY=false`
  in the release workflow). First-run users will see a SmartScreen
  warning; auto-updater will reject unsigned binaries on Windows
  until signing lands. Tracked as a separate batch-B work item.
- **`UCA` legacy namespace** is still used for the data directory
  (`%APPDATA%\UCA`), Windows AppUserModelID (`com.uca.desktop`),
  Chrome native messaging host name (`com.uca.host`), and the
  `uca-cli` / `uca-native-host` package directories. Renaming to
  the LingxY namespace requires a coordinated installer / native
  messaging / Office Add-in / data-dir migration; that work is
  filed as a follow-up issue and intentionally NOT performed in
  this branch.
- **Trial channel** scripts (`scripts/*trial*` and
  `tools/release/release-config.json`) remain runnable for
  sideload distribution. v1.0 release uses `electron-updater`
  via `package.json build.publish`; the trial channel is
  legacy and will be archived once `lingxy-ai/lingxy-desktop`
  Releases is the canonical path.

---

[Unreleased]: https://github.com/lingxy-ai/lingxy-desktop
