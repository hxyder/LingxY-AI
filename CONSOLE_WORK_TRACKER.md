# Console Work Tracker

## 完成记录（按 commit 时间倒序）

### 2026-04-21（第 13 轮 — 根因三连）

- **UCA-152 (2ab72a0)** — Overlay 显示交互式 scheduler 任务
  - 根因：`isUserVisibleTask` 一刀切过滤 `source_app === "uca.scheduler"` → "Run now" 触发的任务和 interactive-mode schedule 都不出现在浮窗
  - 改：只隐藏 `execution_mode !== "interactive"` 的 scheduler 任务
  - 顺带修好 #3（浮窗图标不显示运行进度）

- **UCA-151 (8e0bf23)** — IMAP monitor 不再循环通知同一封未读邮件
  - 根因：真实 IMAP 客户端的 `markSeen()` 是 no-op；`state.seenByAccount` 永远不填；monitor 每 2 分钟轮询所有未读邮件，对每封重发"新邮件摘要"
  - 改：`markSeen` 写入 `state.seenByAccount`；`listUnread` 过滤已标记 ID；monitor 每次发通知后立即 `markSeen(message.id)`
  - 不碰 IMAP `\Seen` 标志——用户在 Gmail / Outlook / iOS Mail 里自己读就好

- **UCA-150 (929a68a)** — 每个执行器 prompt 都注入当前日期
  - 根因：只有 `tool_using/agent-loop.mjs` 有日期注入，`agentic/prompt-builder.mjs` 和 `kimi/print-mode-prompt.mjs` 都没有；用户 task_139fac63 走的是 agentic → 模型用训练截止（2025）猜
  - 改：三个 executor prompt 统一一条 "Current local date and time: 2026-04-21 12:47:05 (Asia/Shanghai) ..." 行
  - tool_using 从 `toISOString()` (UTC Z) 改为 `toLocaleString("sv-SE")`（YYYY-MM-DD HH:MM:SS 本地）

### 2026-04-21（第 12 轮）

- **UCA-149 (f79e0b2)** — 修回 code_cli 图片路径（撤掉 UCA-148 的错误假设）
  - UCA-148 把 Claude Code / Codex / Kimi Code 一刀切判成"不支持图片" → 拦截了正常的调用流
  - 实际情况：`task-package-builder.mjs` 早就把 image_paths 塞进 context.file_paths 和 image_paths 两处；`print-mode-prompt.mjs:152` 明确告诉 CLI "inspect these image files directly"；每个现代 agentic CLI 都有 Read 工具能打开图片
  - 修法：`providerCanVision()` 对所有 `code_cli` 返 true；auto-switch 只在**显式 supportsVision:false** 或 **Ollama 模型确实没有 vision 层**时才触发
  - UI label 也改：所有 code_cli 显示 👁，(text-only) 标签只留给真正没法看图的
  - 参考历史 commit c7fd2bd（原始实现已走这条路，UCA-148 不小心回退了）

### 2026-04-21（第 11 轮）

- **UCA-148 (1ee9ea8)** — Vision 自动切换覆盖 CLI / Ollama / supportsVision 覆盖
  - 用户反馈"我已经选了 code_cli 作为 vision model"但还是报错 — 因为那个 CLI 是 Kimi Code（文本编程助手），旧的 fallback 只扫 API 类型
  - 统一谓词 `providerCanVision(p)`：Anthropic / 已知 vision baseUrl 的 OpenAI / 白名单 CLI (gemini/codebuddy/qwen) / 已知 vision Ollama model / 显式 `supportsVision: true`
  - `findFallbackVisionProvider()` 5 轮扫描 — 覆盖 → Anthropic → API → CLI → Ollama
  - executor 日志明确报告"从 X 切到 Y"，不再默默替换
  - Settings → Routing → Vision 下拉用 👁 / (text-only) 标记每个 provider，选错时行下方出 ⚠️ 警告

### 2026-04-21（第 10 轮）

