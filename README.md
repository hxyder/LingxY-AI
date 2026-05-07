# LingxY AI Desktop

> A local-first AI workspace for Windows. Reads what's on your screen, calls tools, generates documents, runs schedules, drafts side effects you can approve. Powered by your own model providers and credentials — nothing routes through a LingxY-hosted server.

LingxY AI is a Windows desktop AI workspace that understands the window you are working in, picks tools, and completes tasks through model providers you bring yourself. The packaged app is named **LingxY**.

It is not just another chat box. The goal is an everyday-knowledge-work assistant: reading pages and files, generating documents, launching apps, creating scheduled jobs, drafting emails for approval, and keeping a searchable local task history.

## Why LingxY

- **Local-first data**: prompts, captured context, conversation history, artifacts, and credentials live under `%APPDATA%\UCA\` on your machine. Model calls and connector calls go from your machine straight to the provider you configured.
- **Bring your own provider**: Anthropic, OpenAI / OpenAI-compatible, DeepSeek, Kimi, xAI, Mistral, Ollama for local models, and code/agent CLIs (Claude Code, Codex, Kimi).
- **Tools, not just chat**: web search + page fetch, file read/write/glob, document generation (DOCX / XLSX / PPTX / HTML / Mermaid), screenshots, clipboard, app launcher, scheduler, email/calendar/drive connectors, and MCP-server / plugin / Skill extension paths.
- **Side effects ask first**: sending email, mutating connected accounts, installing MCP packages, or running approved local scripts run through approval cards. AI drafts; you confirm.
- **Approachable extension**: Skills are plain `SKILL.md` folders. MCP servers can install from a sandboxed path with manifest detection and verifier coverage.

The project is in active pre-1.0 development. It is usable for local development and trials. The remaining release work focuses on signed packaging, automatic updates, OS keychain-backed secrets, import/zip export polish, and a full Trash management view.

## Feature Overview

LingxY is built around concrete desktop jobs, not only chat. This section is intentionally specific so you can tell what is already implemented and where the boundaries are.

### Desktop Entry Points

**Overlay**

- Opens above the current app, so you can ask about the thing you are already viewing.
- Sends text commands, attachments, selected text, screenshots, browser context, and active-window metadata into the task runtime.
- Supports fast commands such as "open Excel", research commands such as "analyze this page", and artifact commands such as "make this into a PPT".
- Keeps running tasks visible without forcing you into the full console.

**Dock**

- Sits at the screen edge as the lightweight home for LingxY.
- Opens the overlay, shows running task state, and can surface clipboard/task hints.
- Integrates with the voice path when wake-word or transcription features are enabled locally.

**Console**

- Full management window for tasks, conversations, artifacts, schedules, notes, providers, connectors, MCP servers, plugins, skills, privacy controls, and audit/debug views.
- Lets you inspect task timelines, tool calls, generated files, failures, approvals, and schedule runs.
- Includes provider/model settings so you can switch between cloud providers, compatible APIs, local Ollama, and CLI-based agents.

**Popup Cards**

- Non-blocking desktop cards for completions, approvals, schedule fires, connector decisions, and warnings.
- High-risk actions such as sending email, mutating connected accounts, installing MCP packages, or running local commands can stop here until you approve.
- Cards are designed for "AI drafts, user confirms" workflows.

**Preview Window**

- Anchored preview for generated documents and reports.
- Shows progress and output for document generation paths instead of hiding everything until the task ends.
- Supports artifacts such as HTML reports, generated Office documents, screenshots, and extracted files.

### Context Understanding

LingxY can combine several local context sources:

- Browser page URL/title from the browser extension or active-window probe.
- File paths from Explorer, Office add-ins, drag/drop, or explicit attachments.
- Selected text and clipboard content.
- Screenshots and image attachments.
- Prior conversation/task context when you continue an existing task.
- Schedule context when a background job fires.

The runtime keeps provenance separate from intent. For example, an attached resume does not automatically mean "only use local files"; if the user explicitly asks to search current jobs, the policy layer can allow web search while still treating the resume as local input.

### Model Providers And Routing

Supported provider families include:

- Anthropic Claude.
- OpenAI and OpenAI-compatible APIs.
- DeepSeek.
- Kimi/Moonshot.
- xAI.
- Mistral.
- Ollama for local models.
- Code/agent CLIs such as Claude Code CLI, Codex CLI, and Kimi CLI.

Provider settings support:

- Base URL, API key, model, reasoning options, and provider health checks.
- Per-task routing through executor selection.
- Fast lightweight responses for simple turns.
- Tool-using execution for tasks that need tools, search, files, or connectors.
- Multimodal/image-capable paths for screenshot or image tasks.
- CLI-backed execution when a local coding agent should handle the job.

Important: this repo does not proxy your model calls through a LingxY server. Your machine calls the provider or CLI you configure.

### Tool-Using Tasks

The agent can call tools during a task instead of merely describing what you should do. Built-in tool families include:

- Web/search: search the web, fetch pages, extract readable content, and gather evidence.
- Files: read files, write files, list folders, glob paths, find recent files, open files, and reveal files in Explorer.
- Documents: generate DOCX, XLSX, PPTX, PDF/HTML reports, and Mermaid diagrams.
- Screenshots/images: capture screenshots, pass images to vision-capable models, and extract image context.
- Clipboard: read and write clipboard content.
- Apps/system: launch apps, open URLs, and run approved local scripts.
- Notifications: send desktop notifications and popup cards.
- Scheduling: create, list, run, pause, resume, and delete schedules.
- Connectors: execute email/calendar/file workflows through configured account connectors.
- MCP/plugin tools: expose tools from installed MCP servers and plugins.

Every task records the important steps: planner decisions, proposed tool calls, tool results, failures, generated artifact paths, and final output. Console uses that record to explain what happened after the fact.

### Documents And Artifacts

LingxY can produce actual files, not only Markdown answers:

- PPTX: slide decks with structured sections, tables, and generated layout.
- DOCX: reports, summaries, drafts, meeting notes, and formatted documents.
- XLSX: extracted tables, comparisons, invoice summaries, and structured data.
- PDF/HTML: printable reports through browser rendering when available.
- Mermaid diagrams: flowcharts, sequence diagrams, and architecture diagrams embedded in generated HTML reports.
- Screenshot/image artifacts: captured images and derived files saved into task output folders.

Artifacts are stored locally and surfaced in Console/Preview. The system avoids pretending a file exists: if generation fails, the task reports the fallback or failure path instead of inventing a fake artifact.

### Email, Calendar, And Drive Workflows

Connector workflows are built for reviewable side effects:

- Local IMAP/SMTP accounts can read mail and send approved drafts.
- Google Workspace can connect Gmail, Calendar, and Drive-style workflows.
- Microsoft 365 can connect Outlook, Calendar, and OneDrive-style workflows.
- Email sending follows a draft/confirmation model where possible.
- Approval cards can let the user review recipients, subject, body, and workflow details before execution.
- Schedules can run email/calendar workflows later, while preserving side-effect authorization rules.

The target model is "AI prepares the work; the user approves risky effects."

### Scheduling And Automation

The scheduler supports several trigger types:

- `cron`: recurring schedules such as every day at 9:00 or every Friday afternoon.
- `at`: one-shot absolute time schedules such as tomorrow at 15:00.
- `interval`: repeated every-N-seconds/minutes/hours; also supports UI-created one-shot reminders.
- `file_watch`: run when a watched folder/path changes.
- `clipboard_watch`: poll clipboard changes for automation flows.

Scheduler behavior includes:

- Natural-language schedule creation.
- Timezone-aware cron handling.
- Misfire recovery when the app starts after a scheduled time.
- `catchup_policy` options for missed recurring runs.
- Run history and last task linkage.
- Manual Run Now for paused or completed schedules without silently re-enabling automatic firing.
- Approval gates for high-risk scheduled actions.

Example:

```text
Every weekday at 9:00, summarize important email from the last 24 hours and show me a popup.
```

This becomes a recurring schedule. A one-shot command such as "tomorrow at 3 PM remind me to prepare slides" becomes a completed one-shot after it fires.

### Notes, Conversations, And History

LingxY stores local task and conversation history so work can continue across turns:

- Tasks keep status, sub-status, timeline events, artifacts, and final results.
- Conversations link user turns, assistant outcomes, and task outputs.
- Notes can be created and browsed in the desktop console.
- Local search can find prior tasks and notes; semantic search can be enabled when embeddings are configured.
- Follow-up routing can attach a short "continue this" request to the right prior task/conversation.

This is meant to support ordinary workflows such as "where was that report from yesterday?" or "continue the previous analysis and export it as Excel."

### Browser And Office Integration

Browser integration:

- Captures current page URL/title and selected page context.
- Supports page analysis and handoff into desktop tasks.
- Helps the agent fetch or summarize the page you are viewing.

Office integration:

- Office add-in paths can provide selected content or document context to the desktop runtime.
- Generated Word/Excel/PowerPoint artifacts can be previewed and opened locally.
- Office workflows remain local-first; connector/cloud calls only happen when configured.

### MCP, Plugins, And Skills

LingxY has three extension paths:

- MCP servers: expose external toolsets such as filesystem, memory, search, browser automation, Figma, or other MCP-compatible packages.
- Plugins: package skills/tools/apps into a local plugin registry.
- Skills: plain `SKILL.md` instructions for repeatable workflows.

MCP install has a sandboxed install path, manifest detection, actor guards, and verifier coverage so package installs do not become an unreviewed local mutation surface.

### Voice And Transcription

Voice-related features are local-first where possible:

- Wake-word enrollment and detection for the dock/overlay path.
- Audio note transcription.
- Whisper/local sidecar support where configured.
- Cloud speech paths only when a compatible provider is configured.

Voice features can depend on local model files and OS audio permissions, so they are treated as optional rather than required for core use.

### Privacy And Safety Controls

Safety features include:

- Desktop actor boundaries for local HTTP mutation routes.
- Side-effect policy groups and approval requirements.
- Audit logs for important tool and schedule actions.
- Privacy redaction rules for sensitive fields.
- Presenter mode for demos or screen sharing.
- Offline mode and global kill switch controls.
- Explicit no-search/local-only constraints.
- Behavior tests and verifier scripts for routing, submission boundaries, external calls, scheduler behavior, and local HTTP surfaces.

Provider API keys are now removed from `runtime.json` and stored behind local `apiKeyRef` entries. OS credential-store/keychain backing is still a v1.0 hardening item.

## How It Works

LingxY has two local parts:

- Desktop shell: Electron tray, dock, overlay, console, popup cards, preview windows, active-window probe, and native Windows integrations.
- Local service: HTTP/SSE runtime, task queue, executors, action tools, connectors, scheduler, storage, and policy/security layers.

Your prompts and captured context stay local until a task needs a model provider or an external connector. When that happens, requests go directly from your machine to the provider or service you configured with your own credentials. There is no LingxY-hosted account service in this repo.

## Current Status

Stable enough for local trials:

- `npm run check` runs the full verifier suite.
- `npm run pack` builds a local unpacked Windows desktop package.
- Core task execution, document generation, scheduler, connector workflows, MCP/plugin registry, and desktop renderer verification are covered by scripts and behavior tests.
- Third-party license inventory is generated in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md), with the previous `buffers@0.1.1` unknown-license dependency removed.
- Security reporting is documented in [SECURITY.md](SECURITY.md), and Dependabot is configured for weekly npm and GitHub Actions update PRs.

Known release gaps:

- Automatic updates are not wired to a GitHub Releases channel yet.
- Provider/API keys are stored outside `runtime.json` in the local Secret Store; OS credential-store/keychain backing is still pending.
- Console Settings can export a redacted JSON data bundle; import and packaged zip export are still pending.
- Console Settings can generate a local redacted diagnostics JSON; renderer/main errors and crash dumps stay on the user's machine, and no telemetry is sent by default.
- Task and note deletion use soft delete plus short-window Undo; a unified Trash view and schedule/template deletion lifecycle are still pending.
- `npm run dist` can require Windows symlink/signing support, depending on the machine.
- Real Kimi CLI verification may skip when local credentials are invalid or quota is exhausted.

## Requirements

- Windows 10/11 x64.
- Node.js 22.12 or newer recommended.
- PowerShell 5.1 or newer.
- Optional: Chrome or Edge for browser context and PDF rendering.
- Optional: Microsoft Office for Office add-in workflows.
- Optional: your own API keys or local model runtimes.

## Quick Start

Install dependencies:

```powershell
npm install
```

Start the local runtime service:

```powershell
npm run start:runtime
```

In another terminal, start the Electron desktop shell:

```powershell
npm run start:desktop
```

Run the verifier suite:

```powershell
npm run check
```

Build a local unpacked desktop package:

```powershell
npm run pack
```

On Windows, local packaging rebuilds native modules such as `better-sqlite3`
against Electron's Node ABI. Install Visual Studio Build Tools with the
Desktop development with C++ workload before running `npm run pack` locally.
The GitHub Release Artifacts workflow runs on `windows-latest`.

Create a trial sideload package:

```powershell
npm run build:trial-package
```

## First Configuration

Open Console from the overlay or tray, then configure:

1. Providers: add at least one model provider or CLI adapter.
2. Privacy controls: review redaction, offline mode, presenter mode, and kill switch.
3. Connectors: optionally connect email, Google, Microsoft, browser extension, Office add-in, MCP servers, and plugins.
4. Scheduler: create recurring or one-shot tasks and check approval behavior.
5. Skills: add reusable `SKILL.md` folders or let repeated workflows become suggested skills.

Provider keys are local to your machine. Runtime provider config stores `apiKeyRef` values in `%APPDATA%\UCA\config\runtime.json`; the local Secret Store keeps the corresponding key material under the runtime data directory. `%APPDATA%\UCA\` is the current legacy runtime namespace and is intentionally kept stable until a data-directory migration is designed. OS keychain backing is still planned before a broad v1.0 release.

## Data Locations

Runtime data is stored under the legacy `%APPDATA%\UCA\` namespace by default:

```text
%APPDATA%\UCA\
  config\
    runtime.json
  data\
    secrets.json
    uca.db
    integrations\
    history\
  logs\
  outputs\
