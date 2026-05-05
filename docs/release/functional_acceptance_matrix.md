# Functional Acceptance Matrix

This matrix is the release-facing contract for "does the product work enough to
ship?" It complements unit/behavior tests by mapping user-visible capabilities
to automated verification and manual smoke passes.

Rule: a feature can stay in README as a shipped capability only when it has at least one automated verifier and a clear manual pass path for release testing.

For click-by-click visual and interaction coverage, pair this matrix with
`docs/release/user_interaction_smoke_checklist.md`.

## Automated Coverage

| Area | User-visible promise | Automated verification |
|---|---|---|
| Desktop shell | LingxY starts as a desktop app with tray, dock, overlay, console, popup cards, and preview surfaces | `verify:desktop-shell`, `verify:desktop-renderer`, `verify:overlay-composer`, `verify:context-handoff-ui`, `verify:ui-extras`, `verify:popup-card-fit`, `verify:preview-window` through `npm run check` |
| Console workspace | Tasks, conversations, providers, connectors, schedules, notes, projects, files, approvals, settings, and diagnostics remain navigable | `verify:console-ui`, `verify:console-runtime-client`, `verify:console-rendered-workspace`, `verify:tasks-page`, `verify:connectors-page`, `verify:notes-feature` |
| Provider and model routing | Users can configure model providers, pick current models, override conversation models, and use CLI-backed providers | `verify:provider-health`, `verify:provider-routing`, `verify:ai-integrations`, `verify:conversation-model-override`, `verify:capability-gap-suggestions`, `verify:agentic-planner` |
| First useful task path | A user can submit a normal request, see task status, get events, and receive a final answer or actionable failure | `verify:runtime-wiring`, `verify:behavior-tests`, `verify:status-metrics`, `verify:task-log`, `verify:task-branch`, `verify:conversation-message-flow` |
| Tool-using agent | Tool calls, observations, retries, final synthesis, launch sequencing, action truthfulness, and side-effect gates work as a loop | `verify:behavior-tests`, `verify:action-tools`, `verify:agentic-parity`, `verify:post-tool-final-synthesis`, `verify:synthesis-no-bypass`, `verify:action-claim-guard` |
| Search and research | Explicit web search, single-URL reads, multi-source/deep research, evidence ledger, citations, and no-search constraints behave predictably | `verify:explicit-search-required`, `verify:single-url-routing`, `verify:deep-research-tier`, `verify:evidence-normalizer`, `verify:evidence-persistence`, `verify:research-quality-e2e` |
| Local files and RAG | Attached files are indexed/read with provenance, shallow folder scans are not treated as full evidence, and file search works from tools/UI | `verify:file-content-index-ui`, `verify:file-content-index-records`, `verify:file-content-search-tool`, `verify:file-content-index-tool`, `verify:file-evidence-coverage`, `verify:file-read-budget`, `verify:file-rag-namespace` |
| Rich artifacts | DOCX/XLSX/PPTX/PDF/HTML/SVG/Mermaid artifacts are generated, validated, previewed, attached to conversations, and not faked on failure | `verify:preview-pdf`, `verify:preview-pptx`, `verify:no-fake-preview`, `verify:doc-renderer-arg-length`, `verify:artifact-action-contract`, `verify:artifact-attachment-flow`, `verify:artifact-conversation-index`, `verify:behavior-tests` |
| Browser entry | Browser extension, popup/sidepanel clicks, page source extraction, floating chip rules, and page-to-task handoff keep working | `verify:browser-extension`, `verify:browser-ui-click-smoke`, `verify:browser-overlay`, `verify:page-source-extractor`, `verify:page-explain-handoff`, `verify:extension-enrichment` |
| Office entry | Word/Excel/PowerPoint sideload bridge can collect selection/whole document context and submit valid payloads | `verify:office-base`, `verify:microsoft-contracts`, `verify:context-handoff-ui` |
| Native Windows entry | Explorer file entry, native host, active-window probe, screenshots, and desktop launch hooks keep their contracts | `verify:native-integrations`, `verify:active-window-probe`, `verify:pdf-ocr`, `verify:platform-foundation`, `verify:trial-launch` |
| Scheduler and automation | Recurring/one-shot/manual schedules, misfire recovery, run history, and approval behavior are consistent | `verify:scheduler`, `verify:scheduled-fire-safety`, `verify:schedule-grouping`, `verify:schedule-create-obligation`, `verify:create-schedule-recursion-guard` |
| Connectors | Email, account connectors, workflow dispatch, Microsoft/Google contracts, and scheduled connector authorization work behind guards | `verify:unified-connectors`, `verify:connector-catalog`, `verify:connector-workflow-dispatcher`, `verify:workflow-first-dispatch`, `verify:email-monitoring`, `verify:email-morning-digest`, `verify:email-send-routing` |
| MCP, skills, plugins, and code CLIs | Users can install/configure MCP, manage skills, discover capability gaps, and route code tasks to CLI adapters | `verify:plugin-registry`, `verify:internal-mcp-server`, `verify:ai-integrations`, `verify:file-kimi`, `verify:kimi-runtime`, `verify:behavior-tests`, `verify:capability-gap-suggestions` |
| Privacy and safety | Local mutation routes, side effects, provider secrets, audit logs, redaction, offline mode, and public docs stay guarded | `verify:local-http-surface`, `verify:submission-policy-boundary`, `verify:security-broker`, `verify:security-policy`, `verify:public-branding`, `verify:dependency-hygiene`, `verify:github-readiness` |
| Packaging and release | Trial bundle, launch smoke, release artifacts, checksums, third-party notices, and CI gates are reproducible | `verify:release-readiness`, `verify:release-artifact-workflow`, `verify:functional-acceptance`, `verify:user-interaction-smoke`, `verify:workflow-permissions`, `verify:codeql-workflow`, `verify:node-version-baseline`, `verify:pr-template`, `verify:issue-templates` |

