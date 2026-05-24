# Browser Extension

MV3 extension scaffold for Chrome / Edge browser capture.

Structure:

- `manifest.json` for permission and asset wiring
- `background/service-worker.js` for menus and native messaging
- `content_script/selection-cache.js` for selection capture
- `shadow_ui/floating-chip.js` for browser-only floating action entry
- `popup/` for recent task entry points

## Page / Video Action Hub

The side panel exposes the current page/video as one capture surface with a
small action selector:

- `综合分析`: broad overview, key points, and follow-up questions.
- `解释脉络`: background, reasoning, conclusion, and uncertainty.
- `提炼要点`: concise claims, evidence, and takeaways.
- `翻译中文`: Chinese translation that preserves names, numbers, links, and
  headings.
- `行动清单`: facts, unknowns, next steps, risks, and follow-up questions.

`Ctrl+Shift+E` uses the same page/video explanation contract. When the desktop
runtime is available, the extension prefers the desktop `/page/explain` handoff
so the Overlay and task runtime receive structured browser context. If the
desktop runtime is unavailable, the request remains queued for the side panel
and can use standalone browser mode when configured.

## Runtime Modes

- Desktop mode: preferred. The extension sends browser context to the local
  LingxY desktop runtime, so tasks can use local tools, approvals, files,
  scheduler, artifacts, and conversation/project storage.
- Standalone mode: fallback. When the desktop runtime is not reachable and the
  user configured a provider API key in extension options, popup/sidepanel and
  inline selection actions call the LLM directly from the extension. This mode
  is intentionally browser-context only; it must not promise local tools,
  file/RAG access, approvals, scheduler actions, or generated artifacts.
