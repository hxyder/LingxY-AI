# Phase 0 — 定义与协议定稿

> 周期估计：W1–W2（2 周） · 角色：PM + 架构师 + UX
> 上一阶段：— · 下一阶段：[Phase 1a](phase_1a_minimal_loop.md)

## 1. 目标

建立"产品-架构-协议"三件套的共识，让后续 Phase 不再因为"概念不一致"返工。Phase 0 不写代码，只产出文档与原型图。

退出此 Phase 的判定：**任何一个 Phase 1 的工程师拿到这套文档，能在 1 小时内画出 ContextPacket 从 capture 到 artifact 的完整流向。**

## 2. 范围

### 必做
- PRD（产品需求文档）：定位、目标用户、不做什么、核心场景、成功指标
- 总体架构图：层级划分、进程模型、IPC 拓扑
- 数据协议：`ContextPacket`、`Task`、`TaskEvent`、`Artifact` 的 JSON Schema
- Kimi CLI 任务包与回传协议
- UI 状态机：浮窗、控制台、任务详情页的状态图
- 风险登记册：把已知工程不确定项列出来，每条标注负责人和验证时点

### 不做
- 不画详细像素级 UI 稿（Phase 1a 才需要）
- 不实现任何代码
- 不选具体 LLM 模型（Phase 1a 才决定）
- 不做 Office/PDF 适配设计（Phase 4/5 才做）

## 3. 架构

Phase 0 只产出"目标架构图"，不要求实现。建议四张图：

### 3.1 层级架构图

```
┌──────────────────────────────────────────────────────────────┐
│                    主控制台 / Workspace UI                    │
│                  (Electron Renderer Process)                  │
└──────────────────────────────────────────────────────────────┘
                              ↕ IPC
┌──────────────────────────────────────────────────────────────┐
│                    Local Service (Node 子进程)                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │
│  │ Context    │ │  Intent    │ │   Task     │ │ Executor  │ │
│  │ Normalizer │ │  Router    │ │  Queue     │ │ Registry  │ │
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘ │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │
│  │ SQLite     │ │ Artifact   │ │  Event     │ │ Security  │ │
│  │ Store      │ │ Store      │ │  Bus       │ │ Broker    │ │
│  └────────────┘ └────────────┘ └────────────┘ └───────────┘ │
└──────────────────────────────────────────────────────────────┘
        ↕ Named Pipe              ↕ spawn         ↕ HTTP/SSE
┌─────────────────┐       ┌──────────────┐    ┌─────────────────┐
│  Native Helper  │       │ Kimi CLI /   │    │ Browser Ext.    │
│  (C# / Rust)    │       │ Other LLM    │    │ Native Msg Host │
│  - 全局快捷键    │       │  Subprocess  │    │                 │
│  - 截图          │       └──────────────┘    └─────────────────┘
│  - UIAutomation │
└─────────────────┘
```

### 3.2 数据流图（Capture → Result）

```
[User Action]
    │
    ▼
[Capture Source]   ← 剪贴板 / 右键 / 拖拽 / 浏览器扩展 / Office Add-in
    │ raw payload
    ▼
[Context Normalizer]   → 产出 ContextPacket {schema_version, source_type, ...}
    │
    ▼
[Security Broker]   → 脱敏 / 白黑名单检查 → 标记 security_level
    │
    ▼
[Overlay UI]   → 显示快捷动作 + 自然语言输入
    │ user_command + ContextPacket
    ▼
[Intent Router]   → 三层级联(规则/小模型/LLM) → IntentDecision
    │
    ▼
[Task Builder]   → 创建 Task + 写入 SQLite (status=draft)
    │
    ├─ requires_confirmation? → [Confirmation UI] → confirmed
    │
    ▼
[Task Queue]   → 按 priority/concurrency 调度
    │
    ▼
[Executor Registry]   → 选择执行器(Fast/Tool/KimiCLI)
    │
    ▼
[Executor]   → 流式发出 TaskEvent → [Event Bus] → [UI 流式更新]
    │
    ▼
[Artifact Store]   → 保存产物文件
    │
    ▼
[Task: success/partial_success/failed]
    │
    ▼
[Console UI]   → 显示结果 / 失败原因 / 重试入口
```

### 3.3 进程拓扑图

