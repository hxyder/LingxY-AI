# Phase 1a — 最小闭环

> 周期估计：W3–W8（6 周） · 角色：1 桌面 + 1 后端 + 0.5 UX
> 上一阶段：[Phase 0](phase_0_definition.md) · 下一阶段：[Phase 1b](phase_1b_file_capability.md)

## 1. 目标

**用最少的入口和最少的功能跑通"输入 → 任务 → 产物"全链路**。
不追求好看，不追求覆盖，不追求"灵活"。只追求一件事：

> 用户从托盘按 `Ctrl+Shift+Space` → 弹出固定悬浮窗 → 输入"总结剪贴板" → 看到流式结果 → 在控制台中能找到这次任务记录。

跑通了 = Phase 1a 完成。其它都是后续 Phase 的事。

## 2. 范围

### 2.1 必做（核心闭环）

| # | 模块 | 范围 |
|---|---|---|
| 1 | 系统托盘 | 启动器、退出、打开主控制台、Kill switch |
| 2 | 全局快捷键 | `Ctrl+Shift+Space` 唤起浮窗、可配置 |
| 3 | 固定悬浮窗 | 屏幕右下角，可拖、可折叠，**不**跟随光标 |
| 4 | 剪贴板读取 | 点击浮窗"读取剪贴板"按钮即抓取文本 |
| 5 | Local Service | 单进程，包含 Intent Router、Task Queue、SQLite、Executor Registry |
| 6 | Intent Router (规则版) | 只支持 4 个意图：`summarize` `translate` `rewrite` `explain` |
| 7 | Fast Executor | 调用云端 LLM(默认 Claude Haiku) 流式返回 |
| 8 | Kimi Bridge (skeleton) | 占位实现，能 spawn 子进程、传 JSON、收事件即可，不接真实 Kimi |
| 9 | 任务中心(最小版) | 一个表格：任务 ID / 命令 / 状态 / 创建时间 / 打开详情 |
| 10 | 任务详情页 | 命令、ContextPacket JSON、TaskEvent 时间线、产物路径 |
| 11 | SQLite 持久化 | tasks / task_events / artifacts 三张表 |

### 2.2 不做

- 文件入口（Phase 1b）
- 浏览器扩展（Phase 1c）
- 跟随浮标
- Office / PDF
- 失败分类、重试、取消（Phase 2）
- 隐私脱敏（Phase 2.5）
- 多任务并发优化（Phase 2）
- 自定义动作模板（Phase 6）

### 2.3 范围红线
**任何超出 §2.1 的"顺手做了"都禁止**。Phase 1a 不是"完整 MVP"，是"贯通验证"。

## 3. 架构

### 3.1 进程拓扑（精简版）

```
┌──────────────────────────────────┐
│  uca-tray (Electron Main)         │
│  - 托盘                            │
│  - BrowserWindow: overlay         │
│  - BrowserWindow: console         │
└────────────┬─────────────────────┘
             │ ipcMain ↔ ipcRenderer
             │
             │ child_process.fork
             ▼
┌──────────────────────────────────┐
│  uca-service (Node 子进程)         │
│  ┌─────────────┐ ┌─────────────┐ │
│  │ HTTP server │ │ JSONL stdin │ │
│  │ (localhost) │ │ for tray IPC│ │
│  └─────────────┘ └─────────────┘ │
│  - SQLite (better-sqlite3)        │
│  - TaskQueue (in-memory + WAL)    │
│  - IntentRouter (rule-based)      │
│  - FastExecutor (LLM SDK)         │
│  - KimiBridge (stub)              │
└──────────────────────────────────┘
```

**Phase 1a 暂时不引入 Native Helper**。全局快捷键用 Electron 的 `globalShortcut`，剪贴板用 `clipboard`，都是 Electron 自带能力。

### 3.2 关键技术决策

