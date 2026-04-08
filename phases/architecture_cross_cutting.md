# 架构横切文档（跨 Phase 共享）

> 本文档汇总跨 Phase 的横切关注点（cross-cutting concerns），不依赖任何单一 Phase。任何 Phase 在引入新组件时，都应回头检查本文档是否被破坏。

---

## 1. 进程拓扑（最终目标）

```
┌─────────────────────────────────────────────────────┐
│  uca-tray  (Electron Main, 1 个)                     │
│  - 系统托盘图标 / Kill Switch                          │
│  - 全局快捷键注册                                      │
│  - 窗口管理 (overlay / console / first-run / dialog)  │
│  - 自动更新检查                                        │
└──────────┬──────────────────────────────────────────┘
           │ ipc (in-process)
           │
   ┌───────┴───────┐
   │ Renderer × N  │   overlay / console / detail / wizard
   └───────────────┘
           │
           │ child_process.fork  +  JSON-Lines stdin/stdout
           ▼
┌─────────────────────────────────────────────────────┐
│  uca-service  (Node 子进程, 1 个)                     │
│  - HTTP server :9412 (内部)                           │
│  - HTTPS server :9413 (Office Add-in)                 │
│  - SSE / WebSocket  (流式事件)                         │
│  - SQLite (better-sqlite3 + WAL)                      │
│  - TaskQueue / IntentRouter / Executor Registry       │
│  - Security Broker                                    │
│  - Audit Log                                          │
│  - Action Tool Registry  (Phase Action Tools)         │
│  - Scheduler  (Phase Scheduler, cron + file watch)    │
└──────┬──────────────────────────┬───────────────────┘
       │                          │
       │ Named Pipe               │ child_process.spawn
       ▼                          ▼
┌──────────────┐       ┌──────────────────────┐
│ uca-helper   │       │ kimi.exe / ollama /  │
│ (.NET WPF    │       │ paddle_ocr / ...     │
│  Console)    │       └──────────────────────┘
│ - 截图        │                  ▲
│ - hot keys   │                  │
│ - 屏幕共享检测  │                  │ stdio JSON
│ - UIAuto     │                  │
└──────────────┘       ┌──────────┴──────────┐
                       │ uca-native-host.exe │
                       │ (浏览器 NMH)         │
                       └─────────────────────┘
                                  ▲
                                  │ Native Messaging
                                  │
                       ┌──────────┴──────────┐
                       │ Browser Extension   │
                       └─────────────────────┘
```

### 进程职责矩阵

| 进程 | 启动时机 | 是否常驻 | 崩溃影响 | 重启策略 |
|---|---|---|---|---|
| uca-tray | 用户登录/手动 | 是 | 全部 UI 不可用 | 用户重启 |
| uca-service | 跟 tray | 是 | 任务停止；UI 可显示历史 | tray 监控并自动 fork |
| uca-helper | 跟 tray | 是 | 截图/快捷键失效 | tray 监控并自动重启 |
| uca-native-host | 浏览器拉起 | 否 | 该浏览器扩展失效 | 浏览器自动重连 |
| kimi/ollama 子进程 | 任务创建时 | 否 | 单任务失败 | 任务级 retry |

---

## 2. 数据流（端到端）

```
[Capture]                                  ┌── 来源: 用户、Scheduler 触发器、文件事件 ──┐
  │  raw payload                            │ - User: hotkey/right-click/extension/...  │
  ▼                                         │ - Scheduler: cron/file_watch/interval      │
[Context Normalizer]                       └────────────────────────────────────────────┘
  │  ContextPacket{schema_version, source_type, ...}
  ▼
[Security Broker]
  │  - 黑/白名单
  │  - PII 脱敏
  │  - Kill Switch
  │  - 屏幕共享检测
  ▼
[Overlay UI / Console UI]
  │  user_command + ContextPacket
  ▼
[Intent Router]   (规则 → 本地小模型 → LLM 兜底)
  │  IntentDecision{intent, executor_pref, requires_confirmation}
  ▼
[Confirmation UI]   (如需)
  │
  ▼
[Task Builder]    (写 SQLite, status=draft)
  │  Task
  ▼
[Task Queue]      (优先级 + 并发上限 + 同对象去重)
  │
  ▼
[Executor Registry.pick(intent, constraints)]
  │
  ▼
[Executor.execute()]                          ← 包括 Tool-Using Agent loop
  │  AsyncIterable<TaskEvent>                   │
  │                                             │ tool_call?
  │                                             ▼
  │                                  [Action Tool Registry.call()]
  │                                             │
  │                                             ▼
  │                                  [Risk Check + Security Broker]
  │                                             │
  │                                             ▼
  │                                  [Tool Execution]   ← mailto / search / file_op / ...
  │                                             │ observation
  │                                             ▼
  │                                  (回到 Agent loop)
  │
  ▼
[Event Bus]
  ├─→ [SQLite WAL persist]    (Event Sourcing)
  └─→ [SSE broadcast]
        │
        ▼
      [UI 流式更新]
  │
  ▼
[Artifact Store]   (产物落盘)
  │
  ▼
[Task FSM: success / partial_success / failed / cancelled]
  │
  ▼
[Console UI]
```

