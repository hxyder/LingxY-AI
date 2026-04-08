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
  operations/      failure taxonomy and retry strategy notes
  runtime/         runtime setup notes for concrete integrations
phases/            formal phase specifications
phases/tasks/      executable task packets and Git workflow
uca-cli/           file submission entry for shell integrations
src/
  desktop/         tray / overlay / console skeleton
  service/         core service and integration skeleton
  shared/          shared contracts and cross-process types
browser_ext/       browser extension placeholder
uca-native-host/   native messaging bridge for Chrome / Edge
office_addin/      Office add-in placeholder
scripts/           verification and repository utility scripts
tests/             future automated tests
tools/             local dev utilities
```

## Current Scope

This bootstrap commit focuses on:

- repository structure
- Git workflow baseline
- documentation placement
- AI provider / code CLI / MCP / skills interface reservations

Business implementation starts in later tasks.

Current implemented slices include:

- architecture and protocol baseline
- desktop shell and service core scaffolds
- file submission pipeline with batch aggregation
- mockable Kimi CLI JSONL executor
- browser extension and native host capture scaffold
- task lifecycle, retry, cancellation, and metrics scaffold
- action tool registry and execution-mode-aware tool loop scaffold
