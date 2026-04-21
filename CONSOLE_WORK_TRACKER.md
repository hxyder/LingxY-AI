# Console Work Tracker

## 本轮（2026-04-21）完成清单

### ✅ 已完成并 commit

- **UCA-128 (78eee6a)** — IMAP 邮件预览后端
  - `imap-client.mjs` 用 imapflow 接通真实 IMAP；新增 `listRecent(limit)` 方法
  - Gmail / Outlook / QQ / 163 默认 host 内置；其它走 `account.imapHost`
  - `GET /config/email/accounts/:id/messages?limit=N` 端点
  - 软失败（凭证缺失 / 连接拒绝）返回 `{ messages: [], reason }`
  - `imapflow` 作为运行时依赖装入

- **UCA-129 (7aa5111)** — 前端消费 + Schedules last-run + 清理
  - Inbox IMAP 账户改走新端点，软失败时展示 reason 而非空白
  - sched-row 加 "Last: <时间> · <状态>" 一行，status 按 ok/failed 着色
  - 删掉 console.html 顶部 ~100 行 inline CSS（和 shared.css 重复的死代码）

### ⚠️ 诊断结果（本轮不改）

- **A1 · "Email inbox 卡片在 image 1 里没看到"**
  - 原因：截图是 **Inbox tab**，email inbox 卡片是 **Connectors tab**。不同页面。
  - 检查了渲染链路：`renderConnEmailAccounts` → `#connEmailList` → `conn-grid conn-grid--compact` → cards.innerHTML。链路无 bug。
  - 用户切到 Connectors 就应该能看到 4 列紧凑卡片。

- **A2 · 搜索任务失败**
  - 根因：`free-search.mjs` 只走 DuckDuckGo HTML + DDG Lite，两个都被 bot-detection 挡住后整体失败
  - 已识别为"网络连通问题"（`fetchFailed: true`），LLM 收到 "Web search unavailable" 通知
  - **未修** — 需要引入 Bing/Baidu fallback 或接入 Brave Search API key。功能增量，单独一轮做

### 💤 推迟（需要设计讨论）

- **B2 · 任务执行报告弹窗**
  - 用户原话："任务运行，涉及到执行某些内容，如何弹出窗口。比如报告之类的"
  - 需要回答：
    1. 是 Electron 独立 BrowserWindow 还是主窗口内的模态？
    2. 报告是 HTML / Markdown / PDF 预览？
    3. 只在任务完成时弹，还是任务运行中也弹流式？
    4. 用户能否 pin / resize / 拖拽？
  - 现有能力：`window.ucaShell.openPath(path)` 能打开任意文件，`revealInFolder` 能在文件夹里高亮。如果报告是落盘的 HTML / PDF，已经能用 openPath。
  - 但"实时弹出报告窗口"（比如日程执行完后弹一个 LingxY 内置窗口）是新 Electron shell 工作

## 下一轮建议（按价值排序）

1. **搜索失败修复**（A2）— 加 Bing 或 Baidu fallback，~100 行改动；影响很多任务的正确性
2. **任务报告弹窗**（B2）— 先讨论设计方向，再写 shell 代码
3. **Connectors 合规性**：Connectors 页面第一次访问时自动滚到顶端，页内 hash 锚点支持（`#connEmail`, `#connMcp`）
4. **IMAP 连接池** — 目前每次 listRecent 都开新连接。如果用户频繁切账户，会慢。可以加个 10 秒 TTL 的连接缓存
5. **邮件详情视图** — 点 `.inbox-item` 打开完整邮件正文 + HTML rendering（`mailparser` 解析）

## 未提交（Phase 7c 在途工作，保留给用户决定）

- `browser_ext/*`
- `office_addin/*`
- `scripts/verify-{chat-composer,external-surfaces,foldable-sections,schedule-grouping}.mjs`
- `TASK_PIPELINE_ORCHESTRATION_UPGRADE.md`
- `"LingxY Console v3.html"` — 设计参考文件