**强约束**：所有 ContextPacket 必须经过 Security Broker；所有 LLM 调用必须写 audit_log；所有任务事件必须先 persist 后 broadcast。

---

## 3. 协议规范

### 3.1 ContextPacket（最终版字段）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| schema_version | string | ✓ | "1.0" |
| context_id | string | ✓ | `ctx_<timestamp>_<rand>` |
| trace_id | string | ✓ | 全链路追踪 |
| source_type | enum | ✓ | file / file_group / text_selection / image / link / webpage / clipboard / office_selection / pdf_selection / window / screenshot |
| source_app | string | ✓ | "EXCEL.EXE" |
| source_process_id | int |  | 配合白/黑名单 |
| capture_mode | enum | ✓ | event / manual / plugin / extension / shell_menu / hotkey / drag |
| security_level | enum | ✓ | public / internal / sensitive / secret |
| redaction_applied | bool | ✓ | text/image 是否已脱敏 |
| content_hash | string |  | sha256 |
| size_bytes | int |  | |
| text | string |  | |
| html | string |  | |
| url | string |  | |
| file_paths | string[] |  | |
| image_paths | string[] |  | |
| selection_metadata | object |  | source_type 相关 |
| entity_hints | object |  | language/has_table/has_image |
| captured_at | iso8601 | ✓ | |

### 3.2 Task

见 [phase_2 §3.4](phase_2_status_completeness.md)。

### 3.3 TaskEvent (Event Sourcing)

```jsonc
{
  "event_id": 12345,                   // SQLite autoincrement
  "task_id": "TASK-...",
  "ts": 1681540001000,
  "event_type": "step_started|log|warning|artifact_created|success|failed|...",
  "payload": { ... }
}
```

### 3.4 Kimi CLI Bridge 协议

见 [phase_1b §3.3](phase_1b_file_capability.md)。

### 3.5 PendingApproval（跨 Phase 共享）

由 [Phase Scheduler §3.8](phase_scheduler.md) 与 [Phase Action Tools §3.4.1](phase_action_tools.md) 共用。

任何**非交互式**触发的高风险动作（schedule trigger / agent tool call in unattended or approval mode）都不直接执行，而是落到 `pending_approvals` 表，等待用户在控制台审批。完整数据模型见 [Phase Scheduler](phase_scheduler.md) 的 Pending Approval 小节。

```jsonc
{
  "approval_id": "appr_xxx",
  "created_at": 1681540000,
  "expires_at": 1682144800,           // 默认 +7d
  "source_type": "schedule_trigger | agent_tool_call",
  "source_id": "sched_xxx | TASK-xxx",
  "proposed_action": "task_template | action_tool",
  "proposed_target": "tool_or_template_id",
  "proposed_params": {...},
  "preview_text": "拟向 advisor@example.com 发送邮件，标题: 本周进展...",
  "status": "pending | approved | rejected | expired | superseded",
  "decided_at": null,
  "decided_by": null,
  "resulting_task_id": null
}
```

**强约束**：任何 service 外部组件**不能**直接执行 pending 动作；必须由用户在主控制台显式 approve 或由 TTL 扫描器标 expired。

### 3.6 AuditLog 字段扩展

原 audit_log 仅为 LLM 调用设计。在新增 Action Tools / Scheduler / PendingApproval 后，需要扩展 `event_subtype` 字段，覆盖以下类别：

