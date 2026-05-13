# Project Workspace Boundary

Status: PMAT-007 through PMAT-012 complete.

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
- Project workbench UI reads `/projects/:id/workspace` for conversations,
  files, generated artifacts, and project stats. Renderer-local project store
  data is a compatibility/cache shape, not the workbench fact source.
- Project UI is chat-first: selecting a project opens a project-scoped
  conversation surface, with project files and instructions as adjacent context
  instead of a separate project-admin page.
- Project UI must stay visually close to the Chat surface: compact left rail,
  central thread list, and a restrained right context rail. Avoid nested cards,
  oversized stats, repeated headings, duplicate chat composers, or
  admin-dashboard density.
- Chat remains the only full conversation surface. Project pages set the Chat
  project scope, start or resume project conversations, and manage project
  context; they must not introduce a second parallel chat composer.
- Ordinary conversations and project conversations are separate conversation
  domains. The Chat sidebar's default domain is personal conversations with no
  `project_id`; selecting a project switches Chat into that project's domain.
  The UI must not present an "All conversations" mixed scope as the primary
  browsing mode.
- There is no top-level Files workspace. Generated artifacts and attached files
  are conversation/project context assets: Chat shows the active conversation's
  context files and generated artifacts, and Project shows the selected
  project's files/artifacts. Legacy files view IDs may stay as compatibility
  handles, but visible navigation must route users through Chat or Project.
- Clicking a generated artifact from Console opens the Console inline preview
  pane first. External open/reveal remains an explicit secondary action so users
  can inspect generated content without leaving the conversation.
- Project instructions are project metadata. They may be edited from the
  renderer, but persistence and future context use stay service-owned.
- Project files/folders are explicit project attachments and optional
  file-content index inputs. They are not conversation messages. Folder
  attachment is a bounded recursive index operation; the stored project file
  record must preserve whether the attachment was a file or a folder so the UI
  can manage it accurately.
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
