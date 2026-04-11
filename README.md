# Universal Context Agent

This repository contains the planning documents, task breakdown, and implementation skeleton for UCA.

## Start Here

- Planning index: [phases/README.md](phases/README.md)
- Task execution rules: [phases/tasks/README.md](phases/tasks/README.md)
- Task order: [phases/tasks/TASK_INDEX.md](phases/tasks/TASK_INDEX.md)
- Archived planning context: [docs/planning/README.md](docs/planning/README.md)

## Repository Layout

```text
docs/
  planning/        original planning narrative and review context
  action_tools/    action tool authoring and risk docs
  release/         trial release notes, E2E matrix, rollback and known issues
  operations/      failure taxonomy and retry strategy notes
  privacy/         privacy policy and secure data-flow notes
  runtime/         runtime setup notes for concrete integrations
phases/            formal phase specifications
phases/tasks/      executable task packets and Git workflow
uca-cli/           file submission entry for shell integrations
src/
  desktop/         tray / overlay / console skeleton
  service/         core service and integration skeleton
    action_tools/    tool schemas + implementations + risk matrix
    core/            submission layer, router, http server, bootstrap
    executors/       runnable task executors
      fast/            lightweight LLM API calls (Anthropic / OpenAI / DeepSeek / Ollama)
      kimi/            Kimi CLI subprocess + OOXML output format (pptx/docx/xlsx)
      tool_using/      legacy tool-planner loop
      multi_modal/     vision-first executor for image tasks
      translate/       free-translation client (no LLM)
      shared/          provider-resolver (per-task routing + UCA_CONFIG_PATH hot-reload)
      agentic/         UCA-049: provider-agnostic agentic runtime
        provider-adapter.mjs   unified generate({messages,tools}) for 4 kinds
        prompt-builder.mjs     dynamic tool-catalogue system prompt
        planner.mjs            8-step tool-use loop + truthfulness guard
        executor.mjs           id:"agentic" executor scaffold
        code-cli-bridge.mjs    JSON planning-mode bridge for code_cli providers
    search/          free DuckDuckGo search client
    translation/     free translation client
    ai/              provider / MCP / code-CLI / skills registries
    extractors/      file + image + PDF content extractors
    scheduler/       cron-ish recurring task engine
    security/        broker, audit log, redaction
    store/           artifact store
    metrics/         task metrics registry
  shared/          shared contracts and cross-process types
browser_ext/       browser extension placeholder
uca-native-host/   native messaging bridge for Chrome / Edge
office_addin/      Office add-in placeholder
scripts/           verification and repository utility scripts
  create-ooxml-fixture.ps1   PowerShell generator for docx/xlsx/pptx artifacts
  verify-*.mjs               per-subsystem verify scripts invoked by `npm run check`
tests/             future automated tests
  fixtures/                  mock CLIs + sample inputs for verify scripts
tools/             local dev utilities
```

## Current Scope

This bootstrap commit focuses on:

- repository structure
- Git workflow baseline
- documentation placement
- AI provider / code CLI / MCP / skills interface reservations
- hot-reloadable AI integration registry for providers, code CLIs, MCP servers, and Codex-style skills

Business implementation starts in later tasks.

Current implemented slices include:

- architecture and protocol baseline
- desktop shell and service core scaffolds
- file submission pipeline with batch aggregation
- mockable Kimi CLI JSONL executor
- browser extension and native host capture scaffold
- browser-only floating chip rules, positioning, and popup settings scaffold
- Office Add-in base scaffold with spike-driven localhost HTTPS fallback plan
- PDF text extraction, OCR routing, screenshot submission, and multi-modal scaffold
- task lifecycle, retry, cancellation, and metrics scaffold
- action tool registry and execution-mode-aware tool loop scaffold
- security broker, presenter mode, offline gating, and redaction scaffold
- scheduler, pending approvals, misfire handling, and schedule management scaffold
- platform foundation scaffold for templates, DAG orchestration, budget controls, executor routing, and local history search
- persistent local runtime scaffold with SQLite, HTTP/SSE, config storage, and Electron main entry
- native integration install scripts plus .NET Explorer helper / Native Messaging host
- resolved Kimi CLI runtime with real print-mode execution and health probing
- provider health detection for OpenAI, Claude, Kimi API, and Ollama
- release readiness docs, trial package builder, and bundle verification
- UCA-049 provider-agnostic agentic runtime: unified `generate({messages,tools})` adapter covering anthropic / openai-compat / ollama / code_cli, per-task provider resolution (no more boot-time snapshot), universal tool belt (`write_file`, `run_script`, `generate_document`), dynamic tool-catalogue system prompt, 8-step planner loop with truthfulness guard, intent_tags multi-label routing, pptx output format, and a JSON planning-mode bridge that lets any `--print` capable code CLI (Kimi CLI / Claude Code CLI / Codex / Gemini) drive multi-step tool use
- hot-reloadable AI integration configuration under `data/integrations/{mcp,skills,code_cli}` plus HTTP endpoints for adding MCP servers, Skills registries, and code CLI adapters without a runtime restart