| event_subtype 前缀 | 触发位置 |
|---|---|
| `llm.call` | LLM 调用（原有） |
| `tool.call` | Action Tool 执行 |
| `tool.denied` | 用户拒绝工具调用 |
| `schedule.trigger` | Scheduler 触发 |
| `schedule.misfire_handled` | 错过触发的处理 |
| `pending_approval.created` | 新建待审批 |
| `pending_approval.approved` | 用户批准 |
| `pending_approval.rejected` | 用户拒绝 |
| `pending_approval.expired` | TTL 过期 |
| `pending_approval.superseded` | 被新一轮取代 |
| `presenter_mode.toggle` | 演示保护模式开关 |
| `kill_switch.toggle` | 全局 Kill Switch 开关 |
| `redaction.applied` | 上下文做了脱敏 |
| `redaction.state_lost` | 崩溃后脱敏映射丢失 |

这套审计是产品在合规、事后排错、用户信任三方面的"唯一真相源"。**任何新加 Phase 都必须把自己产生的关键事件登记到这张表里。**

---

## 4. 端口与文件路径

| 端口 | 用途 | 协议 |
|---|---|---|
| 9412 | tray/cli/helper → service | HTTP/SSE |
| 9413 | Office Add-in → service | HTTPS（自签证书） |
| (stdio) | Native Messaging Host ↔ 浏览器 | 4 字节长度 + JSON |

| 路径 | 内容 |
|---|---|
| `%APPDATA%/UCA/config.json` | 用户配置 |
| `%APPDATA%/UCA/uca.db` | SQLite 主库 |
| `%APPDATA%/UCA/uca.db-wal` | SQLite WAL |
| `%APPDATA%/UCA/audit.db` | 审计日志库 |
| `%APPDATA%/UCA/outputs/{date}/{task_id}/` | 任务产物 |
| `%APPDATA%/UCA/logs/` | 应用日志（pino rolling） |
| `%TEMP%/UCA/screenshots/` | 截图缓存（24h 清理） |
| `%TEMP%/UCA/clipboard/` | 剪贴板缓存（5min 清理） |
| Windows Credential Manager | API Keys (DPAPI 加密) |

---

## 5. 性能 SLO

| 操作 | P50 | P95 | 失败兜底 |
|---|---|---|---|
| 浮窗冷启动可见 | 150ms | 350ms | >500ms 显示固定窗 |
| 浮窗热启动可见 | 50ms | 150ms | - |
| 浏览器选区→浮标 | 200ms | 400ms | - |
| Office 选区→Task Pane 更新 | 200ms | 500ms | - |
| Shell 菜单→浮窗显示 | 500ms | 1000ms | - |
| 剪贴板读取 | 50ms | 100ms | - |
| 文件 mime 识别 | 30ms | 80ms | - |
| 任务入队反馈 | 50ms | 150ms | - |
| FastExecutor 首字（依赖 LLM） | 800ms | 2000ms | 显示 loading |
| KimiCLI 子进程启动 | 1500ms | 3000ms | - |
| SQLite 单事件写 | 2ms | 5ms | - |
| SSE 推送延迟 | 20ms | 50ms | - |
| 任务详情页 1000 事件渲染 | 100ms | 200ms | 虚拟列表 |
| 取消响应 | 500ms | 1000ms | - |

---

## 6. 跨 Phase 横切关注点

### 6.1 安全 / 隐私
- 见 [phase_2_5](phase_2_5_privacy_security.md)
- **强约束**：任何新 capture 来源、任何新 executor 必须默认走 Security Broker，PR review 检查项

### 6.2 可观测性
- 日志：pino + rolling file，DEBUG/INFO/WARN/ERROR
- 指标：service 暴露 `/metrics`，包含 task_count / failure_rate / queue_depth / avg_latency / token_spent
- Crash Report：electron-builder 内置 minidump，本地存储（首版本不上报远程）
- 链路追踪：每个 ContextPacket 带 trace_id，整条链贯穿

### 6.3 可测试性
- 单测：service 内核全部模块 ≥ 80% 行覆盖
- 集成测试：mock LLM、mock Kimi CLI、mock Office.js
- E2E：Playwright 驱动 Electron + Chrome 扩展
- 性能回归：每次 release 前跑 SLO 测试集
- 故障注入：spawn 会随机失败的 mock executor

### 6.4 自动更新
- electron-updater
- 自托管 release server（GitHub Releases 起步）
- 强制更新策略：仅在严重安全问题时
- 回滚机制：保留上一版本

