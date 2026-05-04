# LingxY PRD v1.0

## 1. Product Summary

LingxY is a system-level, context-driven execution entry for desktop work. It detects or accepts user context such as clipboard text, selected files, browser selections, Office selections, links, images, and screenshots, then routes the user request into an appropriate execution path with clear task tracking.

The product is not positioned as a chat client. Its core value is:

- act on the user's current context
- reduce copy-paste and app switching
- keep a visible task trail
- support both quick actions and longer-running jobs

## 2. Target Users

### Primary Users

- knowledge workers who move between browser, Office, PDFs, and local files
- research and analysis users who frequently summarize, compare, and report on documents
- operators who need repeatable context-to-action workflows

### Secondary Users

- power users who want a desktop command surface with task history
- internal teams that need a trackable AI execution layer over existing desktop tools

## 3. User Problems

- Users often need to act on what they are already viewing, not open a separate AI chat window.
- Current workflows require excessive copy-paste between files, browser pages, and AI tools.
- Existing AI assistants are often good at generating text but weak at task visibility, failure recovery, and multi-entry desktop workflows.
- Cross-application work loses context easily; users cannot easily trace what was run, what succeeded, and where outputs were saved.

## 4. Product Goals

### Core Goals

- Fast recognition, entry, execution, and feedback
- Unified context model across file, browser, Office, clipboard, image, and screenshot sources
- Low interruption interaction model
- Clear task lifecycle with logs, outputs, and retry paths
- Extensible execution layer for multiple AI providers, code CLIs, MCP integrations, and skills

### Success Criteria

- A user can go from context selection to useful result without opening a separate chat app.
- Every medium or heavy action creates a traceable task record.
- Failure reasons are visible and actionable instead of opaque.
- New execution backends can be added without changing the user entry model.

## 5. Non-Goals

- Not a full IDE code completion product
- Not a team collaboration workspace
- Not a general-purpose chatbot client
- Not a background screen surveillance or OCR monitoring tool
- Not a cross-platform MVP; Windows is the initial target platform

## 6. Primary User Scenarios

1. A user selects files in Explorer and asks LingxY to generate a report.
2. A user selects browser text and asks LingxY to summarize or translate it.
3. A user opens the fixed overlay, reads clipboard text, and runs a quick explanation task.
4. A user selects content in Word or Excel and sends it into a task flow.
5. A user triggers a screenshot OCR flow for content that is visible but not directly selectable.
6. A user returns to the console later to inspect output files, logs, and failure reasons.

## 7. MVP Scope

### In Scope

- Windows desktop shell with tray, fixed overlay, and task center
- clipboard entry
- file entry via context menu, drag-and-drop, and Explorer selection hotkey
- browser extension for text selection and links
- task tracking, logs, outputs, and history
- fast executor plus code CLI bridge

### Out of Scope for MVP

- cross-app floating cursor overlay
- Outlook integration
- background OCR monitoring
- team workspaces
- plugin marketplace

## 8. UX Principles

- Prefer event-driven entry over background scanning
- Always show what context was captured
- Use confirmation only where risk justifies it
- Keep quick tasks quick; do not force all requests into deep workflows
- Preserve a consistent path from result back to task history

## 9. Phase 0 Deliverables

- frozen PRD
- architecture package under `docs/architecture/`
- shared terminology for Phase 1 engineering work
- open spike list for decisions that should not be guessed during implementation

## 10. Open Items Handed to UCA-002

- formal JSON schema for ContextPacket, Task, TaskEvent, and Artifact
- state machine diagrams
- detailed risk register with owners and validation timing
- Kimi CLI bridge protocol freeze
