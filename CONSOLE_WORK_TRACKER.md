# Console Work Tracker

## 完成记录（按 commit 时间倒序）

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

1. **Schedules 失败任务一键查看日志**
   - sched-row 的 "Last: ... · failed" 可以点击跳转到对应的 failed task 详情
   - 需要 schedule → last_task_id 的字段（后端 dispatch.mjs 已写了 `last_run_status`，但没存 task_id 关联）

2. **Outlook 全文 body 获取**（对称 UCA-135）
   - 目前只有 ~255 字符 `bodyPreview`
   - Graph `$select=body` 能拿完整 HTML body
   - 实现 `getMicrosoftMessage(runtime, account, messageId)` + 路由

3. **邮件详情 HTML 渲染**
   - 目前展开是纯文本 `<pre>`
   - Gmail html→text 在 UCA-135 做了 strip，但长 HTML 邮件效果一般
   - 对有 HTML body 的邮件用 sanitizer 渲染（需要 DOMPurify）

4. **Task 产物预览扩展**
   - 当前只对文本型 artifact（md / txt / json / csv / html）能 inline preview
   - 图片可以直接 `<img>` 渲染，PDF 嵌 `<embed>` 或 PDF.js
   - docx / xlsx / pptx 只能靠 `shell.openPath` 外部打开

5. **Task 产物预览扩展**
   - 当前只对文本型 artifact（md / txt / json / csv）能 inline preview
   - 对图片、PDF 可以：图片直接 `<img>` 渲染，PDF 嵌 `<embed>` 或 PDF.js
   - 对 docx / xlsx / pptx 只能靠 `shell.openPath` 外部打开

## 未提交（Phase 7c 在途工作，保留给用户决定）

- `browser_ext/*` (service-worker / selection-cache / popup / floating-chip)
- `office_addin/*` (icons + task_pane)
- `scripts/verify-{chat-composer,external-surfaces,foldable-sections,schedule-grouping}.mjs`
- `TASK_PIPELINE_ORCHESTRATION_UPGRADE.md`
- `"LingxY Console v3.html"` (设计参考)

## 诊断记录（不修的已知问题）

- **A1** · 用户之前"Email inbox 卡片在 image 1 里没看到"：卡片在 Connectors 页，用户当时看的是 Inbox 页。渲染链路无 bug。
- **A2** · 搜索失败 → 已在 UCA-130 修