```

Generated documents and artifacts are written to the configured outputs directory. Logs and task event files are local and are used for diagnostics and replay.

## Typical Commands

```text
Open Excel and Word.
Search recent AI agent papers and make a comparison table.
Summarize this PDF into a Word document.
Translate the selected text into Japanese.
Every weekday at 9:00, summarize important email from the last 24 hours.
Tomorrow at 3 PM, remind me to prepare for the meeting.
Find suitable jobs based on my resume and current postings.
```

LingxY tries to separate local context, external search, side effects, and output artifacts. For example, attaching a resume does not automatically open it unless the task requires file reading, and explicit search requests can combine local documents with current web results.

## Scheduler Semantics

- `cron` means recurring work, such as daily or weekly tasks.
- `at` means one-shot work at an absolute time. After it fires, it is complete.
- `interval` means repeated every-N-seconds unless the caller explicitly marks it as one-shot.
- Startup recovery catches missed recurring runs according to each schedule's `catchup_policy`.
- Completed one-shot schedules can be run manually without re-enabling automatic firing.

## Safety Model

LingxY treats dangerous work as side effects:

- Sending email, writing files, running external commands, installing MCP packages, uploading files, or mutating connected services can require approval.
- The desktop actor boundary limits local HTTP mutation routes to trusted shell surfaces.
- The tool loop records decisions, tool calls, results, and failures into task events.
- Redaction, offline mode, presenter mode, and a global network kill switch are available from settings.
- Verifiers lock important boundaries so regressions fail locally and in CI.

This is still a local development project. Review generated actions before trusting unattended workflows with high-risk operations.

## Repository Map

```text
src/
  desktop/
    renderer/             overlay, console, dock, preview UI
    tray/                 Electron main process and native shell wiring
  service/
    core/                 HTTP routes, runtime, storage, submission shell
    executors/            tool-using, agentic, fast, multimodal, CLI executors
    action_tools/         built-in tools and schemas
    connectors/           account connectors and workflows
    scheduler/            schedule lifecycle, misfire, dispatch, approvals
    security/             broker, audit, privacy controls
