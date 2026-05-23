# LingxY AI Desktop

[简体中文](README.zh-CN.md)

LingxY AI Desktop is a local-first AI workspace for Windows. It gives you a desktop overlay, dock, console, browser extension, Office add-ins, file tools, schedules, and connector workflows around the model providers you configure.

The goal is simple: keep the user in control while letting AI work with real desktop context. LingxY can read selected windows, files, screenshots, browser pages, Office documents, and conversation history, then run tool-backed tasks such as research, summarization, document drafting, file analysis, reminders, and connector actions.

## What You Can Do

- Ask from anywhere with the desktop overlay, floating dock, or console.
- Use the active window, selected text, browser page, screenshot, file, or folder as task context.
- Summarize, translate, explain, rewrite, compare, and extract structured information.
- Generate Markdown, Word, Excel, PowerPoint, diagrams, and other task artifacts.
- Preview generated files and supported local files inside the desktop app.
- Search and read local files, folders, PDFs, Office documents, images, and indexed file content.
- Create schedules and reminders using natural language.
- Draft email/calendar/drive actions through connected accounts, with approval before high-risk writes.
- Use MCP servers, browser tools, file tools, app launching, skills, and plugin-style capabilities.
- Route work across provider APIs, local models, and CLI agents.
- Keep runtime data local by default.

## Main Surfaces

### Desktop Overlay

The overlay is the quick command surface. Open it while working in another app, type what you need, and LingxY can include the current window or selected context. It is designed for fast, contextual tasks such as "summarize this page", "explain this error", "turn this screenshot into notes", or "draft a reply".

### Dock

The dock is a small always-available entry point. It can open the overlay, receive dropped files, show lightweight task state, and provide a low-friction way to start work without switching to the full console.

### Console

The console is the main workspace. Use it to manage conversations, tasks, files, schedules, connectors, notes, providers, approvals, and runtime settings. It also includes language switching for English and Chinese UI modes.

### Browser Extension

The browser extension lets LingxY work with page context, selected text, and browser-side actions. Use it when a task depends on the current webpage, article, or browser session.

### Office Add-ins

The Office add-ins provide Word, Excel, and PowerPoint entry points so documents and spreadsheets can be used as task context and generated outputs can flow back into Office workflows.

## Provider And Model Support

LingxY is bring-your-own-provider. Configure the providers you want from the desktop console.

Supported provider families and runtimes include:

- OpenAI-compatible APIs
- DeepSeek
- Anthropic
- Kimi
- Ollama and local endpoints
- CLI agents such as Claude Code, Codex, and Kimi CLI

Availability depends on the keys, local tools, and endpoints you configure on your machine.

## Safety Model

LingxY is designed around explicit user control.

- Local-first runtime data: tasks, conversations, artifacts, provider settings, and runtime state live on your machine.
- Approval-first side effects: high-risk actions such as sending email, creating calendar events, uploading files, or mutating connected accounts are drafted for review before execution.
- Secret hygiene: do not commit `.env`, provider keys, OAuth credentials, runtime databases, logs, task reports, or generated artifacts.
- Public export: internal verifier inventories, release evidence packs, live API reports, downloaded models, and local runtime data are intentionally excluded from this repository.

## Requirements

- Windows 10 or later
- Node.js `>=22.12.0 <23`
- npm
- Git

Optional features may require:

- Provider API keys or local model endpoints
- Python helpers for local speech/OCR workflows
- Browser extension installation
- Office add-in sideloading
- OAuth credentials for account connectors
- MCP server configuration

## Quick Start

Clone the repository:

```powershell
git clone https://github.com/hxyder/LingxY-AI.git
cd LingxY-AI
```

Install dependencies:

```powershell
npm ci
```

Run the public checks:

```powershell
npm run check:public
```

Start the local runtime:

```powershell
npm run start:runtime
```

In another PowerShell window, start the desktop app:

```powershell
npm run start:desktop
```

After the desktop app opens, configure at least one model provider in the console settings.

## First-Time Setup

1. Start the runtime and desktop app.
2. Open the LingxY console.
3. Go to Settings.
4. Add a model provider or local model endpoint.
5. Choose routing defaults for chat and tool-backed tasks.
6. Optional: install the browser extension from `browser_ext/`.
7. Optional: sideload Office add-ins from `office_addin/`.
8. Optional: configure MCP servers and account connectors.
9. Use the overlay, dock, or console to start a task.

