# Repository Directory Architecture

Phase REPO-0 high-level map of current vs target directory layout.
Status: 2026-05-10, verified against current repository state.

## Current Layout (major directories; not exhaustive of every leaf)

```
linxi/
├── src/
│   ├── desktop/          # Electron desktop app
│   │   ├── tray/         # Main process (composition root + helpers + IPC modules)
│   │   ├── renderer/     # Renderer windows (console, overlay, dock, popup, preview)
│   │   ├── shared/       # Desktop shared contracts (manifest, IPC channels)
│   │   └── console/      # Console-specific task detail models
│   └── service/          # Service runtime
│       ├── core/         # Core runtime (submission, policy, artifact, task, HTTP, stores, audio-routes, scheduler, planning, intent)
│       ├── action_tools/ # Built-in action tools (aggregator + 6 extracted families)
│       ├── executors/    # Task executors (tool_using, agentic, fast, multi_modal, kimi)
│       ├── ai/           # AI capabilities (skills, MCP, providers)
│       ├── connectors/   # External service connectors
│       ├── workers/      # Background workers (artifact extract)
│       ├── extractors/   # Content extraction (file ingest)
│       ├── embeddings/   # Semantic embedding/router
│       ├── email/        # Email digest
│       ├── store/        # Storage facades
│       ├── dag/          # DAG planning
│       ├── translation/  # Free text translation
│       ├── search/       # Web search
│       ├── security/     # Secret store, API key management
│       ├── audio/        # Audio transcription/TTS
│       ├── memory/       # Memory governance
│       ├── preview/      # Preview rendering registry
│       ├── scheduler/    # Scheduled task engine
│       ├── retry/        # Retry/backoff helpers
│       ├── metrics/      # Task execution metrics
│       ├── events/       # Task event emitter
│       ├── failures/     # Failure classification
│       ├── cost/         # LLM cost tracking
│       ├── templates/    # Prompt templates
│       ├── utils/        # Shared service utilities
│       └── https/        # HTTPS/HTTP server setup
├── uca-native-host/       # Native messaging host (Windows)
├── scripts/              # Verifiers, checks, dev tooling, GUI smoke runner
├── tests/                # Behavior tests
├── docs/                 # Architecture docs, inventories, handoff
└── assets/               # Brand assets, icons
```

## Target Architecture (long-term)

```
linxi/
├── apps/
│   ├── desktop/          # Electron app
│   │   ├── main/         # Main process helpers + IPC modules
│   │   ├── preload/      # Preload bridge
│   │   ├── renderer/     # Renderer windows
│   │   └── shared/       # Desktop shared contracts
│   └── native-host/      # Native messaging host
├── packages/
│   ├── service/          # Service runtime
│   │   ├── core/         # Core infrastructure
│   │   ├── capabilities/ # Tools, skills, MCP, connectors, providers
│   │   ├── executors/    # Task executors
│   │   └── workers/      # Background workers
│   └── shared/           # Shared contracts, types, constants
├── scripts/              # Build/CI/dev scripts
├── tests/                # All test suites
├── docs/                 # Architecture + development docs
├── assets/               # Checked-in brand assets
└── config/               # Shared config templates
```

## Migration Rules

1. No root-directory cosmetic reshuffle. Each directory move is a separate phase.
2. Compatibility barrels re-export only; they must not keep logic.
3. User-installed capabilities must not live under `src/` or `packages/`.
4. Generated artifacts must go under runtime data paths, not source trees.
5. Every directory move must have owner docs + verifier coverage + cleanup verifier.
6. No phase finishes if stale old-owner assertions remain.

## Current Phase Status

| Phase | Status |
|-------|--------|
| 2A | Contract inventories complete |
| 2B | Electron main decomposition complete (-58%) |
| 2C | Renderer client cleanup complete (fetch→0) |
| 2D | Low-risk tool family checkpoint complete (7 modules, 21 tools); high-risk deferred (write/edit/run/generate/render, GUI, capability) |
| 2E | Artifact boundary locked (sandbox + registration invariants) |
| 2F | Worker contract verifier complete |
| 2G | Provider boundary locked (19 resolver + 6 adapter callers) |
| CAP-0 | Capability directory inventory complete |
| REPO-0 | Current document |
| REPO-1 | Deferred (desktop app layout) |
