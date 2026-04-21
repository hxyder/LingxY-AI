# Console Work Tracker

## 完成记录（按 commit 时间倒序）

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

1. **OAuth Gmail 全文 body 获取**
   - 目前 Gmail snippet 最多 ~200 字符
   - 实现 `GET /connectors/accounts/google/messages/:id?full=true` 单条全文获取
   - Inbox UI 展开时 lazy-load

2. **搜索失败 UI 反馈优化**
   - `attempts[]` 数组已经返回给上层，但 UI 没展示
   - 当所有 providers 都 fetchFailed 时，显示 "网络受限 - 已尝试 4 个搜索源" 明确信息

3. **Schedules 失败任务一键查看日志**
   - sched-row 的 "Last: ... · failed" 可以点击跳转到对应的 failed task 详情
   - 需要 schedule → last_task_id 的字段（后端 dispatch.mjs 已写了 `last_run_status`，但没存 task_id 关联）

4. **邮件详情 HTML 渲染**
   - 目前展开是纯文本 `<pre>`
   - 对有 HTML body 的邮件（多数营销邮件）用 sanitizer 渲染
   - 需要 DOMPurify 依赖

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