- **UCA-147 (4371358)** — 视觉意图正则补齐"图中/图里/图上"
  - 根因：`looksLikeVisionAnalysisIntent("图中的动物是什么")` 之前返回 false → 任务被路由到 tool_using（文本模型）→ 模型只好用 open_file + 承认"我是文本模型看不到图"
  - 扩充覆盖：图(中/里/上/里面/里的) / 图片 / 照片 / 这张图 / 截图 + (是什么/有什么/叫什么/有几个/是谁/写了什么)
  - multi_modal executor 早就有 "无 vision provider 时明确报错" 的兜底（180-215 行），修好 intent 后兜底也能发挥作用
  - 用 11 条正例 + 4 条反例验证过

### 2026-04-21（第 9 轮）

- **UCA-146 (de3aa7c)** — Image artifact inline 预览
  - `readFileAsDataUrl(path, mime)` preload 新 API，5MB 硬上限
  - 支持 png / jpg / jpeg / gif / webp / bmp / svg
  - Tasks 报告面板图片类 artifact 直接 `<img>` 渲染，中性底色框
  - docx / xlsx / pptx / pdf 仍保持"外部打开"占位

- **UCA-145 (c65cd4e)** — Inbox HTML 邮件 sandboxed 渲染 + Rich/Plain 切换
  - 渲染在 `sandbox=""` 的 iframe 里，CSP 阻断外部资源（禁跟踪像素）
  - `referrerpolicy="no-referrer"`
  - 展开头部的 Rich / Plain 切换按钮，选择持会话（`_inboxState.bodyViewMode`）
  - 有 bodyHtml 时默认 Rich，否则 Plain

- **UCA-144 (53a1d52)** — Mail connectors 同时返回 bodyText + bodyHtml
  - Gmail 和 Outlook 的 getXxxMessage 都返回两个字段
  - 提炼 `stripHtmlToText(html)` 共用 helper
  - 为 UCA-145 前端渲染铺数据

### 2026-04-21（第 8 轮）

- **UCA-143 (5b04516)** — Outlook 全文 body 懒加载（对称 UCA-135）
  - `getMicrosoftMessage`：Graph `$select=body` 拉完整 body，HTML contentType 走和 Gmail 一样的 strip+decode 路径
  - 路由合并：`GET /connectors/accounts/(google|microsoft)/messages/:id` 一个 URL 两个 provider
  - 前端 expand 懒加载同时支持两个 provider

- **UCA-142 (d76610d)** — sched-row "failed" 一键跳失败任务
  - failed 状态渲染为点状下划线的 button，点击切 Tasks + select 目标任务
  - 没有 task_id 关联的（pending_approval / dispatcher 侧抛异常）保持普通 span

- **UCA-141 (9165b7a)** — 后端持久化 `last_run_task_id`
  - schedule 记录增加 `last_run_task_id` 字段
  - sqlite schema + ALTER TABLE 启动迁移
  - `updateScheduleAfterRun` 透传 taskId；dispatch.mjs 两个调用点都传

### 2026-04-21（第 7 轮）

- **UCA-140 (84ad900)** — Palette 字段名 + legacy 任务 answer fallback
  - 根因：palette 发 `{ user_command, source_app }`（snake_case），后端要 `{ userCommand, sourceApp }`（camelCase）→ 每次 submit 都被空命令 guard 拦截 → "New task" 点了像没反应
  - 改：改为 camelCase；服务端返回 `ok:false` 或 `clarification_needed` 时在 palette 显示原因而不是静默关闭
  - 顺手：legacy 任务没有 `result_summary` 时，从 `detail.events` 倒序扫最近一个 `inline_result` / `success` 事件的 text payload 作为兜底

- **UCA-139 (ad2f209)** — Digest 去重用本地日期键（修 UTC+8 时区 bug）
  - 根因：`state.lastDigestDate` 存的是 `toISOString().slice(0,10)` = UTC 日期，但 window 是本地时间。中国 06:00 本地 = 22:00 UTC 前一天，摘要存"昨天"。UTC 过零点（本地上午）后重启 → `todayKey` 变成今天 → 对不上状态 → 又跑一次
  - 改：`localDateKey(date)` 用 `getFullYear/getMonth/getDate`，跟 window 同为本地时间
  - 加 `MIN_FIRE_MS = 4h` 内存节流，即使状态文件读不到也不重发

