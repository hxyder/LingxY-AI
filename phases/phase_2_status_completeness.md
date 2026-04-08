# Phase 2 — 状态与执行显示完善

> 周期估计：W16–W19（4 周） · 角色：1 桌面 + 1 后端 + 0.5 UX
> 上一阶段：[Phase 1c](phase_1c_browser_extension.md) · 下一阶段：[Phase 2.5](phase_2_5_privacy_security.md)

## 1. 目标

把"能用"升级到"清楚可控"。Phase 1 的任务一旦失败就是黑箱，进度不可见，只能等结果。Phase 2 要让用户：

- 任何时刻知道任务执行到哪一步
- 失败时立刻知道为什么以及怎么修
- 能取消、能重试、能用别的执行器再跑
- 多任务并发时不混乱

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | 流式步骤显示 | 任务详情页用时间线展示 step_started/step_finished/log |
| 2 | 失败分类 | 把 errors 归到 9 类（见 §3.4） |
| 3 | 失败修复建议 | 每类错误对应一段"用户可采取的动作" |
| 4 | 重试机制 | 原参数/修改参数/换执行器/跳过已完成步骤 |
| 5 | 取消机制 | UI 一键取消，service kill 子进程 |
| 6 | 部分成功状态 | partial_success + 子任务级状态 |
| 7 | 多任务并发管理 | 优先级队列 + 并发上限 + 同对象去重 |
| 8 | 任务详情页完整化 | 命令/意图/上下文/步骤/日志/产物/失败/重试 全部呈现 |
| 9 | 任务列表筛选 | 按时间/状态/来源/执行器筛选 |
| 10 | 最近命令复用 | 历史命令一键再跑 |
| 11 | 实时性能指标 | service 暴露 /metrics，UI 显示队列深度/失败率 |

### 2.2 不做

- 隐私脱敏（Phase 2.5）
- Office 集成（Phase 4）
- 跨任务编排（Phase 6）
- 用户自定义动作（Phase 6）

## 3. 架构

### 3.1 任务事件流（升级版）

```
Executor                 EventBus            SQLite              UI
   │ emit(step_started)   │                   │                  │
   ├──────────────────────►                   │                  │
   │                      │ persist(WAL)      │                  │
   │                      ├───────────────────►                  │
   │                      │ broadcast(SSE)    │                  │
   │                      ├──────────────────────────────────────►
   │                      │                   │                  │ render timeline node
   │ emit(log)            │                   │                  │
   ├──────────────────────►                   │                  │
   │                      │ persist           │                  │
   │                      │ broadcast         │                  │
   │                      ├──────────────────────────────────────►
   │                      │                   │                  │ append log line
   │ ...                  │                   │                  │
   │ emit(artifact_created)                                       │
   │ emit(success / failed / partial_success)                    │
```

事件**先持久化再广播**，保证 UI 重连可以从 SQLite 重放，不丢事件。

### 3.2 SSE 重连协议

UI 订阅 `/task/:id/events?since=<event_id>`：
- 首次连接：返回历史所有事件 + 后续推送
- 断线重连：客户端记录最后 event_id，重连时带上 since 参数
- 服务端从 SQLite 查 since 之后的事件，先一次性回放，再继续推送

### 3.3 失败分类

| 分类 | 描述 | 修复建议示例 |
|---|---|---|
| `context_capture_error` | 上下文读取失败 | "权限不足，请检查文件是否被占用" |
| `permission_denied` | 文件/系统权限 | "需要管理员权限，或更改文件权限" |
| `parse_error` | 文档解析失败 | "PDF 加密或损坏，请尝试解锁后重试" |
| `tool_unavailable` | 外部工具不在 | "Kimi CLI 未安装，是否前往安装？" |
| `cli_execution_error` | 子进程错误 | "Kimi 退出码 1，查看日志" + 切换执行器 |
| `model_call_error` | LLM 调用失败 | 区分网络/限流/无效 key/上下文超长 |
| `output_save_error` | 写盘失败 | "磁盘空间不足/路径无效" |
| `user_interrupted` | 用户主动取消 | 不显示为失败，单独"已取消" |
| `network_error` | 网络问题 | 自动 3 次指数退避 |
| `timeout` | 超时 | 提示延长 max_runtime 或拆任务 |
| `internal_error` | 其它 | "未知错误，请上报"+ 一键复制日志 |

### 3.4 任务对象升级

```jsonc
{
  "task_id": "TASK-...",
  "status": "running",
  "sub_status": "summarizing_chunk_2_of_5",
  "progress": 0.4,                    // 0~1
  "current_step": "summarize",
  "completed_steps": ["read_pdf", "parse_sections"],
  "remaining_steps_estimate": ["summarize", "format", "save"],
  "failure_category": null,
  "failure_user_message": null,
  "failure_internal_log_excerpt": null,
  "retryable": true,
  "parent_task_id": null,
  "retry_count": 0,
  "executor_history": [
    { "executor": "kimi_cli", "outcome": "failed", "ended_at": ... }
  ]
}
```

### 3.5 重试模式

| 重试模式 | 实现 |
|---|---|
| `retry_same` | 复用 task_package，新建 task 但 parent_task_id 指向原任务 |
| `retry_modified` | UI 让用户改命令/参数后再跑 |
| `retry_different_executor` | 同样上下文换 Executor.id |
| `retry_resume` | 从最后一个完成的 step 继续（要求执行器支持 checkpoint） |

