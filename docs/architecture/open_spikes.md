# Open Spikes and ADR Backlog

## Purpose

Capture decisions that should be validated explicitly instead of guessed during implementation.

## Required Spikes Before or During Early Phases

### 1. Explorer Entry Strategy

- default path: registry command menu + `uca-cli`
- follow-up evaluation: Win11 modern menu integration
- question to answer: do we need `IExplorerCommand` before file entry is considered usable?

### 2. Office Local HTTPS Strategy

- compare localhost TLS options and fallback protocol-handler path
- question to answer: what is the lowest-risk Office integration that still ships?

### 3. Scheduler Unattended Authorization

- formalize `interactive`, `unattended_safe`, and `approval_required`
- question to answer: which actions may execute without a user present?

### 4. Redaction Recovery Semantics

- confirm fail-closed behavior for crashed tasks with redaction applied
- question to answer: what exact states and user messages should be emitted after restart?

## ADR Backlog

- ADR-001: Electron UI shell vs alternatives
- ADR-002: three-process topology vs pure Electron
- ADR-003: SQLite + WAL ownership model
- ADR-004: file entry strategy on Windows Explorer
- ADR-005: Office integration path
