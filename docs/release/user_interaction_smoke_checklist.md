# User Interaction Smoke Checklist

This checklist is the release-facing pass for things a user can click, see,
hear, drag, approve, or recover from. Automated checks prove contracts; this
file keeps the human interaction pass explicit.

Rule: if a control is visible in a public build, it needs either a working
manual pass row here or it should be hidden/marked experimental before release.

## Desktop Surfaces

| Surface | What to click/use | Pass criteria |
|---|---|---|
| Dock | Drag to all four screen edges, click to open overlay, right-click tray/dock menu | Dock stays 48x48, snaps to edges, no native scrollbars, menu actions open the intended surface. |
| Overlay chat | Type, attach files by drag/drop, stop/retry/regenerate, copy tool output, add answer to notes | Streaming stays pinned to bottom, tool cards remain compact/collapsible, file chips attach without opening files, retry/regenerate is scoped to the task. |
| Console chat | Switch conversations, create a new chat, pick current model, attach files, collapse/expand sidebar | No blank dead panel, model picker shows configured and setup-needed providers, conversation history does not flicker during refresh. |
| Tasks | Open task detail, filter status/type, expand timeline, preview artifacts, delete/restore | Task status and timeline match backend events; generated artifacts open from the task and conversation. |
| Settings | Configure provider, test connection, manage routing, configure MCP/skills/connectors, review marketplace governance, filter/undo memory | Secret values are not echoed; missing config is actionable; disabling a provider/tool does not leave stale UI as available. |

## Voice and Audio

| Surface | What to click/use | Pass criteria |
|---|---|---|
| Overlay voice input | Open voice card, start/stop/cancel, speak a short command, press Enter to submit | Permission errors are explicit, live transcript appears, local recording fallback can still submit when Web Speech is unavailable. |
| Voice attachments | Drag a file/image onto the voice card, remove chip, submit spoken command with context | Attachment remains visible as a chip and routes through the same file/context pipeline as typed chat. |
| Note recording | Start note mode, capture mic/system audio when available, finish and summarize | Long recordings have duration caps, transcription fallback is visible, resulting note/task links are attached. |
| Echo mode | Enable Echo, enroll wake samples, trigger wake, speak command, end session | Wake listener pauses while overlay handles the command, resumes afterwards, and failure hints tell the user what to try next. |

## Browser Extension

| Surface | What to click/use | Pass criteria |
|---|---|---|
| Popup | Toggle floating chip mode, explain current page, open side panel, send quick chat | Mode pill clearly distinguishes desktop, standalone, and unconfigured states. |
| Floating chip | Select text near each viewport edge, hover actions, summarize/translate/explain inline | Chip flips/clamps inside the viewport, inline result streams without covering the selected text, blocked domains stay quiet. |
| Side panel | Analyze page/video/selection, follow up, clear history, enable precise location | Page/video context is compact in UI but still sent to the model; follow-ups retain context. |
| Standalone mode | Stop desktop runtime, configure extension provider, run popup/sidepanel/selection actions | Standalone mode only promises browser-context LLM help; UI must not imply local tools, files, scheduler, approvals, or artifacts are available. |

## Office, Files, And Automation

| Surface | What to click/use | Pass criteria |
|---|---|---|
| Office add-ins | Word/Excel/PowerPoint selection and whole-document actions | Payload shows source app/document context and does not mutate Office content without explicit user action. |
| Explorer entry | Right-click one file and multiple files | Overlay receives file list; files are not opened just because they were attached. |
| Scheduler | Create recurring and one-shot schedules, run now, edit/delete, restart app | Recurring misfires recover according to policy; completed one-shot schedules do not appear as active forever. |
| Side-effect approval | Email/calendar/file mutation approval from Console, Overlay, and popup card | Approval card shows exact target data; reject and approve both produce understandable outcomes. |

## Release Recording

- Mark each row pass/partial/fail in `docs/release/external_trial_checklist.md`
  or release candidate notes.
- Copy every partial/fail into `docs/release/known_issues.md` with a user-facing
  workaround or a decision to hide the feature.
- Do not upgrade a manual-only feature to README "shipped" language until it
  also has an automated verifier or a documented reason why automation is not
  feasible.
