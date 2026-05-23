# Window Content Capture Strategy

Owner: desktop overlay renderer, shell active-window bridge, browser context route, and downstream file/content extractors.

The current-context commands should prefer readable structured context before using pixels. A screenshot is a final fallback for windows that do not expose text, a file path, or a browser snapshot.

## Capture Order

1. User-provided attachments, selected files, or seeded captures.
2. Browser extension text snapshots matched by exact URL, title, or a bounded fresh text fallback.
3. Active-window file identity, including Explorer selections, Office/local document paths, browser `file://` URLs, and editor title/path signals.
4. App-specific readable content bridges, such as Office add-ins or future terminal/editor accessibility adapters.
5. Bounded active-window screenshot, only when the request explicitly targets the current window/page and no readable source is available.

## Window Types

| Window type | Preferred source | Fallback source |
| --- | --- | --- |
| Browser article or web app | Extension DOM snapshot through `/browser/context`; exact URL/title first, recent text only inside the explicit current-page time window. | Bounded window screenshot. |
| Browser PDF | Extension text if the viewer exposes it; browser `file://` path when local. | PDF/file extractor if the path is known, then screenshot. |
| Office document | Office add-in context or saved local file path. | File extractor, then screenshot. |
| Explorer/File picker | Shell-selected file paths. | Active folder/window identity only for follow-up selection prompts. |
| IDE/editor | Active file path from title/command line when available. | Selected text bridge or screenshot. |
| Terminal/console | Selected text or future accessibility/terminal bridge. | Screenshot. |
| Generic desktop app | App-specific bridge, selected text, or accessibility text when available. | Screenshot. |
| Protected, minimized, or elevated windows | No readable capture is guaranteed. | Screenshot may be blocked; surface a clear unavailable message. |

## Guardrails

- Do not put heavy extraction in Electron main or renderer. The renderer decides source priority; the service or a sidecar does parsing/extraction.
- Treat browser snapshots, file paths, text, screenshots, and metadata as typed runtime context.
- Keep recent-browser fallback bounded by age and text length so stale tabs do not replace the current page.
- Do not silently use a screenshot when a fresh readable browser snapshot exists.
- Keep screenshot payloads marked as image context so multimodal execution is explicit and visible in task metadata.
