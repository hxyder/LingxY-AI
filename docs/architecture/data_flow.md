# Data Flow

## Purpose

Describe the end-to-end flow from captured context to stored result.

## Flow

```mermaid
flowchart TD
    A[User Action or Trigger] --> B[Capture Source]
    B --> C[Context Normalizer]
    C --> D[Security Broker]
    D --> E[Overlay or Console Entry]
    E --> F[Intent Router]
    F --> G[Task Builder]
    G --> H[Task Queue]
    H --> I[Executor Registry]
    I --> J[Executor]
    J --> K[Event Bus]
    K --> L[SQLite and Artifact Store]
    K --> M[SSE and UI Updates]
    L --> N[Task History]
    M --> O[User Feedback]
```

## Required Invariants

- Every context packet passes through the security layer before external execution.
- Every task event is persisted before it is broadcast to the UI.
- Every artifact is linked back to a task identifier.
- Every long-running execution path is replayable from persisted events.

## Phase 1 Baseline Path

For the first executable loop, the flow is:

1. user opens fixed overlay
2. clipboard text is captured
3. context is normalized
4. user picks a quick action
5. task is created and queued
6. fast executor streams output
7. events are stored and shown
8. result is available in task history
