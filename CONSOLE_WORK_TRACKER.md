# Console Work Tracker

## 完成记录（按 commit 时间倒序）

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

1. **任务报告弹窗**（B2，一直推迟）
   - 用户原话："任务运行，涉及到执行某些内容，如何弹出窗口。比如报告之类的"
   - 需要先回答 4 个设计问题（见 tracker 历史）
   - 个人倾向：**最小 MVP** = 任务成功且有 primary artifact 时，在 Tasks 详情底部自动展开 artifact preview + 加一个"在文件管理器打开"按钮。如果 artifact 是 HTML/Markdown/PDF，直接 openPath；如果是 docx/xlsx/pptx，用 shell.openPath 调用系统默认程序。
   - 不需要独立 Electron 窗口 — shell.openPath 已经够用

2. **IMAP 连接池 / 缓存**
   - 目前每次 `listRecent` 都开新 TLS 连接，163/QQ 尤其慢（~2-3s）
   - 加个 10 秒 TTL Map + LRU，显著提速切账户体验

3. **OAuth Gmail 全文 body 获取**
   - 目前 Gmail snippet 最多 ~200 字符
   - 实现 `GET /connectors/accounts/google/messages/:id?full=true` 单条全文获取
   - Inbox UI 展开时 lazy-load

4. **搜索失败 UI 反馈优化**
   - `attempts[]` 数组已经返回给上层，但 UI 没展示
   - 当所有 providers 都 fetchFailed 时，显示 "网络受限 - 已尝试 4 个搜索源" 明确信息

5. **Schedules 失败任务一键查看日志**
   - sched-row 的 "Last: ... · failed" 可以点击跳转到对应的 failed task 详情
   - 需要 schedule → last_task_id 的字段（后端 dispatch.mjs 已写了 `last_run_status`，但没存 task_id 关联）

6. **邮件详情 HTML 渲染**
   - 目前展开是纯文本 `<pre>`
   - 对有 HTML body 的邮件（多数营销邮件）用 sanitizer 渲染
   - 需要 DOMPurify 依赖

## 未提交（Phase 7c 在途工作，保留给用户决定）

- `browser_ext/*` (service-worker / selection-cache / popup / floating-chip)
- `office_addin/*` (icons + task_pane)
- `scripts/verify-{chat-composer,external-surfaces,foldable-sections,schedule-grouping}.mjs`
- `TASK_PIPELINE_ORCHESTRATION_UPGRADE.md`
- `"LingxY Console v3.html"` (设计参考)

## 诊断记录（不修的已知问题）

- **A1** · 用户之前"Email inbox 卡片在 image 1 里没看到"：卡片在 Connectors 页，用户当时看的是 Inbox 页。渲染链路无 bug。
- **A2** · 搜索失败 → 已在 UCA-130 修