### 2026-04-21（第 6 轮）

- **UCA-138 (364ebba)** — 搜索失败 observation 列出实际尝试的 providers
  - `attempts[]` 数组（UCA-130 引入）现在被格式化到 observation 里 ("Tried: duckduckgo_html, duckduckgo_lite, bing, baidu")
  - 流到 `task.result_summary` → Tasks 详情可见
  - 不再是笼统的 "search unavailable"

- **UCA-137 (b40ae29)** — Task detail 加 .task-answer 块 + 隐藏冗余 artifact 列表
  - `result_summary` 升级为 hero 内的专属 `.task-answer` 块（accent 左条、"Result / 结果"标签、可滚 480px）
  - 单 artifact 任务：artifact 列表和 report 卡片完全重复 → 只保留 report 卡片
  - 多 artifact 任务：列表作为其它文件的索引保留

- **UCA-136 (9e799e5)** — 后端持久化执行器 final_text
  - 根因：搜索 / conversational 任务的 `inlineText` 只活在事件流里，任务结束就丢
  - 改：任务成功且没有 `result_summary` 时，把 inlineText 存进去
  - 应用到 `context-submission` + `browser-submission` 两条路径

### 2026-04-21（第 5 轮）

- **UCA-135 (0810e45)** — Gmail 全文 body 懒加载
  - 新增 `getGoogleMessage(runtime, account, messageId)`：`format=full` + MIME 树遍历；优先 text/plain，回退 text/html（strip tags + 解实体）
  - 新端点 `GET /connectors/accounts/google/messages/:id`
  - 前端 `_inboxState.fullBodyCache` 按 email id 缓存，点开时单次拉取、后续命中缓存
  - IMAP 早就返回全文 bodyText，这轮只补 Gmail

- **UCA-134 (8cf84b1)** — Task 报告自动预览 v2（提升为 Artifacts 面板焦点元素）
  - 上一轮 (UCA-133) 虽然加了 auto-preview，但预览 `<pre>` 在 artifact list **下方**，多数人要滚过 3-8 行才看到，看起来就像没工作
  - 重构：Artifacts 面板最上面是一张独立的 **report 卡片**（文件图标 + 名字 + 路径 + 操作按钮组 + 下方 preview），列表落在下方做"其它产物索引"
  - preview 读取上限从 1200 → 3000 字符，mono 字体，max-height 420px 可滚
  - 自动选择也走 `selectTaskArtifact` 了，和手动点击走同一路径——loading state 一致
  - `loadArtifactPreviewText` 返回 `{ text, kind }`，CSS 能区分 loading / external-only / 正常态

### 2026-04-21（第 4 轮）

- **UCA-133 (a3a1074)** — IMAP 预览缓存 + Task 报告自动预览
  - `/config/email/accounts/:id/messages` 结果按 `(accountId, limit)` 在 runtime 上缓存 10 秒；显著提速账户切换
  - Inbox 刷新按钮带 `?refresh=1` 强制绕过缓存
  - 打开带产物的任务时，主产物内容自动 load 到 preview 窗格 — 这就是最简版的"任务报告弹窗"：报告已经在原地，点任务就看到，不需要新窗口
  - 抽 `loadArtifactPreviewText` 为独立 helper，避免递归

- **UCA-132 (03e8bac)** — 修 morning digest 重复触发
  - 根因：`state.lastDigestDate = todayKey` 在所有工作（writeFile / notify）**之后**才写。任一步失败 → 状态没保存 → app 重启在窗口内就又跑一次
  - 改为**通过 guard 后立即保存状态**，再做后续工作；失败也不会今天再跑
  - 加 in-memory WeakMap 并发锁，双调用并发也不会双发
  - 返回值加了更多诊断字段（reason / lastDigestDate / windowStart / windowEnd）

### 2026-04-21（第 3 轮）

