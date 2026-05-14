#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHECK_COMMANDS, FAST_CHECK_COMMANDS } from "./check-manifest.mjs";
import { createInMemoryStoreScaffold } from "../src/service/core/store/memory-store.mjs";
import { createProjectWorkspaceService } from "../src/service/core/projects/project-workspace-service.mjs";

const service = readFileSync("src/service/core/projects/project-workspace-service.mjs", "utf8");
const schema = readFileSync("src/service/core/store/sqlite-schema.mjs", "utf8");
const sqlite = readFileSync("src/service/core/store/sqlite-store.mjs", "utf8");
const memory = readFileSync("src/service/core/store/memory-store.mjs", "utf8");
const routes = readFileSync("src/service/core/http-routes/note-project-conversation-routes.mjs", "utf8");
const contextCompiler = readFileSync("src/service/core/context/context-compiler.mjs", "utf8");
const consoleJs = readFileSync("src/desktop/renderer/console.js", "utf8");
const consoleHtml = readFileSync("src/desktop/renderer/console.html", "utf8");
const projectsView = readFileSync("src/desktop/renderer/console-projects-view.mjs", "utf8");
const docs = readFileSync("docs/architecture/project-workspace-boundary.md", "utf8");
const roadmap = readFileSync("docs/architecture/post-runtime-upgrade-roadmap.md", "utf8");
const behavior = readFileSync("tests/behavior/project-workspace-service.test.mjs", "utf8");

assert.match(service, /createProjectWorkspaceService/u, "service owner must exist");
assert.match(service, /getProjectWorkspace/u, "service must expose project workspace summaries");
assert.match(service, /syncProjectStore/u, "service must migrate compatible project store inputs");
assert.match(schema, /CREATE TABLE IF NOT EXISTS projects/u, "sqlite schema must own projects");
assert.match(schema, /CREATE TABLE IF NOT EXISTS project_files/u, "sqlite schema must own project files");
assert.match(sqlite, /upsertProject/u, "sqlite store must expose project writes");
assert.match(sqlite, /upsertProjectFile/u, "sqlite store must expose project file writes");
assert.match(memory, /upsertProject/u, "memory store must mirror project writes");
assert.match(routes, /\/projects\/store/u, "compatible project store route must remain");
assert.match(routes, /projectWorkspaceMatch/u, "workspace route must expose project summary");
assert.match(routes, /getProjectWorkspace/u, "workspace route must call service owner");
assert.match(routes, /projectByIdMatch/u, "project metadata route must update service-owned projects");
assert.match(routes, /projectWorkspaceMatch[\s\S]{0,180}requireDesktopActor/u,
  "workspace summary must be guarded because it exposes file paths and conversation titles");
assert.match(contextCompiler, /project_scope/u, "ContextCompiler must include typed project scope evidence");
assert.match(contextCompiler, /instructions/u, "ContextCompiler must preserve project instructions as typed project scope");
assert.match(consoleHtml, /projectWorkspaceSummary/u, "Projects UI must include a project workspace summary");
assert.match(consoleHtml, /projectInstructionsInput/u, "Projects UI must expose project instructions");
assert.match(consoleHtml, /projectStartChatBtn/u, "Projects UI must expose project-scoped new chat");
assert.match(consoleHtml, /projectOpenChatBtn/u, "Projects UI must expose open-in-chat action");
assert.match(consoleHtml, /project-clean-layout/u, "Projects UI must use the clean chat-like project layout");
assert.doesNotMatch(consoleHtml, /projectQuickChatForm/u, "Projects UI must not own a duplicate chat composer");
assert.match(consoleJs, /\/projects\/\$\{encodeURIComponent\(projectId\)\}\/workspace/u,
  "Projects UI must read the service-owned workspace route");
assert.match(consoleJs, /saveProjectMetadataViaService/u, "Projects UI must persist metadata through service route");
assert.match(consoleJs, /setSelectedProjectChatScope/u, "Projects UI must set Chat project scope through shared Chat routing");
assert.match(consoleJs, /openSelectedProjectChat/u, "Projects UI must route project actions into Chat");
assert.match(consoleJs, /project_id: chatSidebarProjectId/u, "Chat submissions must preserve selected project scope");
assert.match(projectsView, /renderProjectWorkspaceSummaryHtml/u, "Projects UI view model must render workspace stats");
assert.match(docs, /Project is a product workspace/u, "boundary doc must define project semantics");
assert.match(docs, /chat-first/u, "boundary doc must define project chat IA");
assert.match(docs, /no visible top-level Project rail tab/u, "boundary doc must keep Project out of primary rail navigation");
assert.match(docs, /Chat remains the only full conversation surface/u, "boundary doc must prevent duplicate project chat surfaces");
assert.match(roadmap, /PMAT-007 Project workspace separation/u, "roadmap must track PMAT-007");
assert.match(roadmap, /PMAT-008 Project workbench IA/u, "roadmap must track PMAT-008");
assert.match(roadmap, /PMAT-009 Project chat IA/u, "roadmap must track PMAT-009");
assert.match(roadmap, /PMAT-010 Project UI cleanup/u, "roadmap must track PMAT-010");
assert.match(roadmap, /PMAT-011 Project as Chat scope/u, "roadmap must track PMAT-011");
assert.match(behavior, /separates projects, conversations, and files/u, "behavior tests must cover project split");

const store = createInMemoryStoreScaffold();
const projects = createProjectWorkspaceService({ store });
projects.syncProjectStore({
  currentProjectId: "proj_verify",
  projects: [{ id: "proj_verify", name: "Verify", attachedFilePaths: ["E:\\verify\\a.md"] }],
  conversations: []
});
store.insertConversation({ conversation_id: "conv_verify", project_id: "proj_verify" });
const workspace = projects.getProjectWorkspace("proj_verify");
assert.equal(workspace.project_id, "proj_verify");
assert.equal(workspace.files.length, 1);
assert.equal(workspace.conversations.length, 1);

const command = "node scripts/verify-project-workspace-service.mjs";
assert.ok(CHECK_COMMANDS.includes(command), "check manifest must include project workspace verifier");
assert.ok(FAST_CHECK_COMMANDS.includes(command), "fast check manifest must include project workspace verifier");

console.log("[verify-project-workspace-service] project workspace service contract OK");
