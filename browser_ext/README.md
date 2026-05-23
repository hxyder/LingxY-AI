# Browser Extension

MV3 extension scaffold for Chrome / Edge browser capture.

Structure:

- `manifest.json` for permission and asset wiring
- `background/service-worker.js` for menus and native messaging
- `content_script/selection-cache.js` for selection capture
- `shadow_ui/floating-chip.js` for browser-only floating action entry
- `popup/` for recent task entry points

Install:

- From the desktop app, use `Console -> Settings -> One-click Setup -> Browser
  Extension -> Configure`.
- The extension ID is stable for unpacked installs:
  `oegpgmnonnejpkgpjmpnbnjlpfmkojkf`.
- Chrome and Edge still require the user to load or approve the revealed
  `browser_ext/` folder from the browser extensions page.

## Runtime Modes

- Desktop mode: preferred. The extension sends browser context to the local
  LingxY desktop runtime, so tasks can use local tools, approvals, files,
  scheduler, artifacts, and conversation/project storage.
- Standalone mode: fallback. When the desktop runtime is not reachable and the
  user configured a provider API key in extension options, popup/sidepanel and
  inline selection actions call the LLM directly from the extension. This mode
  is intentionally browser-context only; it must not promise local tools,
  file/RAG access, approvals, scheduler actions, or generated artifacts.