`retry_resume` 是最难的，Phase 2 仅在 KimiCLIExecutor 支持时启用，其它执行器禁用该按钮。

## 4. 流程设计

### 4.1 流式步骤显示

任务详情页的"步骤时间线"按 task_event 渲染：

```
● 14:30:01  接收任务
● 14:30:02  开始执行 (Kimi CLI)
● 14:30:03  Step: read_pdf
│           读取 24 页
● 14:30:08  Step: parse_sections
│           找到 8 个章节
● 14:30:15  Step: summarize  ← 进行中
│           chunk 1/3 完成
│           chunk 2/3 完成
○           chunk 3/3 处理中…
○           Step: format
○           Step: save
```

`●` 已完成 `○` 待执行/进行中。每个 step 节点可点开看详细日志。

### 4.2 失败分层显示

```
┌──────────────────────────────────────────┐
│ ❌ 任务失败                                 │
│                                           │
│ 失败阶段：summarize chunk 2/3              │
│ 错误类别：模型调用失败 (rate_limited)        │
│                                           │
│ 详情：                                      │
│   API 在 14:32:08 返回 429 Too Many        │
│   Requests。                               │
│                                           │
│ 你可以：                                    │
│  ▸ 等待 1 分钟后重试                        │
│  ▸ 切换到 Claude Haiku 重试                 │
│  ▸ 缩小输入范围（仅分析前 5 章节）           │
│                                           │
│ [ 原参数重试 ] [ 切换执行器 ] [ 查看日志 ]   │
└──────────────────────────────────────────┘
```

### 4.3 取消流程

```
User → UI Cancel
  → service.cancelTask(id)
    → set status=cancelling
    → executor.cancel(id)
      → KimiCLIExecutor: send SIGTERM
      → wait 5s grace
      → SIGKILL if alive
    → emit step_cancelled, status=cancelled
    → keep partial logs/artifacts
```

### 4.4 多任务并发

```
TaskQueue:
  pools:
    fast:    max_concurrent = 8
    tool:    max_concurrent = 4
    kimi:    max_concurrent = 2
  policies:
    same_context_dedupe: 5min
    priority: high > normal > background
```

UI 在主控制台顶部显示：
```
Running: 2  |  Queued: 5  |  Today: 47 success / 3 failed
```

## 5. 验收标准

### 5.1 功能验收
- [ ] 任意运行中任务能在 1 步以内打开详情页
- [ ] 任务详情页有完整时间线，支持滚动加载历史日志
- [ ] SSE 断线 30s 后自动重连且不丢事件
- [ ] 9 种失败类别都至少有 1 个测试用例覆盖
- [ ] 每个失败类别都有"用户可采取的动作"文案
- [ ] 取消按钮在 ≤ 1s 内反映状态变化
- [ ] partial_success 状态正确出现在"半完成"场景
- [ ] 同一对象 5 分钟内重复提交会提示复用
- [ ] /metrics 端点暴露 task_total / failure_rate / queue_depth
- [ ] 主控制台顶部实时显示并发与今日统计
- [ ] 历史命令"再跑一次" 一键工作

### 5.2 性能验收
- [ ] task_event 写入延迟 ≤ 5ms（SQLite WAL）
- [ ] SSE 推送延迟 ≤ 50ms
- [ ] 取消响应 ≤ 1s
- [ ] 任务详情页 1000 条事件渲染 ≤ 200ms（虚拟列表）

### 5.3 工程验收
- [ ] 单测：失败分类映射、SSE 重连协议、重试策略
- [ ] 集成测试：模拟 SSE 断线、取消、重试全流程
- [ ] 故障注入：spawn 一个会随机崩溃的 mock executor 跑 100 个任务，验证状态最终一致性
- [ ] 文档：失败分类对照表、重试策略说明

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 事件数量爆炸（大任务上千事件） | 渲染卡 / SQLite 膨胀 | 虚拟列表 + log 类事件按 10 条/批合并 |
| SSE 在某些代理下被缓存 | 流式失效 | 加 `Cache-Control: no-cache` + `X-Accel-Buffering: no` |
| 取消后子进程不死 | 资源泄漏 | Job Object + 强制 SIGKILL + 启动时清理孤儿进程 |
| 重试导致循环失败 | 永远重试 | retry_count 上限 3，超过强制人工 |
| 失败分类误判 | 误导用户 | 兜底分类 internal_error，且日志可一键复制 |
| 多任务并发顺序变化 | 用户感知任务"乱跑" | UI 用稳定 task_id 排序，不按 status 排序 |

## 7. 交付物清单

```
src/service/
  ├─ events/sse.ts          (重连协议)
  ├─ executors/cancellable.ts
  ├─ failures/classifier.ts
  ├─ failures/user_messages.json
  └─ retry/
src/console/
  ├─ task_detail/
  │   ├─ timeline.tsx       (虚拟列表)
  │   ├─ log_viewer.tsx
  │   └─ retry_dialog.tsx
  └─ filters/
docs:
  failure_taxonomy.md
  retry_strategies.md
  phase_2_demo.mp4
```

## 8. 与下一 Phase 的接口

[Phase 2.5](phase_2_5_privacy_security.md) 会引入安全权限层。Phase 2 的事件总线和 ContextPacket 流要预留好"在 capture 之后、enqueue 之前"插入 Security Broker 的钩子。
