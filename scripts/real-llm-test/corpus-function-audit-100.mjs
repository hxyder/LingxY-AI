// Function audit corpus: 100 new prompts for framework/function coverage.
//
// This file intentionally avoids the prompts already used in corpus.mjs,
// run-feature-smoke.mjs, and the user's reported repros. Service-level cases
// run through /task; true desktop-only surfaces stay in the GUI checklist.

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => path.join(__dirname, "fixtures", name);

const OK = ["success"];
const SOFT_OK = ["success", "partial_success"];
const ANY_TERMINAL = ["success", "partial_success", "failed"];
const NO_WEB = ["web_search_fetch", "fetch_url_content", "web_search"];
const WEB_GROUP = "external_web_read";
const FILE_READ_ONE_OF = ["read_file_text", "read_folder_text", "search_file_content"];

function mk(id, userCommand, expected, extra = {}) {
  return {
    id,
    category: id.split(".")[0],
    userCommand,
    extra,
    expected
  };
}

function buildCorpus() {
  const items = [];

  // 1. Fast no-tool reasoning: 6
  [
    ["Q.event_sourcing", "用三句话解释 event sourcing 和普通 CRUD 的区别。", ["event", "CRUD"]],
    ["Q.heap_vs_stack", "What is the difference between heap memory and stack memory?", ["heap", "stack"]],
    ["Q.idempotency", "解释一下接口幂等性，给一个支付场景例子。", ["幂等", "支付"]],
    ["Q.lock_free", "What does lock-free mean in concurrent programming?", ["lock", "progress"]],
    ["Q.bloom_filter", "不要联网，说明 Bloom filter 的误判和漏判特点。", ["Bloom", "误判"]],
    ["Q.http_status", "HTTP 409 和 422 通常分别适合什么错误？", ["409", "422"]]
  ].forEach(([id, prompt, must]) => {
    items.push(mk(id, prompt, {
      terminal: OK,
      toolMustNotInclude: NO_WEB,
      textMustInclude: must,
      behavior: "stable reasoning answer; should not use web tools"
    }));
  });

  // 2. Current web/search: 8
  [
    ["W.node_lts", "查一下 Node.js 当前 LTS 版本，并用一句话说明发布日期。"],
    ["W.python_release", "Python 当前最新稳定版是多少？给出来源。"],
    ["W.chromium_release", "Chromium 最近稳定版本号是多少？"],
    ["W.typescript_status", "TypeScript 当前最新稳定版本有哪些主要变化？"],
    ["W.react_native_release", "React Native 最近一个稳定版的版本号和发布时间。"],
    ["W.deno_release", "Deno 最新稳定版本是多少？列来源。"],
    ["W.vite_release", "Vite 当前最新稳定版是多少？"],
    ["W.winappsdk_release", "Windows App SDK 最近稳定版是什么？"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      toolGroup: WEB_GROUP,
      behavior: "fresh external information; must use a web read/search tool"
    }));
  });

  // 3. URL policy: 6
  [
    ["U.passive_link", "把 https://developer.mozilla.org/ 这个链接原样发给我，不要打开。", ["open_url", ...NO_WEB], null],
    ["U.literal_url", "不要访问页面，只把这个 URL 当文本解释结构：https://www.python.org/downloads/", ["open_url", ...NO_WEB], null],
    ["U.open_docs", "打开 https://nodejs.org/en/learn", null, ["open_url"]],
    ["U.open_localhost", "打开 http://127.0.0.1:4321/status", null, ["open_url"]],
    ["U.read_exact_page", "读取 https://example.com/ 的页面内容并总结一句。", ["open_url"], ["fetch_url_content", "web_search_fetch", "web_search"]],
    ["U.no_read_bare", "这里有个地址 https://www.iana.org/domains/reserved ，先不要读取，告诉我你会如何处理。", ["open_url", ...NO_WEB], null]
  ].forEach(([id, prompt, mustNot, preferred]) => {
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      ...(mustNot ? { toolMustNotInclude: mustNot } : {}),
      ...(preferred ? { preferredTools: preferred } : {}),
      behavior: "URL intent policy: distinguish passive text, explicit open, and exact read"
    }));
  });

  // 4. Browser/page context: 6
  const browserPage = [
    "Audit Console Page",
    "The current page shows three failed tasks: artifact preview leak, email approval stuck, and scheduler popup missing.",
    "A note says Ctrl+Shift+Space should carry selected text into overlay."
  ].join("\n");
  [
    ["B.explain_page", "解释当前页，并列出最重要的两个风险。"],
    ["B.page_action_items", "基于当前页面，提取 action items。"],
    ["B.page_vs_question", "当前页里哪个问题和 artifact contract 最相关？"],
    ["B.page_zh_summary", "把当前页面总结成中文三条。"],
    ["B.page_no_web", "只根据当前页，不联网，判断最可能的 P0 是什么。"],
    ["B.page_email_issue", "当前页里邮件相关问题是什么？"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      toolMustNotInclude: NO_WEB,
      textMustInclude: ["artifact", "email", "scheduler", "Ctrl+Shift+Space"],
      behavior: "browser context handoff should answer from supplied page text"
    }, { sourceType: "browser", pageText: browserPage }));
  });

  // 5. Clipboard/selection context: 5
  [
    ["S.selected_text_summary", "解释我选中的这段文字。", "Selected text: Contract finalization must not report success when required artifacts are missing."],
    ["S.selected_file_hint", "根据选中的内容告诉我要打开哪个文件。", "Selected file path: E:\\linxi\\internal\\UPGRADE_PLAN.md"],
    ["S.selected_code_review", "看一下选中的代码片段有什么问题。", "function done(result){ return { status: 'success', artifact: null }; }"],
    ["S.selected_url_policy", "这段选中文本里有 URL，但不要访问，只解释意图。", "Please send me this link, do not open it: https://example.net/audit"],
    ["S.selected_chinese", "把我选中的内容改写成一句更清晰的中文。", "生成文件任务结束时没有可用文件，但 UI 还显示正在处理。"]
  ].forEach(([id, prompt, contextText]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      toolMustNotInclude: NO_WEB,
      behavior: "selected text/file context must be attached to the current task"
    }, { sourceType: "clipboard", contextText }));
  });

  // 6. Local file/RAG: 8
  [
    ["L.product_notes", "读取附件里的 product notes，列出两个高风险区域。", [fixture("audit-product-notes.txt")]],
    ["L.meeting_notes", "读取会议纪要，提取 owner、goal、follow-up。", [fixture("audit-meeting-notes.md")]],
    ["L.budget_csv", "读取 CSV，找出 high risk 的 area。", [fixture("audit-budget.csv")]],
    ["L.release_plan", "读取 release plan，按里程碑生成 checklist。", [fixture("audit-release-plan.txt")]],
    ["L.multi_file_compare", "读取这些文件，比较 product notes 和 release plan 的共同点。", [fixture("audit-product-notes.txt"), fixture("audit-release-plan.txt")]],
    ["L.folder_budget", "读取附件文件夹里的可读文本，按风险排序输出。", [fixture("audit-product-notes.txt"), fixture("audit-budget.csv")]],
    ["L.local_to_summary", "只用本地附件，写一段 120 字以内的项目状态摘要。", [fixture("audit-meeting-notes.md"), fixture("audit-release-plan.txt")]],
    ["L.local_no_web", "不要联网，基于附件说明为什么 preview isolation 重要。", [fixture("audit-product-notes.txt")]]
  ].forEach(([id, prompt, filePaths]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      toolMustIncludeOneOf: FILE_READ_ONE_OF,
      allowFileIngestEvidence: true,
      noFailedTools: true,
      toolMustNotInclude: NO_WEB,
      behavior: "attached local files should be read as evidence, with no accidental web use"
    }, { filePaths }));
  });

  // 7. Artifact generation: 12
  [
    ["A.docx_latency", "写一个 docx：桌面 AI 助手如何降低首字输出延迟，包含 3 个小节。", "docx"],
    ["A.docx_local", "读取附件并生成 docx 审计摘要，包含风险表。", "docx", { filePaths: [fixture("audit-product-notes.txt")] }],
    ["A.xlsx_budget", "生成 xlsx 表格：功能、风险、验证方式，至少 5 行。", "xlsx"],
    ["A.xlsx_from_csv", "读取附件 CSV 并生成 xlsx，增加一列 mitigation。", "xlsx", { filePaths: [fixture("audit-budget.csv")] }],
    ["A.pptx_plan", "生成 5 页 pptx，主题是 Finch-14 升级路线。", "pptx"],
    ["A.pptx_observability", "生成 pptx：为什么要做 token waterfall 和 timeline。", "pptx"],
    ["A.pdf_checklist", "生成 PDF：桌面 GUI 验证 checklist。", "pdf"],
    ["A.pdf_voice", "生成 PDF：语音笔记质量评估方案。", "pdf"],
    ["A.html_trace", "生成 HTML 报告：任务 trace timeline 示例。", "html"],
    ["A.html_approval", "生成 HTML：审批流状态机说明。", "html"],
    ["A.research_docx", "联网查一下 Playwright 最近稳定版信息，并生成 docx 测试计划。", "docx", { needsWeb: true }],
    ["A.research_xlsx", "查找 Vitest 和 Playwright 的用途差异，生成 xlsx 对比表。", "xlsx", { needsWeb: true }]
  ].forEach(([id, prompt, kind, extra = {}]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      mustHaveArtifact: true,
      artifactKind: kind,
      ...(extra.needsWeb ? { toolGroup: WEB_GROUP } : {}),
      behavior: "artifact-required task must produce a real file of the requested kind"
    }, extra));
  });

  // 8. Artifact recovery/preview isolation: 6
  [
    ["R.no_fake_success", "生成 docx：如果文件没有创建成功，请明确失败，不能只给文字说明。", "docx"],
    ["R.preview_isolation_a", "生成一个 html，标题是 Preview Isolation A，正文只包含 A 任务。", "html"],
    ["R.preview_isolation_b", "生成一个 html，标题是 Preview Isolation B，正文只包含 B 任务。", "html"],
    ["R.partial_recovery_docx", "请输出 word 文件，不要只回答文本：主题是 artifact recovery contract。", "docx"],
    ["R.pdf_no_stale", "生成 PDF，标题必须是 Fresh Artifact Report。", "pdf"],
    ["R.xlsx_no_stale", "生成 xlsx，第一列是 Case，第二列是 Expected Outcome。", "xlsx"]
  ].forEach(([id, prompt, kind]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      mustHaveArtifact: true,
      artifactKind: kind,
      behavior: "artifact recovery and preview isolation: no stale preview and no prose-only success"
    }));
  });

  // 9. Email live-write + approval: 8 (blocked until approval auto-driver exists)
  [
    ["E.email_plain", "给 {{AUDIT_EMAIL_TO}} 发一封测试邮件，主题包含 {{AUDIT_MARKER}}，正文说明这是功能审计。"],
    ["E.email_summary", "读取附件并把摘要邮件发送给 {{AUDIT_EMAIL_TO}}，主题 {{AUDIT_MARKER}} local summary。", { filePaths: [fixture("audit-meeting-notes.md")] }],
    ["E.email_attachment", "生成一份 html 审计摘要并作为附件发给 {{AUDIT_EMAIL_TO}}，主题 {{AUDIT_MARKER}} attachment。"],
    ["E.email_reject_path", "准备发送邮件给 {{AUDIT_EMAIL_TO}}，主题 {{AUDIT_MARKER}} reject path，等待确认。", { liveWrite: { kind: "email", approvalDecision: "reject" } }],
    ["E.email_duplicate_guard", "给 {{AUDIT_EMAIL_TO}} 发送邮件，不要只起草；正文写：这是功能审计重复状态测试。确认后不要显示重复的 partial success，主题 {{AUDIT_MARKER}} duplicate guard。"],
    ["E.email_long_body", "给 {{AUDIT_EMAIL_TO}} 发送邮件，不要只起草；主题 {{AUDIT_MARKER}} long body，正文列出 5 条升级建议。"],
    ["E.email_account_route", "用已连接邮箱发送给 {{AUDIT_EMAIL_TO}}：{{AUDIT_MARKER}} account route。"],
    ["E.email_terminal_state", "发测试邮件给 {{AUDIT_EMAIL_TO}}，主题 {{AUDIT_MARKER}} terminal state，发送后原任务必须结束。"]
  ].forEach(([id, prompt, extra = {}]) => {
    const liveWrite = extra.liveWrite ?? { kind: "email" };
    const cleanExtra = { ...extra };
    delete cleanExtra.liveWrite;
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      preferredTools: [
        "account_send_email",
        "send_email_smtp",
        "google.gmail.draft_confirm_send",
        "google.gmail.send_email",
        "microsoft.outlook.draft_confirm_send",
        "microsoft.outlook.send_email"
      ],
      behavior: "real email write requires approval auto-driver and original task terminal-state verification"
    }, { ...cleanExtra, liveWrite }));
  });

  // 10. Calendar live-write + timezone: 8 (blocked until approval auto-driver exists)
  [
    ["C.calendar_relative", "创建日历事件：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} relative，明天下午 3 点 30 分，30 分钟。"],
    ["C.calendar_timezone", "创建 Google 日历事件：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} timezone，2026-05-12 09:00 America/New_York，45 分钟。"],
    ["C.calendar_all_day", "创建全天日历事件：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} all day，下周一。"],
    ["C.calendar_attendee", "创建会议：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} attendee，明天上午 10 点，邀请 {{AUDIT_EMAIL_TO}}。"],
    ["C.calendar_location", "创建日历事件：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} location，后天 14:00，地点 Zoom。"],
    ["C.calendar_description", "创建日历事件：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} description，明晚 8 点，描述写功能审计。"],
    ["C.calendar_ms_route", "用已连接 Google 日历创建事件：{{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} provider route，三天后 11 点。"],
    ["C.calendar_terminal", "创建测试日历事件 {{AUDIT_CALENDAR_PREFIX}} {{AUDIT_MARKER}} terminal，确认后原任务必须结束。"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      preferredTools: [
        "account_create_event",
        "google.calendar.create_confirm",
        "microsoft.calendar.create_confirm"
      ],
      behavior: "calendar write must preserve timezone and approval/terminal state"
    }, { liveWrite: { kind: "calendar" } }));
  });

  // 11. Scheduler/notification: 7
  [
    ["N.schedule_5min", "5 分钟后提醒我检查 artifact audit 报告。"],
    ["N.schedule_tomorrow", "明天上午 9 点提醒我跑 GUI hotkey checklist。"],
    ["N.schedule_weekly", "每周五下午 4 点提醒我整理功能审计失败项。"],
    ["N.schedule_run_now", "创建一个 2 分钟后提醒：写入 Run Log。"],
    ["N.schedule_popup", "3 分钟后提醒我看右上角 popup 是否出现。"],
    ["N.schedule_safe_action", "今晚 8 点提醒我备份审计报告，不要执行任何文件写入。"],
    ["N.schedule_list", "列出当前已有的定时任务，按下次运行时间排序。"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      preferredTools: ["create_scheduled_task", "list_scheduled_tasks"],
      behavior: "scheduler creation/listing should route to scheduler tools and surface notification state"
    }));
  });

  // 12. Conversation/follow-up/title: 6
  items.push(mk("T.seed_doc", "生成一个 html，标题是 Conversation Seed Audit，内容是一段短说明。", {
    terminal: SOFT_OK,
    mustHaveArtifact: true,
    artifactKind: "html",
    behavior: "seed task for follow-up continuity"
  }, { seedKey: "conversation_artifact" }));
  [
    ["T.followup_summarize", "继续：把上个结果总结成一句话。"],
    ["T.followup_convert", "继续：如果上个任务有文件，说明它是什么格式。"],
    ["T.followup_title_short", "继续：给这个任务起一个 8 个字以内的标题。"],
    ["T.followup_no_stale", "继续：不要引用其他旧录音笔记，只针对上一条。"],
    ["T.followup_next_steps", "继续：列 3 个下一步。"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      behavior: "follow-up should bind to seed conversation, avoid stale task context, and keep titles short"
    }, { followUpOf: "conversation_artifact" }));
  });

  // 13. Voice/note service path: 5 (service-side prompt path; GUI mic is separate)
  [
    ["V.note_title", "把这段模拟录音文本整理成会议纪要，并生成短标题：今天讨论了 overlay、语音识别和文档生成。"],
    ["V.note_empty_audio", "如果 11 秒录音没有捕捉到有效语音，应该如何向用户解释？"],
    ["V.note_language", "把这段中英混合口述整理成中文笔记：ship the audit harness and fix artifact contract first."],
    ["V.note_compare_input", "说明为什么录音笔记和语音输入可能识别效果不同，给排查 checklist。"],
    ["V.wake_word_plan", "给唤醒词识别太弱的问题写一个测试计划，包含近似发音和误唤醒。"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: SOFT_OK,
      behavior: "voice-note service logic and UX explanation; real microphone/KWS is GUI fixture coverage"
    }));
  });

  // 14. Connector reads: 4
  [
    ["O.mail_list", "列出最近 5 封邮件的主题，只读取不要发送。", ["account_list_emails", "connector_workflow_run"]],
    ["O.mail_search", "搜索邮箱里和 audit 相关的邮件，只返回主题和时间。", ["account_list_emails", "connector_workflow_run"]],
    ["O.calendar_list", "列出未来 7 天日历事件，只读取不要创建。", ["account_list_events", "connector_workflow_run"]],
    ["O.drive_search", "搜索云盘里文件名包含 audit 的文档，只列出名称。", ["account_list_files", "connector_workflow_run"]]
  ].forEach(([id, prompt, preferredTools]) => {
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      preferredTools,
      toolMustNotInclude: ["account_send_email", "account_create_event"],
      behavior: "connector read should not mutate external accounts"
    }));
  });

  // 15. Kimi/code CLI/MCP/skills: 3
  [
    ["K.skill_preview", "预览安装一个 GitHub skill：只预览不要安装，URL 用 https://github.com/openai/codex 。", ["preview_skill_from_github"]],
    ["K.mcp_visibility", "列出当前可用的 MCP 或 connector 能力，并说明哪些适合文件/日历/邮件。", ["connector_plugin_manage"]],
    ["K.kimi_boundary", "如果用户要求用 Kimi 处理代码任务，应该如何通过统一 provider/CLI 框架接入？"]
  ].forEach(([id, prompt, preferredTools = []]) => {
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      ...(preferredTools.length ? { preferredTools } : {}),
      behavior: "Kimi/MCP/skill paths should use shared framework surfaces, not an isolated special-case path"
    }));
  });

  // 16. Failure/cancel/retry semantics: 2
  [
    ["F.clarify_missing_target", "把那个文件处理一下。"],
    ["F.safe_retry_wording", "上一步失败后，给我一个可重试但不重复副作用的下一步建议。"]
  ].forEach(([id, prompt]) => {
    items.push(mk(id, prompt, {
      terminal: ANY_TERMINAL,
      behavior: "ambiguous/failure path should clarify or offer safe retry without unsafe tool calls"
    }));
  });

  if (items.length !== 100) {
    throw new Error(`function audit corpus must contain exactly 100 items; got ${items.length}`);
  }
  return items;
}

export const TEST_CORPUS = buildCorpus();