| 项 | 选择 | 理由 |
|---|---|---|
| 桌面框架 | Electron 28+ | 团队熟悉、生态成熟 |
| 数据库 | better-sqlite3 | 同步 API、零配置、WAL 模式 |
| IPC（tray ↔ service） | child_process fork + JSON Lines stdin/stdout | 简单、可流式 |
| LLM SDK | `@anthropic-ai/sdk` | Phase 1a 默认 Claude Haiku，便宜 |
| 状态管理 | Zustand | 轻量 |
| 包管理 | pnpm + electron-vite | 标准 |
| 日志 | pino + 本地 rolling file | 后续可对接远程 |
| 配置存储 | JSON in `%APPDATA%/UCA/config.json` | 简单 |
| 凭据存储 | `keytar` (Win Credential Manager) | 不要明文存 API Key |

### 3.3 SQLite Schema (Phase 1a 最小版)

```sql
CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  intent TEXT NOT NULL,
  executor TEXT NOT NULL,
  user_command TEXT NOT NULL,
  context_packet_json TEXT NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status, updated_at DESC);

CREATE TABLE task_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY(task_id) REFERENCES tasks(task_id)
);
CREATE INDEX idx_events_task ON task_events(task_id, ts);

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(task_id)
);
```

### 3.4 模块职责

- **uca-tray**：只负责 UI 容器和窗口管理。任何业务逻辑都不写在这里。
- **uca-service**：所有业务逻辑。Tray 通过 JSON-RPC 调用。
- **IntentRouter (规则版)**：
  - 命中模板按钮 → 直接路由
  - 命中关键词正则（"总结/translate/翻译/重写/解释"）→ 路由
  - 都不命中 → 返回 `unknown`，UI 显示"我没听懂，请用快捷动作"
  - **Phase 1a 不调云端 LLM 做意图分类**，简化复杂度
- **FastExecutor**：
  - 输入：`{intent, context_packet, user_command}`
  - 输出：`AsyncIterable<TaskEvent>`
  - 内部用 Claude Haiku，prompt 模板写死 4 个意图各一份

## 4. 流程设计

### 4.1 端到端时序图（剪贴板总结）

```
User                Tray              Service           LLM
 │  Ctrl+Shift+Space │                  │                │
 ├──────────────────►│                  │                │
 │                   │ show overlay     │                │
 │  click "读取剪贴板" │                  │                │
 ├──────────────────►│                  │                │
 │                   │ clipboard.readText()              │
 │                   │  text="..."      │                │
 │                   │ POST /context     │                │
 │                   ├─────────────────►│                │
 │                   │  ContextPacket   │                │
 │                   │◄─────────────────┤ id=ctx_xxx     │
 │  click "总结"      │                  │                │
 ├──────────────────►│                  │                │
 │                   │ POST /task       │                │
 │                   ├─────────────────►│                │
 │                   │                  │ insert tasks   │
 │                   │                  │ status=queued  │
 │                   │                  │ → starting     │
 │                   │                  │ → running      │
 │                   │                  │ → streaming    │
 │                   │  SSE: events     │ call LLM       │
 │                   │◄─────────────────┤◄───────────────┤
 │                   │ render delta     │ token stream   │
 │                   │                  │                │
 │                   │                  │ status=success │
 │                   │ show "完成 ✓"    │                │
 │                   │ "在控制台中查看"  │                │
```

### 4.2 状态机（Task）

```
draft → queued → starting → running → streaming → success
                                                ↘ failed
```

Phase 1a 不实现 `cancelled` / `partial_success` / `awaiting_confirmation`（Phase 2 做）。

### 4.3 关键流程清单

