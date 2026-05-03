#!/usr/bin/env node
/**
 * verify-ui-extras.mjs — defensive coverage for the cluster of UX
 * additions made during the post-Batch-6 rounds. These features were
 * added without dedicated verify scripts and are easy to silent-break
 * during a subsequent refactor (the original Codex incident showed
 * exactly that pattern with verify-palette / verify-tasks-page).
 *
 * Each assertion checks the minimum DOM / JS / CSS contract — file
 * paths can move and identifiers can be renamed without fanfare, but
 * the surface the user touches must keep working. Failures here mean
 * "you removed something the user was relying on; double-check before
 * shipping".
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

const consoleHtml = read("src/desktop/renderer/console.html");
const consoleJs = read("src/desktop/renderer/console.js");
const consoleChatSidebar = read("src/desktop/renderer/console-chat-sidebar.mjs");
const overlayHtml = read("src/desktop/renderer/overlay.html");
const overlayJs = read("src/desktop/renderer/overlay.js");
const sharedCss = read("src/desktop/renderer/shared.css");
const sharedUi = read("src/desktop/renderer/shared-ui.mjs");
const taskRuntime = read("src/service/core/task-runtime.mjs");
const conversationLifecycle = read("src/service/core/task-runtime/conversation-lifecycle.mjs");
const taskSubmission = read("src/service/core/task-runtime/task-submission.mjs");
const taskCancellation = read("src/service/core/task-runtime/task-cancellation.mjs");
const notesStore = read("src/service/store/notes-store.mjs");
const noteProjectConversationRoutes = read("src/service/core/http-routes/note-project-conversation-routes.mjs");
const connectorRoutes = read("src/service/core/http-routes/connector-routes.mjs");

// ── Toast system ───────────────────────────────────────────────────────
assert.ok(/id="consoleToastHost"/.test(consoleHtml), "toast: #consoleToastHost missing in console.html");
assert.ok(/function showConsoleToast\s*\(/.test(consoleJs), "toast: showConsoleToast() missing");
assert.ok(/\.toast-host\b/.test(sharedCss), "toast: .toast-host CSS missing");
assert.ok(/\.toast--err|\.toast--ok|\.toast--info/.test(sharedCss), "toast: kind variants missing");

// ── Right-click context menu ───────────────────────────────────────────
assert.ok(/id="chatCtxMenu"/.test(consoleHtml), "ctx-menu: #chatCtxMenu missing in console.html");
assert.ok(/id="overlayCtxMenu"/.test(overlayHtml), "ctx-menu: #overlayCtxMenu missing in overlay.html");
assert.ok(/function openCtxMenu\s*\(|openCtxMenu\s*=/.test(consoleJs), "ctx-menu: openCtxMenu() missing in console.js");
assert.ok(/function openOverlayCtxMenu\s*\(|openOverlayCtxMenu\s*=/.test(overlayJs), "ctx-menu: openOverlayCtxMenu() missing");
assert.ok(/\.ctx-menu\b/.test(sharedCss) && /\.ctx-menu\b/.test(overlayHtml),
  "ctx-menu: .ctx-menu CSS missing in either console or overlay");

// ── Image attachment thumbnails ────────────────────────────────────────
assert.ok(/loadAttachmentThumbnail/.test(consoleJs), "thumbnail: loadAttachmentThumbnail missing");
assert.ok(/ATTACH_THUMB_PLACEHOLDER/.test(consoleJs), "thumbnail: placeholder svg constant missing");
assert.ok(/\.chip-attach--image|\.chip-attach-thumb/.test(sharedCss), "thumbnail: image-chip CSS missing");

// ── New-note title prompt ──────────────────────────────────────────────
assert.ok(/ntp-new-prompt/.test(consoleJs) && /ntp-title-input/.test(consoleJs),
  "+note title: console picker missing inline title prompt");
assert.ok(/onp-new-prompt/.test(overlayJs) && /onp-title-input/.test(overlayJs),
  "+note title: overlay picker missing inline title prompt");
assert.ok(/title:\s*body\.title/.test(noteProjectConversationRoutes) || /body\.title/.test(noteProjectConversationRoutes),
  "+note title: /notes/append-chip handler must forward title");
assert.ok(/title\s*=\s*null\s*\}\s*\)/.test(notesStore) || /title\s*=\s*null/.test(notesStore),
  "+note title: notes-store appendChip must accept title arg");

// ── MCP explicit install button ────────────────────────────────────────
assert.ok(/data-mcp-install-click/.test(consoleJs), "mcp install: missing data-mcp-install-click button");
assert.ok(/mcp-install-btn/.test(consoleJs) && /mcp-install-btn/.test(sharedCss),
  "mcp install: .mcp-install-btn class or CSS missing");
assert.ok(/id="mcpServerTestBtn"/.test(consoleHtml), "mcp preflight: test button missing");
assert.ok(/\/config\/mcp\/test/.test(consoleJs), "mcp preflight: console must call /config/mcp/test");
assert.ok(/id="mcpInstallPackageDir"/.test(consoleHtml) && /id="mcpInstallPreviewBtn"/.test(consoleHtml),
  "mcp install preview: packageDir input and preview button missing");
assert.ok(/id="mcpInstallSource"/.test(consoleHtml) && /id="mcpInstallPlanBtn"/.test(consoleHtml),
  "mcp install plan: source input and plan button missing");
assert.ok(/id="mcpInstallRunBtn"/.test(consoleHtml) && /id="mcpInstallRunState"/.test(consoleHtml),
  "mcp install run: install button and state missing");
assert.ok(/\/config\/mcp\/install\/plan/.test(consoleJs),
  "mcp install plan: console must call dry-run plan endpoint");
assert.ok(/applyMcpInstallPlanToForm/.test(consoleJs) && /Install is not executed here/.test(consoleJs),
  "mcp install plan: plan must populate packageDir without executing install");
assert.ok(/runMcpInstallSource/.test(consoleJs) && /window\.ucaShell\.runMcpInstall/.test(consoleJs),
  "mcp install run: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/mcp\/install\/run/.test(consoleJs),
  "mcp install run: console must not call execution route directly");
assert.ok(/Installed\. Review fields before saving/.test(consoleJs),
  "mcp install run: install result must still require review before saving");
assert.ok(/previewMcpInstallCandidate/.test(consoleJs) && /window\.ucaShell\.previewMcpInstall/.test(consoleJs),
  "mcp install preview: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/mcp\/install\/preview/.test(consoleJs),
  "mcp install preview: console must not call file-reading preview route directly");
assert.ok(/applyMcpInstallPreviewToForm/.test(consoleJs) && /Review fields before saving/.test(consoleJs),
  "mcp install preview: preview must fill manual form and require review before saving");
assert.ok(/saveMcpServer/.test(consoleJs) && /window\.ucaShell\.saveMcpServer/.test(consoleJs),
  "mcp config save: console must use desktop shell bridge");
assert.ok(/deleteMcpServer/.test(consoleJs) && /window\.ucaShell\.deleteMcpServer/.test(consoleJs),
  "mcp config delete: console must use desktop shell bridge");
assert.ok(/toggleMcpServer/.test(consoleJs) && /window\.ucaShell\.toggleMcpServer/.test(consoleJs),
  "mcp runtime toggle: console must use desktop shell bridge");
assert.ok(/saveMcpServerConfig/.test(consoleJs) && /window\.ucaShell\.saveMcpServerConfig/.test(consoleJs),
  "mcp runtime config: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/mcp\/servers/.test(consoleJs),
  "mcp config save: console must not call /config/mcp/servers directly");
assert.ok(!/fetch\(`\$\{state\.serviceBaseUrl\}\/ai\/mcp\/\$\{encodeURIComponent\(id\)\}\/(?:toggle|config)/.test(consoleJs),
  "mcp runtime mutation: console must not call /ai/mcp/:id/toggle or /config directly");
assert.ok(/approveApproval/.test(consoleJs) && /window\.ucaShell\.approveApproval/.test(consoleJs),
  "approval approve: console must use desktop shell bridge");
assert.ok(/rejectApproval/.test(consoleJs) && /window\.ucaShell\.rejectApproval/.test(consoleJs),
  "approval reject: console must use desktop shell bridge");
assert.ok(/approveApproval/.test(overlayJs) && /window\.ucaShell\.approveApproval/.test(overlayJs),
  "approval approve: overlay must use desktop shell bridge");
assert.ok(/rejectApproval/.test(overlayJs) && /window\.ucaShell\.rejectApproval/.test(overlayJs),
  "approval reject: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(`?\/approvals\/\$\{encodeURIComponent\([^)]*\)\}\/(?:approve|reject)/.test(consoleJs),
  "approval mutation: console must not call approval mutation routes directly");
assert.ok(!/fetchJson\(`?\/approvals\/\$\{encodeURIComponent\([^)]*\)\}\/(?:approve|reject)/.test(overlayJs),
  "approval mutation: overlay must not call approval mutation routes directly");
assert.ok(/updateSecurityState/.test(consoleJs) && /window\.ucaShell\.updateSecurityState/.test(consoleJs),
  "security settings: console must use desktop shell bridge");
assert.ok(/updateBudget/.test(consoleJs) && /window\.ucaShell\.updateBudget/.test(consoleJs),
  "budget settings: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/security\/state["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "security settings: console must not POST /security/state directly");
assert.ok(!/fetchJson\(\s*["'`]\/budget["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "budget settings: console must not POST /budget directly");
assert.ok(/createSchedule/.test(consoleJs) && /window\.ucaShell\.createSchedule/.test(consoleJs),
  "scheduler create: console must use desktop shell bridge");
assert.ok(/updateSchedule/.test(consoleJs) && /window\.ucaShell\.updateSchedule/.test(consoleJs),
  "scheduler update: console must use desktop shell bridge");
assert.ok(/deleteSchedule/.test(consoleJs) && /window\.ucaShell\.deleteSchedule/.test(consoleJs),
  "scheduler delete: console must use desktop shell bridge");
assert.ok(/runScheduleNow/.test(consoleJs) && /window\.ucaShell\.runSchedule/.test(consoleJs),
  "scheduler run-now: console must use desktop shell bridge");
assert.ok(/createScheduleViaShell/.test(overlayJs) && /window\.ucaShell\.createSchedule/.test(overlayJs),
  "scheduler create: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/schedules["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "scheduler create: console must not POST /schedules directly");
assert.ok(!/fetchJson\(\s*["'`]\/schedules["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(overlayJs),
  "scheduler create: overlay must not POST /schedules directly");
assert.ok(!/fetchJson\(\s*`\/schedules\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`](PATCH|DELETE)/.test(consoleJs),
  "scheduler mutation: console must not PATCH/DELETE /schedules/:id directly");
assert.ok(!/fetchJson\(\s*`\/schedules\/\$\{encodeURIComponent\([^)]*\)\}\/runs`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "scheduler run-now: console must not POST /schedules/:id/runs directly");
assert.ok(/saveTemplateViaShell/.test(consoleJs) && /window\.ucaShell\.saveTemplate/.test(consoleJs),
  "template save: console must use desktop shell bridge");
assert.ok(/importTemplateViaShell/.test(consoleJs) && /window\.ucaShell\.importTemplate/.test(consoleJs),
  "template import: console must use desktop shell bridge");
assert.ok(/deleteTemplateViaShell/.test(consoleJs) && /window\.ucaShell\.deleteTemplate/.test(consoleJs),
  "template delete: console must use desktop shell bridge");
assert.ok(/resumeDagExecutionViaShell/.test(consoleJs) && /window\.ucaShell\.resumeDagExecution/.test(consoleJs),
  "DAG resume: console must use desktop shell bridge");
assert.ok(/saveTemplateViaShell/.test(overlayJs) && /window\.ucaShell\.saveTemplate/.test(overlayJs),
  "template save: overlay must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/templates["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "template save: console must not POST /templates directly");
assert.ok(!/fetchJson\(\s*["'`]\/templates["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(overlayJs),
  "template save: overlay must not POST /templates directly");
assert.ok(!/fetchJson\(\s*["'`]\/templates\/import["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "template import: console must not POST /templates/import directly");
assert.ok(!/fetchJson\(\s*`\/templates\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "template delete: console must not DELETE /templates/:id directly");
assert.ok(!/fetchJson\(\s*`\/dag\/executions\/\$\{encodeURIComponent\([^)]*\)\}\/resume`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "DAG resume: console must not POST /dag/executions/:id/resume directly");
assert.ok(/saveProviderViaShell/.test(consoleJs) && /window\.ucaShell\.saveProvider/.test(consoleJs),
  "provider save: console must use desktop shell bridge");
assert.ok(/deleteProviderViaShell/.test(consoleJs) && /window\.ucaShell\.deleteProvider/.test(consoleJs),
  "provider delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/providers["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "provider save: console must not POST /config/providers directly");
assert.ok(!/fetchJson\(\s*`\/config\/providers\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "provider delete: console must not DELETE /config/providers/:id directly");
assert.ok(/saveCodeCliAdapterViaShell/.test(consoleJs) && /window\.ucaShell\.saveCodeCliAdapter/.test(consoleJs),
  "Code CLI adapter save: console must use desktop shell bridge");
assert.ok(/deleteCodeCliAdapterViaShell/.test(consoleJs) && /window\.ucaShell\.deleteCodeCliAdapter/.test(consoleJs),
  "Code CLI adapter delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/code-cli\/adapters["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "Code CLI adapter save: console must not POST /config/code-cli/adapters directly");
assert.ok(!/fetchJson\(\s*`\/config\/code-cli\/adapters\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "Code CLI adapter delete: console must not DELETE /config/code-cli/adapters/:id directly");
assert.ok(/saveSkillRegistryViaShell/.test(consoleJs) && /window\.ucaShell\.saveSkillRegistry/.test(consoleJs),
  "skill registry save: console must use desktop shell bridge");
assert.ok(/deleteSkillRegistryViaShell/.test(consoleJs) && /window\.ucaShell\.deleteSkillRegistry/.test(consoleJs),
  "skill registry delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/skills\/registries["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "skill registry save: console must not POST /config/skills/registries directly");
assert.ok(!/fetchJson\(\s*`\/config\/skills\/registries\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "skill registry delete: console must not DELETE /config/skills/registries/:id directly");
assert.ok(/updateRoutingConfigViaShell/.test(consoleJs) && /window\.ucaShell\.updateRoutingConfig/.test(consoleJs),
  "routing config: console must use desktop shell bridge");
assert.ok(/updateOutputConfigViaShell/.test(consoleJs) && /window\.ucaShell\.updateOutputConfig/.test(consoleJs),
  "output config: console must use desktop shell bridge");
assert.ok(/updateFeatureConfigViaShell/.test(consoleJs) && /window\.ucaShell\.updateFeatureConfig/.test(consoleJs),
  "feature config: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/routing["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "routing config: console must not POST /config/routing directly");
assert.ok(!/fetchJson\(\s*["'`]\/config\/output["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "output config: console must not POST /config/output directly");
assert.ok(!/fetchJson\(\s*["'`]\/config\/features["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "feature config: console must not POST /config/features directly");
assert.ok(/updateEmailSettingsViaShell/.test(consoleJs) && /window\.ucaShell\.updateEmailSettings/.test(consoleJs),
  "email settings: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/email\/settings["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email settings: console must not POST /config/email/settings directly");
assert.ok(/saveEmailAccountViaShell/.test(consoleJs) && /window\.ucaShell\.saveEmailAccount/.test(consoleJs),
  "email account save: console must use desktop shell bridge");
assert.ok(/deleteEmailAccountViaShell/.test(consoleJs) && /window\.ucaShell\.deleteEmailAccount/.test(consoleJs),
  "email account delete: console must use desktop shell bridge");
assert.ok(!/fetchJson\(\s*["'`]\/config\/email\/accounts["'`]\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email account save: console must not POST /config/email/accounts directly via fetchJson");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/config\/email\/accounts`\s*,\s*\{\s*method:\s*["'`]POST/.test(consoleJs),
  "email account save: console must not POST /config/email/accounts directly via fetch");
assert.ok(!/fetchJson\(\s*`\/config\/email\/accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "email account delete: console must not DELETE /config/email/accounts/:id directly via fetchJson");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/config\/email\/accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{\s*method:\s*["'`]DELETE/.test(consoleJs),
  "email account delete: console must not DELETE /config/email/accounts/:id directly via fetch");
assert.ok(/\.mcp-install-preview\b/.test(sharedCss),
  "mcp install preview: CSS wrapper missing");
assert.ok(/id="skillRegistryTestBtn"/.test(consoleHtml), "skill preflight: test button missing");
assert.ok(/\/config\/skills\/test/.test(consoleJs), "skill preflight: console must call /config/skills/test");
assert.ok(/function setPreflightState\s*\(/.test(consoleJs), "preflight state: helper missing");
assert.ok((consoleJs.match(/setPreflightState\s*\(/g) ?? []).length >= 8,
  "preflight state: MCP/Skill test and save paths must use setPreflightState");
assert.ok(/\.preflight-state--ok\b/.test(sharedCss)
    && /\.preflight-state--err\b/.test(sharedCss)
    && /\.preflight-state--pending\b/.test(sharedCss),
  "preflight state: ok/err/pending CSS classes missing");
assert.ok(/Actual startup tested/.test(consoleJs),
  "mcp preflight: success copy must clarify descriptor-only validation");
assert.ok(!/mcpServerState\.textContent\s*=\s*["'`]Looks valid/.test(consoleJs),
  "mcp preflight: raw Looks valid text must use state helper");
assert.ok(!/skillRegistryState\.textContent\s*=\s*["'`]Looks valid/.test(consoleJs),
  "skill preflight: raw Looks valid text must use state helper");
assert.ok(/showFieldError\s*\(/.test(consoleJs) && /clearFieldErrors\s*\(/.test(consoleJs),
  "preflight field errors: console must render inline field errors");
assert.ok(/\.field-error\b/.test(sharedCss), "preflight field errors: .field-error CSS missing");

// ── Per-user-message ↑/↓ nav ───────────────────────────────────────────
assert.ok(/chat-msg-nav\b/.test(sharedCss) && /chat-msg-nav-btn/.test(consoleJs),
  "user nav: console ↑/↓ buttons missing");
assert.ok(/bubble-nav\b/.test(overlayHtml) && /bubble-nav-btn/.test(overlayJs),
  "user nav: overlay ↑/↓ buttons missing");
assert.ok(/function navigateUserMessage/.test(consoleJs), "user nav: navigateUserMessage missing");
assert.ok(/function navigateUserBubble/.test(overlayJs), "user nav: navigateUserBubble missing");

// ── Streaming caret ────────────────────────────────────────────────────
assert.ok(/\.chat-msg-bubble\.streaming::after/.test(sharedCss), "streaming caret: console CSS missing");
assert.ok(/\.bubble\.assistant\.streaming::after/.test(overlayHtml), "streaming caret: overlay CSS missing");

// ── Bubble timestamps ──────────────────────────────────────────────────
assert.ok(/function formatRelativeTime\s*\(/.test(sharedUi), "timestamps: shared formatRelativeTime() missing");
assert.ok(/formatRelativeTime/.test(consoleJs), "timestamps: console must import/use formatRelativeTime()");
assert.ok(/formatRelativeTime/.test(overlayJs), "timestamps: overlay must import/use formatRelativeTime()");
assert.ok(/refreshChatTimestamps/.test(consoleJs) && /refreshChatTimestamps/.test(overlayJs),
  "timestamps: refresh tick missing on either surface");
assert.ok(/\.chat-msg-time\b/.test(sharedCss), "timestamps: .chat-msg-time CSS missing");

// ── Auto-title conversations ───────────────────────────────────────────
assert.ok(/function deriveConversationTitle\s*\(/.test(conversationLifecycle),
  "auto-title: deriveConversationTitle() missing in conversation-lifecycle");
assert.ok(/from\s+["']\.\/conversation-lifecycle\.mjs["']/.test(taskSubmission),
  "auto-title: task-submission must delegate conversation lifecycle helpers");
assert.ok(/runtime\.store\?\.updateConversation\b|runtime\.store\.updateConversation\b/.test(taskSubmission),
  "auto-title: must call updateConversation on first message");

// ── Stop button: force cancel ──────────────────────────────────────────
assert.ok(/cancelTask\s*\(\s*\{[^}]*force\s*=/.test(taskCancellation),
  "stop button: cancelTask must accept force arg");
assert.ok(/cancellationRequestedTaskId/.test(overlayJs),
  "stop button: overlay must track cancellationRequestedTaskId");
assert.ok(/send-btn--cancelling/.test(overlayHtml) && /send-btn--cancelling/.test(overlayJs),
  "stop button: cancelling visual state missing in overlay");
assert.ok(/consoleChatActiveTaskId/.test(consoleJs),
  "stop button: console must track consoleChatActiveTaskId");
assert.ok(/btn-stop\b/.test(consoleJs) && /\.btn\.btn-stop/.test(sharedCss),
  "stop button: console btn-stop class wiring missing");
assert.ok(/cancelTaskViaShell/.test(consoleJs) && /window\.ucaShell\.cancelTask/.test(consoleJs),
  "task cancel: console must use desktop shell bridge");
assert.ok(/retryTaskViaShell/.test(consoleJs) && /window\.ucaShell\.retryTask/.test(consoleJs),
  "task retry: console must use desktop shell bridge");
assert.ok(/deleteTaskViaShell/.test(consoleJs) && /window\.ucaShell\.deleteTask/.test(consoleJs),
  "task delete: console must use desktop shell bridge");
assert.ok(/cancelTaskViaShell/.test(overlayJs) && /window\.ucaShell\.cancelTask/.test(overlayJs),
  "task cancel: overlay must use desktop shell bridge");
assert.ok(/retryTaskViaShell/.test(overlayJs) && /window\.ucaShell\.retryTask/.test(overlayJs),
  "task retry: overlay must use desktop shell bridge");
const taskControlSources = `${consoleJs}\n${overlayJs}`;
assert.ok(!/fetchJson\(\s*`\/task\/\$\{[^}]+\}\/cancel`\s*,\s*\{[\s\S]{0,220}method:\s*["'`]POST/.test(taskControlSources),
  "task cancel: renderers must not POST /task/:id/cancel directly");
assert.ok(!/fetchJson\(\s*`\/task\/\$\{[^}]+\}\/retry`\s*,\s*\{[\s\S]{0,220}method:\s*["'`]POST/.test(taskControlSources),
  "task retry: renderers must not POST /task/:id/retry directly");
assert.ok(!/fetchJson\(\s*`\/task\/\$\{[^}]+\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]DELETE/.test(consoleJs),
  "task delete: console must not DELETE /task/:id directly");

// ── Recent conversations panel in Tasks empty state ────────────────────
assert.ok(/id="taskRecentConversationsPanel"/.test(consoleHtml),
  "recent convs: panel missing in console.html");
assert.ok(/function renderTaskRecentConversations/.test(consoleJs),
  "recent convs: renderTaskRecentConversations() missing");

// ── Connector edit (rename) ────────────────────────────────────────────
assert.ok(/data-connected-edit/.test(consoleJs),
  "connector edit: data-connected-edit button missing on connected cards");
assert.ok(/function handleConnectedAccountEdit/.test(consoleJs),
  "connector edit: handler missing");
assert.ok(/renameConnectedAccountViaShell/.test(consoleJs) && /window\.ucaShell\.renameConnectedAccount/.test(consoleJs),
  "connector edit: console must use desktop shell bridge");
assert.ok(/setConnectedAccountDefaultViaShell/.test(consoleJs) && /window\.ucaShell\.setConnectedAccountDefault/.test(consoleJs),
  "connector default: console must use desktop shell bridge");
assert.ok(/disconnectConnectedAccountViaShell/.test(consoleJs) && /window\.ucaShell\.disconnectConnectedAccount/.test(consoleJs),
  "connected account disconnect: console must use desktop shell bridge");
assert.ok(/disconnectConnectorAccountViaShell/.test(consoleJs) && /window\.ucaShell\.disconnectConnectorAccount/.test(consoleJs),
  "connector account disconnect: console must use desktop shell bridge");
assert.ok(/saveConnectorAccountConfigViaShell/.test(consoleJs) && /window\.ucaShell\.saveConnectorAccountConfig/.test(consoleJs),
  "connector account config: console must use desktop shell bridge");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/connected-accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]PATCH/.test(consoleJs),
  "connector edit: console must not PATCH /connectors/connected-accounts/:id directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/connected-accounts\/\$\{encodeURIComponent\([^)]*\)\}\/defaults`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]PATCH/.test(consoleJs),
  "connector default: console must not PATCH /connectors/connected-accounts/:id/defaults directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/connected-accounts\/\$\{encodeURIComponent\([^)]*\)\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]DELETE/.test(consoleJs),
  "connected account disconnect: console must not DELETE /connectors/connected-accounts/:id directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/accounts\/\$\{[^}]+\}`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]DELETE/.test(consoleJs),
  "connector account disconnect: console must not DELETE /connectors/accounts/:type directly");
assert.ok(!/fetch\(\s*`\$\{state\.serviceBaseUrl\}\/connectors\/accounts\/\$\{[^}]+\}\/config`\s*,\s*\{[\s\S]{0,180}method:\s*["'`]PATCH/.test(consoleJs),
  "connector account config: console must not PATCH /connectors/accounts/:type/config directly");
assert.ok(/PATCH.*connected-accounts.*\$/m.test(connectorRoutes)
  || /method === "PATCH" && \/\^\\\/connectors\\\/connected-accounts\\\/\[\^\\\/\]\+\$/.test(connectorRoutes)
  || /connected-accounts\/\[\^\\\/\]\+\$/.test(connectorRoutes),
  "connector edit: PATCH /connectors/connected-accounts/:id endpoint missing");
assert.ok(/upsertConnectedAccount/.test(connectorRoutes),
  "connector edit: route must call upsertConnectedAccount");

// ── Note font-size sweep + chip inheritance ────────────────────────────
assert.ok(/queryselectorAll\(".\[style\*='font-size'\]/i.test(consoleJs)
  || /querySelectorAll\("\[style\*='font-size'\]"\)/.test(consoleJs),
  "note font-size: applyFontSize must sweep [style*='font-size']");
assert.ok(/note-chat-chip[\s\S]{0,200}font-size:\s*inherit/.test(sharedCss),
  "note font-size: chip CSS must inherit");

// ── clearBubbles defensive guard ───────────────────────────────────────
assert.ok(/streamingBubble[\s\S]{0,200}classList\?\.contains\("streaming"\)/.test(overlayJs)
  || /classList\?\.contains\("streaming"\)/.test(overlayJs),
  "clearBubbles: must preserve a live .streaming bubble");

// ── Auto-scroll bottom-pin controller ──────────────────────────────────
assert.ok(/createBottomPinController/.test(consoleJs) && /createBottomPinController/.test(overlayJs),
  "scroll-pin: controller must exist on both surfaces");
assert.ok(/id="bubbleScrollDown"/.test(overlayHtml) && /id="consoleChatScrollDown"/.test(consoleHtml),
  "scroll-pin: scroll-to-bottom buttons missing");
assert.ok(/\.scroll-to-bottom\b/.test(sharedCss),
  "scroll-pin: .scroll-to-bottom CSS missing");

// ── Drop-zone visual feedback ──────────────────────────────────────────
assert.ok(/id="consoleChatDropZone"/.test(consoleHtml) && /id="overlayDropZone"/.test(overlayHtml),
  "drop-zone: zone DOM missing in either surface");
assert.ok(/\.chat-drop-zone\b/.test(sharedCss),
  "drop-zone: .chat-drop-zone CSS missing");

// ── Phase labels in timeline header ────────────────────────────────────
assert.ok(/TIMELINE_PHASES|setTimelinePhase/.test(overlayJs),
  "phase labels: TIMELINE_PHASES / setTimelinePhase missing");

// ── Step counter suffix ────────────────────────────────────────────────
assert.ok(/function formatStepSuffix/.test(read("src/desktop/renderer/task-event-stream.js")),
  "step counter: formatStepSuffix() missing in task-event-stream");

// ── Step copy on row ───────────────────────────────────────────────────
assert.ok(/\.bubble\.step\s+\.step-copy/.test(overlayHtml),
  "step copy: .step-copy CSS missing");

// ── Quote scrolls input into view ──────────────────────────────────────
assert.ok(/composer-flash/.test(consoleJs) && /composer-flash/.test(overlayJs),
  "quote: composer-flash class missing on either surface");
assert.ok(/\.composer-flash\b|composer-flash\b/.test(sharedCss),
  "quote: composer-flash animation missing");

// ── Connectors browse button promotion ─────────────────────────────────
assert.ok(/id="connBrowseBtn"[^>]*btn-primary/.test(consoleHtml),
  "connectors: Browse catalog button must be btn-primary");

// ── IA Phase 2: chat sidebar ───────────────────────────────────────────
assert.ok(/class="chat-layout"/.test(consoleHtml),
  "phase 2: .chat-layout grid missing on Chat tab");
assert.ok(/id="chatSidebarList"/.test(consoleHtml),
  "phase 2: #chatSidebarList missing");
assert.ok(/id="chatSidebarSearch"/.test(consoleHtml),
  "phase 2: #chatSidebarSearch input missing");
assert.ok(/id="chatSidebarNewBtn"/.test(consoleHtml),
  "phase 2: #chatSidebarNewBtn (+ New) missing");
assert.ok(/function renderChatSidebar/.test(consoleJs),
  "phase 2: renderChatSidebar() missing in console.js");
assert.ok(/function refreshChatSidebar/.test(consoleJs),
  "phase 2: refreshChatSidebar() missing in console.js");
assert.ok(/from\s+["']\.\/console-chat-sidebar\.mjs["']/.test(consoleJs),
  "phase 2: chat sidebar renderer module must be imported by console.js");
assert.ok(/function renderChatSidebarListHtml\s*\(/.test(consoleChatSidebar),
  "phase 2: chat sidebar list renderer missing");
assert.ok(/function filterChatSidebarItems\s*\(/.test(consoleChatSidebar),
  "phase 2: chat sidebar search helper missing");
assert.ok(/function startNewConsoleChat/.test(consoleJs),
  "phase 2: startNewConsoleChat() must exist (shared by sidebar + page-head buttons)");
assert.ok(/\.chat-sidebar\b/.test(sharedCss) && /\.chat-sidebar-list\b/.test(sharedCss),
  "phase 2: chat-sidebar CSS missing");
// Projects tab Preview column retired
assert.ok(!/projects-col[^"]*"\s*>[^<]*<header[\s\S]{0,200}Preview<span class="zh">预览/.test(consoleHtml),
  "phase 2: Projects tab Preview column should be retired");

console.log("ok verify-ui-extras");
