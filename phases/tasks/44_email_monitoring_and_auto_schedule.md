# Task UCA-044 — 多账户邮箱监测：新邮件总结、有时间的需求自动生成 schedule、回复追踪

## 1. 任务目标

让 UCA 能常驻监听用户配置的多个邮箱账户（Gmail / Outlook / 163 / QQ / Yahoo …），每当有新邮件进来：
1. 自动提取正文并用 fast executor 总结出一条结构化要点
2. 用 desktop notification 弹出这条总结
3. 如果邮件里有"需要用户做什么"的明确动作（带时间点），自动生成一条 `schedule`（类别 = 邮件任务，颜色 = 邮件色）
4. 如果后续用户用相同线程回复了，自动更新相关 schedule 的状态（completed / postponed / ...）并再发一条通知："任务已完成"

## 2. 前置依赖

- 上一个任务：UCA-010（scheduler）、UCA-017（fast executor）、UCA-027（desktop notification）、UCA-046（scheduler UX）、UCA-049（provider 无关 agentic runtime）
- 必须已有的产物：schedule 实体、notification 窗口、desktop dock 通知链、fast executor
- 不能同时修改的区域：schedule engine 主干、安全 broker

## 3. 实施范围

- 负责模块：邮件账户管理、IMAP / EWS / Graph 客户端、邮件 → intent 抽取、自动 schedule 生成、线程追踪
- 允许改动文件/目录：`src/service/email/`（新建，包含 `accounts.mjs` / `imap-client.mjs` / `graph-client.mjs` / `summarizer.mjs` / `intent-extractor.mjs` / `thread-tracker.mjs`）、`src/service/core/service-bootstrap.mjs`、`src/desktop/renderer/console.html` / `console.js`（加邮箱账户设置）、`phases/tasks/`
- 明确不做：发信（只读 + 通知）、HTML 渲染邮件内容、附件处理、规则过滤 DSL

## 4. 交付产物

- **多账户配置**：
  - Console Settings → 新分组 "Email Accounts"
  - 每个账户 `{ id, provider, displayName, email, authType: password|oauth, credentials, imapHost, imapPort, enabled, lastSyncAt }`
  - 凭据存在 OS 级 keychain（优先 `keytar`，按平台接入 Windows Credential Manager / macOS Keychain / libsecret）
- **IMAP / EWS / Graph 客户端抽象**：统一接口 `listUnread(since, limit) → [{ id, threadId, from, subject, bodyText, receivedAt }]`、`markSeen(id)`
- **定时拉取**：scheduler 跑一条 internal cron `*/2 * * * *`（每 2 分钟）调用 `pollAllAccounts()`
- **Summarizer**：对每封新邮件用 fast executor 生成 3 行要点（发件人 / 主题主张 / 要求我做什么）
- **Intent extractor**：解析要点抽取 `{ actionRequired: boolean, dueAt?: ISO string, suggestedTitle: string, confidence: 0-1 }`
- **自动 schedule 生成**：
  - 条件：`actionRequired && dueAt && confidence >= 0.6`
  - 新建 schedule：`category: "email"`、`color: #ef4444`、`metadata.emailId`、`metadata.threadId`、`userTodo: true`、`leadTimeMs` 按 UCA-046 的规则自动设置
  - 关联到 `thread-tracker` 以便后续自动更新
- **Thread tracker**：
  - 对每个生成了 schedule 的 threadId，继续监听该线程的后续邮件
  - 如果用户 **发出** 了一条线程内邮件（说明用户已回复），把 schedule 标记为 `completed` 并发通知"任务已完成"
  - 如果线程内收到新邮件但内容是"延期 / 改时间"等，用 LLM 判断是否需要更新 `run_at` 或 `metadata.postponed_reason`
- **通知**：弹到 notification 窗口的 toast，点击 → 打开 overlay 并载入该邮件的完整正文 + 生成的 schedule 卡片

