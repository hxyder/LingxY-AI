# LingxY AI Desktop

[简体中文](README.zh-CN.md)

LingxY is a local-first AI desktop workspace for Windows. It can understand the window you are working in, run tool-backed tasks, generate documents, manage schedules, and draft side effects for your approval. Your data stays local by default; model and connector calls go directly from your machine to the providers you configure.

## Highlights

- Local desktop entry points: overlay, dock, console, popup cards, and artifact preview.
- Bring your own provider: OpenAI-compatible APIs, DeepSeek, Anthropic, Kimi, Ollama, and CLI agents such as Claude Code, Codex, and Kimi CLI.
- Tool-backed work: web search, file operations, document generation, screenshots, app launching, schedules, email/calendar/drive connectors, MCP, plugins, and skills.
- Approval-first side effects: high-risk actions such as sending email or mutating connected accounts are drafted for review before execution.
- Local runtime data: tasks, conversations, artifacts, provider settings, and runtime state live under the local runtime directory.

## Repository Layout

```text
src/                 Application, runtime, desktop shell, tools, connectors
assets/              Brand and app assets
browser_ext/         Browser extension integration
office_addin/        Office add-in integration
scripts/             Runtime, packaging, setup, and public smoke scripts
tests/behavior/      Small public behavior test subset
docs/                User/runtime documentation
```

Internal verifier inventories, release evidence packs, live test reports, downloaded models, runtime databases, and local secrets are intentionally not included in this public export.

## Requirements

- Windows 10 or later
- Node.js 22.x
- npm

Optional runtime capabilities may require provider API keys, connector credentials, Python helpers, or local model engines.

## Development

```powershell
npm ci
npm run check:public
npm run start:runtime
npm run start:desktop
```

Useful commands:

```powershell
npm test
npm run smoke:runtime
npm run smoke:desktop
npm run pack
npm run dist
```

## Configuration

Configure model providers and connectors from the desktop console after starting the app. Do not commit `.env` files, local runtime data, API keys, OAuth secrets, task reports, or generated artifacts.

## GitHub Upload

This repository is prepared as a clean public source export. Create an empty GitHub repository, then add it as `origin` and push `main`.

## License

MIT. See [LICENSE](LICENSE).