## Manual Release Pass

These checks are intentionally manual because they depend on a clean Windows
profile, provider credentials, OAuth accounts, Office tenant policy, or
installer trust prompts.

| Area | Manual pass before public release |
|---|---|
| Fresh install | Clone or download on a clean Windows 10/11 machine, run `npm install`, start runtime and desktop, and verify the first-run path is understandable. |
| User interaction smoke | Walk `docs/release/user_interaction_smoke_checklist.md`: dock, overlay, console, voice, browser extension, Office, Explorer, scheduler, and approval controls. |
| Provider smoke | Configure at least one cloud provider or code CLI, run one short conversation, one tool-using task, one document-generation task, and one live schedule-creation task (`verify:schedule-create-live` may be used locally when credentials are available). |
| Browser sideload | Sideload the browser extension in a clean Chrome/Edge profile, capture selected text, capture current page URL/title, and send both into LingxY. |
| Office sideload | Sideload Word, Excel, and PowerPoint add-ins, submit current selection and whole-document context, and insert a reviewed result back into the document. |
| Explorer entry | Install the Explorer helper, right-click one file and multiple files, confirm the overlay opens with the expected file list and does not open the files unless the task requires reading them. |
| Scheduler | Create one recurring schedule and one one-shot schedule, restart LingxY, verify missed recurring runs recover correctly and completed one-shots do not pretend to be active. |
| Side-effect approval | Draft/send email through a configured account, verify approval cards show recipients/subject/body before sending, and reject/approve paths are both visible. |
| Artifact quality | Generate one DOCX, one PPTX, one spreadsheet, one HTML/PDF report, and one diagram-rich report; open each artifact locally and inspect formatting, tables, images/diagrams, and conversation attachment links. |
| MCP/skills | Install or configure one MCP server in a sandbox, create/edit one skill, and verify the tool/skill appears in the planner-visible capability list. |
| Packaging | Run `npm run pack` or the Release Artifacts workflow, inspect unsigned-installer warnings, verify checksums and bundled `THIRD_PARTY_LICENSES.md`, then launch the packaged app. |
| Recovery | Kill the runtime during a task, restart, confirm task state, logs, diagnostics export, and user-visible failure wording are understandable. |

## Release Rule

- `npm run check` must pass before any public tag.
- All manual pass rows above must be marked pass/partial/fail in
  `docs/release/external_trial_checklist.md` or the GitHub Release notes for
  the release candidate.
- Any partial/fail row must be copied into `docs/release/known_issues.md` with
  a user-facing workaround or an explicit decision not to ship.