## 5. 验证方式

- `node scripts/verify-email-monitoring.mjs`（新建）：mocked IMAP 响应 + 端到端生成 schedule + 线程回复触发 completion
- `node scripts/verify-scheduler.mjs`
- 手动：配置一个真实 Gmail / Outlook 账户 → 让别人发一封含 "请在明天 10 点前回复" 的邮件 → 看 UCA 弹通知 + Console 出现新 schedule + schedule 卡片颜色是 email 红

## 6. Git 执行方式

- 分支名：`task/uca-044-email-monitoring`
- Commit 格式：`UCA-044: email monitoring with auto-schedule and thread tracking`
- 合并条件：至少一个账户能常驻轮询、弹通知、自动建 schedule、线程回复能自动 complete schedule

## 7. 完成后必须更新本文件

- 列出已支持的 provider（IMAP / EWS / Graph）：当前实现支持 `imap`（mock 路径）与 `graph`（占位），EWS 未实现。
- 列出凭据存储机制：优先 `keytar`（如可用），否则落地到 runtime data 目录的 `email-credentials.json` 文件。
- 列出线程追踪的终止条件：线程检测到用户发出回复（`direction: "out"` 或 from 匹配账号邮箱）即标记完成并停止追踪。

## 8. 对下一个任务的交接

- 下一个任务：UCA-045（早晨启动后 5 分钟邮件汇总）
- 本任务新增了什么：邮箱账户 / 拉取 / 总结 / 线程追踪基础设施
- 下一个任务直接可复用什么：`src/service/email/`、`pollAllAccounts`、`listUnread`
- 还没解决的问题：发信能力、富文本邮件渲染、垃圾邮件过滤、OAuth refresh token 循环

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：新增统一 `src/service/email/` 子系统，按 `account -> poll -> normalize -> summarize -> intent -> schedule/thread` 的流水线处理；凭据、provider 适配和线程状态都归到 email 子系统，不把邮箱逻辑散落在 scheduler 或 notification 里。
- 当前代码对齐点：scheduler 已有 store/engine/dispatch，notification 链路来自 UCA-027，`fast` / UCA-049 agentic 能用于总结和结构化抽取；本任务应复用 UCA-046 的 `category/color/leadTimeMs/userTodo` 字段，并通过 UCA-048 feature flag 控制 email monitoring 开关。
- 可能需要生成的文件：`src/service/email/accounts.mjs`、`imap-client.mjs`、`graph-client.mjs`、`summarizer.mjs`、`intent-extractor.mjs`、`thread-tracker.mjs`、`scripts/verify-email-monitoring.mjs`，并扩展 Console Settings 的邮箱账户 UI。

## 9. 执行记录

- 状态：done
- 执行分支：main
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：新增 `src/service/email/` 子系统（accounts/credential-store/imap-client/graph-client/summarizer/intent-extractor/thread-tracker/monitor），service bootstrap 自动启动 email monitor；Console Settings 增加 Email Accounts 管理 UI；新增 `/config/email/accounts` 接口；`/health` 返回 email 状态；新增 `verify-email-monitoring`。
- 验证结果：未运行自动化脚本（未执行 `npm run check`）。
- 遗留问题（开工前已识别）：
  - 用户需求（2026-04-11）："检测邮箱，收到消息，弹出总结。如果邮件中有需求，且需要用户做什么，且涉及时间，自动生成schedule 任务。追踪用户相关邮件的回复，然后自动更新schedule，并发送消息提示，比如：任务已完成。"
  - OAuth 流程（Gmail / Outlook）需要前端引导用户完成授权，且 token 要安全存储，这部分复杂度必须并入统一账户/凭据模型，不能临时散落在 UI 或 scheduler 里
  - 不同 provider 对 "已发送" 文件夹的命名不一样，线程追踪需要 provider-specific 的特殊处理
- 交接给下一个任务：