| 进程 | 技术栈 | 职责 | 生命周期 |
|---|---|---|---|
| `uca-tray` | Electron Main | 托盘、窗口管理、自启动 | 跟系统会话 |
| `uca-overlay` | Electron Renderer | 浮窗 UI | 按需 |
| `uca-console` | Electron Renderer | 主控制台 UI | 按需 |
| `uca-service` | Node child_process | 任务队列、Intent Router、SQLite | 跟 tray |
| `uca-helper` | C#/.NET WPF Console | 系统级抓取、全局快捷键 | 跟 tray |
| `uca-kimi-bridge` | Node 子进程包装 Kimi CLI | 执行深任务 | 按任务起灭 |
| `uca-native-host` | Node + 注册表 | 浏览器 Native Messaging Host | 浏览器拉起 |

### 3.4 状态机

定义三个核心状态机：

- **Task FSM**：`draft → awaiting_confirmation → queued → starting → running → streaming → success/partial_success/failed/cancelled`
- **Overlay FSM**：`hidden → preparing → light → expanded → busy → result`
- **Confirmation FSM**：`none → light_ask → heavy_confirm → confirmed/declined`

每个 FSM 在 Phase 0 产出图（建议用 Mermaid stateDiagram）。

## 4. 流程设计

Phase 0 不实现流程，但要为 Phase 1a 准备一份"标准 Demo 流程"作为验收基准：

```
Demo: "选中一段网页文字 → 系统总结 → 显示结果"

1. 用户在 Chrome 选中一段文字 (300 字)
2. 浏览器扩展捕获 selection，组装 ContextPacket(source_type=text_selection)
3. 扩展通过 Native Messaging Host 发送到 Local Service
4. Local Service 调用 Security Broker → 检查白名单 → 通过
5. Local Service 创建轻浮窗，显示快捷动作"总结"
6. 用户点"总结"
7. Intent Router 命中规则 → intent=summarize, executor=fast
8. Task Queue 入队，立刻调度
9. Fast Executor 调用云端 LLM 流式返回
10. UI 流式渲染结果
11. 任务标记 success，写入 SQLite
12. 用户可点"在控制台中打开"查看历史
```

这条 Demo 流程是 Phase 1a 的验收剧本。

## 5. 验收标准

| 项 | 状态 |
|---|---|
| PRD v1.0 评审通过（PM + 工程负责人 + UX 签字） | ☐ |
| 总体架构图 4 张全部产出且评审通过 | ☐ |
| ContextPacket / Task / TaskEvent / Artifact JSON Schema 定稿 | ☐ |
| Kimi CLI 任务包 + 回传事件协议定稿 | ☐ |
| Task / Overlay / Confirmation 三个 FSM 定稿 | ☐ |
| 风险登记册 v1（≥15 条） | ☐ |
| Phase 1a 的 Demo 剧本评审通过 | ☐ |
| 至少完成 1 次纸面 walkthrough（PM 念剧本，工程沿架构图走） | ☐ |

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 协议字段后期还要改 | schema 加 `schema_version`，所有解析端做 forward-compat |
| Kimi CLI 真实接口不稳定 | Phase 0 预留 1 天做 spike：拿真实 CLI 跑通 stdin/stdout JSON Lines |
| 团队对"低打扰"理解不一致 | UX 在 PRD 里给出"反例清单"——10 个一定不能出现的弹窗时机 |
| 进程模型评审分歧 | 给出 Plan A(三进程) 和 Plan B(纯 Electron) 对比，由架构师裁决 |
| ContextPacket 字段过多 | 区分"必填核心 8 字段" vs "可选扩展字段"，避免新手被淹没 |

## 7. 交付物清单

```
docs/
  ├─ prd_v1.0.md
  ├─ architecture/
  │   ├─ README.md
  │   ├─ layer_overview.md
  │   ├─ data_flow.md
  │   ├─ process_topology.md
  │   ├─ state_machines.md
  │   └─ open_spikes.md
  ├─ protocols/
  │   ├─ context_packet.schema.json
  │   ├─ task.schema.json
  │   ├─ task_event.schema.json
  │   ├─ artifact.schema.json
  │   └─ kimi_bridge_protocol.md
  ├─ risks/
  │   └─ risk_register_v1.md
  └─ phase_1a_demo_script.md
```

## 8. 完成判定

当一名 Phase 1a 的新工程师能够在不看面对面讲解的情况下，仅凭 `docs/` 目录画出"用户选择文本到拿到结果"的完整组件交互时序图，Phase 0 算完成。