- **UCA-131 (565fccb)** — Inbox 邮件点击内联展开正文
  - IMAP `listRecent` 同时返回 preview（120ch，列表 meta 用）和 bodyText（4000ch，展开用）
  - Gmail 解析 `"Name <addr>"` 头 → 拆成 `from` + `fromName`；`message.snippet` 同时填到 preview + bodyText
  - Outlook `bodyPreview` 别名为 bodyText，跟 IMAP / Gmail 字段一致
  - UI：点击展开/折叠；切账户或切 tab 自动折叠；无正文时友好 placeholder

- **UCA-130 (edb5b03)** — 搜索 Bing + Baidu fallback
  - cascade: `DDG HTML → DDG Lite → (Bing | Baidu) → (Baidu | Bing)`
  - 中文查询把 Baidu 放前面，英文查询把 Bing 放前面（CJK 正则检测）
  - 返回 `attempts[]` 诊断数组让 LLM 能看到每个 provider 的尝试结果
  - 无新依赖 — 沿用现有 fetch + 最小正则 parser 模式

### 2026-04-21（第 2 轮）

- **UCA-129 (7aa5111)** — Inbox IMAP + Schedules last-run + console cleanup
- **UCA-128 (78eee6a)** — IMAP mail preview endpoint (imapflow)
- **docs (7d13b5f)** — 本文件

### 2026-04-21（第 1 轮）

- **UCA-125 (c3745ba)** — Console v3 对齐（page-head, btn system, Tasks detail split, Inbox tab）
- **overlay (3dbd8c8)** — glass token routing
- **chore (c4f9e7f)** — 删 3 份旧 upgrade notes

## 下一轮建议（按价值排序）

1. **任务需要用户确认时 / 任务执行完，主动弹浮窗** (issues #4 + #5 deferred from round 13)
   - 当前：approval 只出现在 Schedules → Pending Approvals 区；任务完成只更新 overlay dock（需要用户已打开 overlay）
   - 用户期望：approval 和 completion 都能直接弹出一个可点击的小窗/通知，点击可看详情或关闭
   - 现成基础：`runtime.actionToolRegistry.get("notify")` 已能发 Windows 原生通知；console 里 `switchTab("tasks") + selectedTaskId` 已能定位详情
   - 拟议方案：
     - 服务端检测 `pending_approval_created` 和任务 success/failed 事件 → 调 notify tool，通知里 body 带 taskId / approvalId
     - Electron shell 接收 notification 点击 → `ipcRenderer.send("shell-navigate-console")` 打开 console 并 select task
     - 无需新窗口；重用已有 ipcMain handler 和 console 的导航入口

2. **PDF artifact inline 预览**
   - UCA-146 完成了图片；PDF 还没做
   - Electron 默认不启用 PDF viewer；可以嵌 `<embed src="data:application/pdf;..." type="application/pdf">` 或打包 PDF.js
   - 测试后决定是否打 PDF.js 依赖

3. **Schedules failed 一键 retry**
   - 现在从 failed 状态点进去可以看到 task 详情，但要再点 Retry
   - 在 sched-row 的失败行上直接加 retry 图标按钮
   - 复用 `POST /schedules/:id/runs` 端点

4. **数据库备份 / 恢复 UI**
   - Settings 页加"Export data" / "Restore from backup"
   - 导出 sqlite 文件 + email credential store + config snapshot 成 zip
   - 恢复时校验 schema version 对得上

4. **Task 详情 Run log 面板**
   - v3 设计里有一个"实时日志流"黑底 log-frame 面板
   - 我们只有 Timeline（结构化事件）
   - Run log 让开发/调试场景更高效 — 但要 streaming LLM output 适配

## 未提交（Phase 7c 在途工作，保留给用户决定）

- `browser_ext/*` (service-worker / selection-cache / popup / floating-chip)
- `office_addin/*` (icons + task_pane)
- `scripts/verify-{chat-composer,external-surfaces,foldable-sections,schedule-grouping}.mjs`
- `TASK_PIPELINE_ORCHESTRATION_UPGRADE.md`
- `"LingxY Console v3.html"` (设计参考)

## 诊断记录（不修的已知问题）

- **A1** · 用户之前"Email inbox 卡片在 image 1 里没看到"：卡片在 Connectors 页，用户当时看的是 Inbox 页。渲染链路无 bug。
- **A2** · 搜索失败 → 已在 UCA-130 修
