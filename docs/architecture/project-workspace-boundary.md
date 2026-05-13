# Project Workspace Boundary

Status: PMAT-007 in progress.

Project is a product workspace, not a conversation alias.

Layer contract:

- `service/core/projects` owns project workspace normalization, project rows,
  project file records, and project summaries.
- `conversation_sessions` remain the runtime work thread for a single
  conversation. A project may contain many conversations and therefore many
  sessions.
- `renderer` may select, create, and display projects, but it must not be the
  source of project membership truth.
- `/projects/store` stays compatible with existing Console/Overlay clients, but
  it is now synchronized into the service-owned project workspace.
- Project files are explicit project attachments and optional file-content index
  inputs. They are not conversation messages.
- Context compilation may include compact project scope evidence, but it must
  not read or parse project files on the hot path.

Ownership:

- Project definitions: service store `projects`.
- Project files: service store `project_files`.
- Conversations: existing `conversations.project_id`.
- Sessions: existing `conversation_sessions.project_id`, derived from the
  owning conversation/task.
- Artifacts: existing conversation/project lookup through conversation
  ownership.

Verification:

- `node scripts/verify-project-workspace-service.mjs`
- `node --test tests/behavior/project-workspace-service.test.mjs`
- `node --test tests/behavior/context-compiler.test.mjs`