### 6.5 国际化
- i18next，先 zh-CN / en
- 所有 UI 文案抽到 locales/

### 6.6 无障碍 (a11y)
- 浮窗/控制台键盘可导航
- 关键操作有 ARIA label
- 高对比度主题

### 6.7 Crash 恢复
- service 启动时扫 status in (running, streaming) 任务 → 标 interrupted → 询问用户恢复
- helper / kimi 子进程崩溃 → 任务级 retry

---

## 7. 反模式（不要做）

1. ❌ **不要在 renderer 进程直接调 LLM SDK** — 必须经 service，否则审计/脱敏/配额全失效
2. ❌ **不要在 service 进程做 UI 渲染** — service 是无界面后台
3. ❌ **不要 bypass Security Broker** — 任何对 LLM/网络的调用必须经过它
4. ❌ **不要在浮窗代码里写业务逻辑** — 浮窗只是 UI，业务在 service
5. ❌ **不要把 API Key 写到配置文件** — 必须 keytar / DPAPI
6. ❌ **不要后台轮询屏幕** — 隐私雷区且性能崩
7. ❌ **不要为单一应用做特例适配** — 走多入口并存策略
8. ❌ **不要在 Phase 1 同时做 Office/PDF/视觉** — 范围爆炸
9. ❌ **不要在没有 SLO 前喊"快"** — 量化或闭嘴
10. ❌ **不要在没有失败分类前发布** — 黑箱失败劝退用户

---

## 8. 决策记录索引

每个重大架构决策应写一份 ADR (Architecture Decision Record) 放在 `docs/adr/`。已知决策点：

| ADR | 内容 | Phase |
|---|---|---|
| ADR-001 | 选 Electron 而非 Tauri | 0 |
| ADR-002 | 三进程模型而非纯 Electron | 0 |
| ADR-003 | SQLite + WAL 而非 LevelDB | 0 |
| ADR-004 | Event Sourcing 而非状态快照 | 0 |
| ADR-005 | 放弃跨应用通用选区检测 | 0 |
| ADR-006 | Office.js Add-in 而非 VSTO | 4 |
| ADR-007 | PaddleOCR 而非 tesseract.js | 5 |
| ADR-008 | 浏览器扩展走 Native Messaging Host | 1c |
| ADR-009 | 强制 Security Broker 单例 | 2.5 |
| ADR-010 | DAG 调度器表达力（yaml + JS 沙箱） | 6 |
| ADR-011 | 全局快捷键读 Explorer 选区用 IShellWindows，不做悬停检测 | 1b |
| ADR-012 | Action Tools 走严格白名单 + JSON Schema 校验，不允许任意 shell | Action Tools |
| ADR-013 | LLM Agent loop 上限 10 轮，超过强停 | Action Tools |
| ADR-014 | Scheduler 用 node-cron + chokidar；触发的任务仍走完整安全链路 | Scheduler |
| ADR-015 | LLM 自主创建定时任务必须强制确认（视为 high risk） | Scheduler |

---

## 9. 演进路径

```
Phase 0   骨架定义
   │
   ▼
Phase 1a → 1b → 1c   (闭环 → 文件 → 浏览器)
   │       └─ 含: 全局快捷键读 Explorer 选区
   ▼
Phase 2   状态完善 ─────────┐
   │                       │ 并行
   │                       ▼
   │              Phase Action Tools  ← 新增（mailto/搜索/文件操作/...）
   │                       │
   ▼                       │
Phase 2.5  隐私权限 ←──────┘
   │
   ▼
Phase Scheduler  ← 新增（cron/file watch + LLM 自主创建）
   │
   ├──→ Phase 3      浏览器内浮标（限定）
   │
   ├──→ Phase 4      Office Add-in
   │
   ├──→ Phase 5      PDF / OCR
   │
   ▼
Phase 6   平台化（持续滚动）
```

**并行规则**：
- Phase Action Tools 可以与 Phase 2 并行启动（最早 W18 开），但发布前要等 Phase 2.5 接好 Security Broker
- Phase Scheduler 必须等 Phase Action Tools + Phase 2.5 完成后才开（依赖 create_scheduled_task 工具与安全链路）
- Phase 3/4/5 之间可以**并行**（不同人 / 不同模块），但都依赖 Phase 2.5 完成
- Phase 6 是持续阶段，可以早期接入但不应阻塞前面的 Phase