docs/
  architecture/
  privacy/
  release/
  runtime/
scripts/
  verify-*.mjs            subsystem verifiers
```

## Release Notes And Public Readiness

Release planning lives in [docs/release/](docs/release/README.md). The current release gate checks:

- required public files,
- forbidden tracked local/runtime files,
- third-party license inventory,
- trial package contents,
- installer launch smoke checks,
- source Markdown references,
- public/release readiness verifiers.

The `Release Artifacts` GitHub Actions workflow builds the Windows installer on `windows-latest`, runs the full verifier suite first, refreshes third-party notices, generates `checksums.sha256`, uploads installer artifacts, and can create or update a draft GitHub Release from a tag. Runtime auto-update support is intentionally not enabled until this artifact channel is proven stable.

Run:

```powershell
node scripts/verify-github-readiness.mjs
node scripts/verify-release-artifact-workflow.mjs
node scripts/verify-release-readiness.mjs
```

## License

LingxY is licensed under [MIT](LICENSE). Third-party dependency notices are generated in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Contributing

This repo is still being prepared for broader public collaboration. Before opening a PR, run:

```powershell
npm run check
```

Please keep changes framework-level rather than one-off patches for a single prompt or test case. Add behavior tests or verifier coverage when changing routing, scheduler, security, connectors, or executor behavior.