1. **托盘启动流程**：tray 启动 → fork service → 等 service `ready` 信号 → 注册全局快捷键 → 隐藏到托盘
2. **浮窗显示流程**：快捷键触发 → tray.showOverlay() → 加载预创建的 BrowserWindow → 聚焦 → 不抢系统焦点
3. **任务创建流程**：UI POST `/task` → service 写 SQLite (status=queued) → 立即响应 task_id → 异步开始执行
4. **流式回传流程**：service 通过 SSE (`/task/:id/events`) 推送 TaskEvent → UI 渲染
5. **崩溃恢复流程**：service 启动时扫描 `running/streaming` 任务 → 标记为 `interrupted`（这一处 Phase 1a 简单处理：直接标 failed）

## 5. 验收标准

Phase 1a 完成的判定：

### 5.1 功能验收
- [ ] 安装包能在干净 Win10/Win11 上安装、自启动到托盘
- [ ] `Ctrl+Shift+Space` 任意时刻能调出浮窗，**不抢焦点**
- [ ] 浮窗"读取剪贴板"按钮能读出当前剪贴板文本并显示前 200 字
- [ ] "总结" / "翻译" / "改写" / "解释" 4 个动作均能产生流式结果
- [ ] 任意一次任务可以在主控制台找到记录
- [ ] 任务详情页能看到 ContextPacket、TaskEvent 时间线、最终结果
- [ ] 程序异常退出后重启，历史任务仍在 SQLite 里
- [ ] 卸载时清理 SQLite + 配置 + 凭据

### 5.2 性能验收（建议作为 SLO 起点）
- [ ] 浮窗冷启动可见 ≤ 500ms（P95），热启动 ≤ 200ms
- [ ] 剪贴板读取 ≤ 100ms
- [ ] 触发"总结"到首字流出 ≤ 2s（P95，依赖 LLM）
- [ ] 内存常驻 ≤ 300MB（tray + service 总和）

### 5.3 工程验收
- [ ] 代码进 Git，pnpm + electron-vite + biome lint 配置完成
- [ ] CI：PR 上跑 lint + tsc + 单元测试
- [ ] 单测覆盖：IntentRouter 规则匹配、SQLite 读写、FastExecutor 事件流
- [ ] README 写明本地开发步骤
- [ ] Demo 录屏 ≤ 90 秒，演示完整闭环

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Electron globalShortcut 在某些键位被系统占用 | 快捷键失效 | 启动时检测冲突，UI 提示用户改键 |
| 浮窗抢焦点导致用户在原应用 IME 失态 | 严重影响体验 | 用 `setIgnoreMouseEvents` + `WS_EX_NOACTIVATE`，并在测试用例里手动验证一次 |
| LLM 流式 SDK 在弱网下断连 | 任务卡 streaming | 加 30s 心跳超时，超时标 failed |
| SQLite 多进程访问冲突 | 数据损坏 | 只有 service 持有连接，tray 通过 IPC 访问 |
| Phase 1a 范围蔓延 | 延期 | 每周 standup 复述 §2.3 红线 |
| Kimi CLI 还没拿到 | 阻塞 Bridge 联调 | Bridge 用 stub，Phase 1a 不依赖真实 Kimi |

## 7. 交付物清单

```
src/
  ├─ tray/                  Electron Main + 浮窗/控制台 Renderer
  ├─ service/               Node 子进程
  │   ├─ intent_router/
  │   ├─ task_queue/
  │   ├─ executors/
  │   │   ├─ fast/
  │   │   └─ kimi_bridge_stub/
  │   ├─ store/             SQLite + WAL
  │   └─ events/            EventBus + SSE
  └─ shared/                共享类型(ContextPacket/Task/...)
docs/
  ├─ phase_1a_demo.mp4
  └─ slo_baseline.md
```

## 8. 与下一 Phase 的接口

[Phase 1b](phase_1b_file_capability.md) 会在此基础上加入文件入口。Phase 1a 必须留好这两个扩展点：

1. `ContextPacket.source_type` 已经支持 `file | file_group`，但 Phase 1a 只生成 `clipboard_text`
2. `Executor` 接口已经定义为可插拔，Phase 1b 可以直接注册 `FileTextExtractor` / `KimiCLI` 而不动核心