## Common Workflows

### Ask About The Current Window

Open the overlay while another app or browser tab is active, then ask a question such as:

```text
Summarize the current page and list the key action items.
```

LingxY will use available context from the active window, browser extension, screenshot helpers, or selected text depending on what is enabled.

### Work With Files And Folders

Drop a file onto the dock or add files in the console, then ask:

```text
Compare these documents and create a short decision brief.
```

Supported workflows include file reading, folder traversal, document rendering, artifact generation, and preview.

### Generate A Document

Ask for a deliverable:

```text
Create a one-page project status report as a Word document.
```

Generated artifacts appear in the task output and can be previewed from the console.

### Schedule A Reminder

Use natural language:

```text
Remind me every weekday at 9 AM to review my task list.
```

Schedules can be reviewed and managed from the console.

### Use Connectors

After configuring accounts, ask LingxY to draft connector-backed actions:

```text
Draft an email summary of this report for my team.
```

Write actions are approval-first. Review the draft before execution.

## Useful Commands

```powershell
npm test
npm run check:public
npm run smoke:runtime
npm run smoke:desktop
npm run smoke:ui-i18n
npm run start:runtime
npm run start:desktop
npm run pack
npm run dist
```

Command details:

- `npm test`: runs the public behavior test subset.
- `npm run check:public`: runs public repository hygiene, behavior tests, UI i18n smoke, desktop entrypoint smoke, and runtime health smoke.
- `npm run smoke:runtime`: starts a test runtime and checks `/health`.
- `npm run smoke:desktop`: verifies desktop entrypoints and manifest contracts.
- `npm run smoke:ui-i18n`: checks that the public UI locale wiring is present.
- `npm run pack`: creates an unpacked Electron build.
- `npm run dist`: creates installer artifacts.

## Repository Layout

```text
src/                 Application runtime, desktop shell, tools, connectors
assets/              Brand and application assets
browser_ext/         Browser extension integration
office_addin/        Word, Excel, and PowerPoint add-ins
uca-cli/             CLI entry points
uca-native-host/     Native messaging host
scripts/             Runtime, setup, packaging, and public smoke scripts
tests/behavior/      Small public behavior test subset
docs/                Runtime, privacy, browser, scheduler, and protocol docs
tools/               Release helper metadata
external/            Placeholders for optional local runtimes and models
```

## Configuration Notes

- Configure model providers and connectors from the desktop console.
- Keep secrets outside Git. Use local environment variables, OS credential stores, or console-managed local config.
- Local runtime data is not meant to be committed.
- Downloaded model engines and OCR/speech runtimes belong under ignored local paths.
- Public CI uses the lightweight public check surface, not the internal verifier corpus.

## Browser Extension

The browser extension source is in `browser_ext/`. Load it as an unpacked extension in a Chromium-based browser during development. The extension helps capture page context, selections, and browser-side state for LingxY tasks.

See [browser_ext/README.md](browser_ext/README.md).

## Office Add-ins

Office manifests and shared task pane code live in `office_addin/`. Sideload the relevant manifest for Word, Excel, or PowerPoint when you want Office documents to participate in LingxY workflows.

See [office_addin/README.md](office_addin/README.md).

## MCP, Skills, And Tools

LingxY can expose and call tool surfaces through MCP servers, built-in tools, connector tools, and skill-style workflows. Configure MCP servers and available capabilities from the console.

## Development Notes

This repository is a clean public source export. It keeps the application code and a small public test surface while excluding internal release evidence, live API reports, large verifier inventories, runtime databases, local models, and private configuration.

If you contribute changes, keep them scoped and add focused tests or smoke checks for user-facing behavior.

## Troubleshooting

- If `npm ci` warns about Node engine mismatch, install Node `22.12.x` or a later Node 22 release below 23.
- If `smoke:runtime` says the test port is already in use, stop any LingxY runtime using that port and rerun.
- If the desktop app opens but cannot answer, configure a model provider first.
- If browser context is missing, confirm the extension is installed and allowed on the current site.
- If Office integration is missing, confirm the add-in manifest is sideloaded and the local runtime is running.

## License

MIT. See [LICENSE](LICENSE).
