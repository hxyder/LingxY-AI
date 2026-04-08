# Phase Scheduler — 定时与触发任务（新增 Phase）

> 周期估计：W22–W24（3 周） · 角色：1 后端 + 0.5 前端
> 上一阶段：[Phase Action Tools](phase_action_tools.md) · 下一阶段：[Phase 4](phase_4_office_integration.md)

## 1. 目标

让 UCA 支持"按时间或事件触发"的任务，并允许 LLM 在对话中自主创建。

> **示例 1（用户显式）**：用户在浮窗输入「每天早上 9 点帮我整理过去 24 小时收到的所有邮件草稿摘要」。
> Scheduler 创建一个 cron 任务 `0 9 * * *`，每天触发一次，调用 `compose_email_summary` 工作流，并把结果通知到 Toast。
>
> **示例 2（AI 自主）**：用户说「这个月每个工作日下班前提醒我写一下工作日报」。
> LLM 解析为 cron `0 17 * * 1-5`，调用 `create_scheduled_task` 工具，参数为通知任务。
> 用户在确认对话框点确认即激活。
>
> **示例 3（事件触发）**：用户说「以后只要我把任何 .pdf 文件丢到 ~/Desktop/inbox/，就自动总结后归档到 ~/Desktop/archive/」。
> Scheduler 创建一个文件夹监听任务，事件触发时调度子任务。

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | Scheduler 核心 | 基于 node-cron 的定时调度器 |
| 2 | Schedule 数据模型 | SQLite 持久化 |
| 3 | Cron 触发 | 标准 cron 表达式 |
| 4 | 文件/目录变化触发 | chokidar 监听 |
| 5 | 剪贴板变化触发 | 周期性 hash 比对（可选） |
| 6 | 错过的触发处理 | catchup 策略：skip / run_once / run_all |
| 7 | 任务入队 | 触发后走标准 Task Queue |
| 8 | LLM 工具：`create_scheduled_task` | Action Tool 注册项 |
| 9 | LLM 工具：`list_scheduled_tasks` | 查询 |
| 10 | LLM 工具：`delete_scheduled_task` | 取消 |
| 11 | LLM 工具：`pause_scheduled_task` | 暂停 |
| 12 | UI: 计划任务管理页 | 列表/编辑/启停/手动触发/历史 |
| 13 | 自然语言转 cron | "每天 9 点" → "0 9 * * *"（用 LLM 或 chrono-node） |
| 14 | 通知集成 | 触发完成走 Phase Action Tools 的 notify |
| 15 | 重启恢复 | service 重启时自动加载所有 enabled 任务 |

### 2.2 不做

- 集群/分布式调度（这是单机程序）
- 跨设备同步（Phase 6 评估）
- 复杂工作流（DAG）触发（Phase 6 评估）
- 网络请求触发（webhook 监听）— Phase 6 评估
- 系统事件触发（开机/关机/锁屏）— 评估中

### 2.3 范围红线

- 任何定时任务的"动作"必须是已存在的 task template / action tool
- 定时任务**不能**直接执行任意 shell 命令
- 触发后的执行仍然走完整安全链路（Security Broker、确认、配额）

## 3. 架构

### 3.1 组件位置

```
┌────────────────────────────────────┐
│  uca-service                        │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  Scheduler Module            │  │   ← 新增
│  │  - cron engine (node-cron)   │  │
│  │  - file watcher (chokidar)   │  │
│  │  - clipboard watcher (opt.)  │  │
│  │  - SQLite: schedules/runs    │  │
│  │  - misfire policy            │  │
│  └────────────┬─────────────────┘  │
│               │ trigger             │
│               ▼                     │
│  ┌──────────────────────────────┐  │
│  │  Task Queue                  │  │   (已存在)
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  Action Tool Registry        │  │   (Phase Action Tools)
│  │  + create_scheduled_task     │  │   ← 新增
│  │  + list_scheduled_tasks      │  │
│  │  + delete_scheduled_task     │  │
│  │  + pause_scheduled_task      │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

### 3.2 数据模型

```sql
CREATE TABLE schedules (
  schedule_id TEXT PRIMARY KEY,           -- "sched_xxx"
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,                         -- "user" | "agent"
  -- 触发器
  trigger_type TEXT NOT NULL,              -- 'cron' | 'file_watch' | 'clipboard_watch' | 'interval'
  trigger_config_json TEXT NOT NULL,       -- type-specific
  -- 动作
  action_type TEXT NOT NULL,               -- 'task_template' | 'action_tool'
  action_target TEXT NOT NULL,             -- template_id 或 tool_id
  action_params_json TEXT NOT NULL,
  -- 策略
  catchup_policy TEXT NOT NULL DEFAULT 'skip',  -- 'skip' | 'run_once' | 'run_all'
  max_runtime_seconds INTEGER DEFAULT 600,
  next_run_at INTEGER,
  last_run_at INTEGER,
  last_run_status TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sched_enabled_next ON schedules(enabled, next_run_at);

CREATE TABLE schedule_runs (
  run_id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id TEXT NOT NULL,
  task_id TEXT,                            -- 关联到主 tasks 表
  triggered_at INTEGER NOT NULL,
  trigger_reason TEXT,                     -- 'cron' | 'file_event' | 'manual'
  status TEXT NOT NULL,                    -- 'success' | 'failed' | 'skipped'
  error_message TEXT,
  FOREIGN KEY(schedule_id) REFERENCES schedules(schedule_id)
);
CREATE INDEX idx_runs_sched_time ON schedule_runs(schedule_id, triggered_at DESC);
```

### 3.3 触发器类型

#### Cron 触发

```jsonc
{
  "trigger_type": "cron",
  "trigger_config": {
    "expression": "0 9 * * 1-5",
    "timezone": "Asia/Shanghai"
  }
}
```

实现：node-cron。每个 schedule 注册一个 cron job，handler 调用 `Scheduler.dispatch(scheduleId, 'cron')`。

#### 文件变化触发

```jsonc
{
  "trigger_type": "file_watch",
  "trigger_config": {
    "path": "C:/Users/der/Desktop/inbox",
    "recursive": false,
    "events": ["add"],                      // add | change | unlink
    "glob": "*.pdf",
    "debounce_ms": 1000
  }
}
```

实现：chokidar。文件事件 → debounce → dispatch。注意：文件刚出现时大小可能还在变，要等 stable size 才触发。

#### Interval 触发

```jsonc
{
  "trigger_type": "interval",
  "trigger_config": {
    "seconds": 3600
  }
}
```

简单的"每 N 秒一次"。用 setInterval 或 cron。

#### 剪贴板变化触发（可选）

```jsonc
{
  "trigger_type": "clipboard_watch",
  "trigger_config": {
    "poll_interval_ms": 2000,
    "min_text_length": 50
  }
}
```

实现：周期性 hash 比对（不监听系统级 clipboard 事件以避免和 Phase 1a 冲突）。

### 3.4 Misfire 策略

程序关闭期间错过的触发该怎么办？

| 策略 | 行为 | 适用场景 |
|---|---|---|
| `skip` | 跳过所有错过 | 默认；提醒类任务 |
| `run_once` | 启动后立刻补跑一次 | 数据同步类 |
| `run_all` | 启动后按顺序补跑所有错过的 | 严格记账类（基本不用） |

启动时计算 `now - last_run_at`，根据 cron 表达式找出所有错过的时间点，按策略处理。

### 3.5 LLM 工具集成

把 Scheduler 暴露为 4 个 Action Tools：

```jsonc
// 给 LLM 的工具描述
{
  "name": "create_scheduled_task",
  "description": "创建一个定时或事件触发的任务。用户说'每天 9 点...'或'当文件夹有新文件时...'时使用。需要用户确认才会激活。",
  "input_schema": {
    "type": "object",
    "required": ["name", "trigger", "action"],
    "properties": {
      "name": { "type": "string", "description": "任务的简短名称" },
      "description": { "type": "string" },
      "trigger": {
        "oneOf": [
          { "type": "object", "properties": { "type": {"const":"cron"}, "expression": {"type":"string"}, "timezone": {"type":"string"} } },
          { "type": "object", "properties": { "type": {"const":"file_watch"}, "path": {"type":"string"}, "glob": {"type":"string"}, "events": {"type":"array"} } },
          { "type": "object", "properties": { "type": {"const":"interval"}, "seconds": {"type":"integer"} } }
        ]
      },
      "action": {
        "type": "object",
        "required": ["type","target"],
        "properties": {
          "type":   { "enum": ["task_template","action_tool"] },
          "target": { "type": "string" },
          "params": { "type": "object" }
        }
      }
    }
  }
}
```

**重要**：`create_scheduled_task` 是 high 风险工具（会影响未来行为），必须强制确认。

### 3.6 自然语言转 trigger

两步：

1. **常见模式正则匹配**：
   - "每天 9 点" → `0 9 * * *`
   - "工作日早上 8 点半" → `30 8 * * 1-5`
   - "每周一" → `0 0 * * 1`
   - "每 30 分钟" → `*/30 * * * *`

2. **正则失败 → 让 LLM 转换**：发一个专门的 prompt，让 LLM 输出 cron 表达式，并校验合法性。

如果两步都失败，提示用户手动输入。

### 3.7 重启恢复

```typescript
async function onServiceStart() {
  const enabledSchedules = await db.schedules.findEnabled();
  for (const s of enabledSchedules) {
    if (s.trigger_type === 'cron') {
      cronEngine.register(s);
      // 处理 misfire
      const missed = computeMissed(s);
      await applyMisfirePolicy(s, missed);
    } else if (s.trigger_type === 'file_watch') {
      fileWatcher.register(s);
    }
    // ...
  }
}
```

### 3.8 无人值守授权模型（补充）

Scheduler 和普通交互式任务最大的区别，是它可能发生在**用户不在电脑前**的时候。因此需要在协议里明确：

```jsonc
{
  "execution_mode": "unattended_safe | approval_required"
}
```

规则：
- `unattended_safe`：允许自动执行，但只限低风险动作，且参数在创建 schedule 时已经冻结并确认
- `approval_required`：触发时**不直接执行**，而是生成一条 `pending_approval` 任务或草稿，等待用户在控制台确认
- 任何 high-risk action tool（如 `send_email_smtp`、`file_op.delete`、白名单外 `launch_app`）默认都只能落到 `approval_required`
- LLM 在创建 schedule 时必须把这一点展示给用户，而不是让用户误以为所有动作都会后台自动完成

Scheduler 的自动执行边界如下：

- 适合自动执行的任务：提醒、总结、归档、生成草稿
- 不适合自动执行的任务：直接发送、覆盖原文、删除文件、启动高风险外部程序
- 所有不适合自动执行的动作都要落入 `pending_approvals`

### 3.9 Pending Approval 数据模型

`approval_required` 模式不是普通 task，而是新的持久化实体。统一定义如下：

```sql
CREATE TABLE pending_approvals (
  approval_id        TEXT PRIMARY KEY,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  source_type        TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  proposed_action    TEXT NOT NULL,
  proposed_target    TEXT NOT NULL,
  proposed_params    TEXT NOT NULL,
  preview_text       TEXT,
  status             TEXT NOT NULL,
  decided_at         INTEGER,
  decided_by         TEXT,
  resulting_task_id  TEXT
);
CREATE INDEX idx_pending_status ON pending_approvals(status, expires_at);
CREATE INDEX idx_pending_source ON pending_approvals(source_type, source_id);
```

配套运行语义：

- **TTL**：默认 7 天；service 启动时和每小时一次扫描过期条目，标记为 `expired`
- **过期处理**：过期不执行，但写入 `schedule_runs(status='expired')`
- **去重**：同一个 `source_id` 若已有 `pending` 条目，新条目默认取代旧条目，并把旧条目标记为 `superseded`
- **审计**：`trigger / approve / reject / expire / supersede` 都必须写 `audit_log`
- **UI 入口**：
  - 主控制台提供“待我处理 (N)”页面
  - 托盘图标在有 pending 时显示角标
  - 每条支持 `[批准] [拒绝] [编辑参数后批准] [推迟到明天]`

## 4. 流程设计

### 4.1 用户显式创建定时任务

```
1. 用户在浮窗输入: "每天早上 9 点提醒我喝水"
2. IntentRouter → 识别为 schedule_request
3. 路由到 Tool-Using Executor
4. LLM:
   parse_natural_time("每天早上 9 点") → "0 9 * * *"
   tool_call(create_scheduled_task, {
     name: "每日喝水提醒",
     trigger: {type:"cron", expression:"0 9 * * *"},
     action: {type:"action_tool", target:"notify", params:{title:"该喝水了 💧", body:"..."}}
   })
5. 重确认 UI:
   ┌─────────────────────────────────┐
   │ 创建定时任务                       │
   │ 名称: 每日喝水提醒                  │
   │ 触发: 每天 09:00                   │
   │ 动作: 弹出通知 "该喝水了 💧"        │
   │ [确认] [编辑] [取消]                │
   └─────────────────────────────────┘
6. 用户确认 → 写入 schedules 表 → cron 注册 → 立即生效
7. LLM 收到 observation: "Schedule sched_xxx created."
8. final_text: "已为您设置每天 9 点的喝水提醒，您可以在控制台'计划任务'中管理。"
```

### 4.2 文件夹监听 → 自动归档

```
1. 用户: "以后丢到 inbox/ 的 PDF 自动总结后归档到 archive/"
2. LLM 分两步:
   tool_call(create_scheduled_task, {
     name: "PDF 自动归档",
     trigger: {type:"file_watch", path:"~/Desktop/inbox", glob:"*.pdf", events:["add"]},
     action: {type:"task_template", target:"pdf_summarize_and_archive", params:{archive_to:"~/Desktop/archive"}}
   })
3. 用户确认
4. chokidar 注册监听
5. 用户拖一个 paper.pdf 到 inbox
6. 文件 stable → debounce → dispatch
7. 创建 task: pdf_summarize_and_archive(file=paper.pdf, archive_to=...)
8. task 完成后 → 通知用户 "已归档 paper.pdf → archive/"
```

### 4.3 触发执行流程

```
[Trigger fires]
     │
     ▼
[Scheduler.dispatch(scheduleId, reason)]
     │
     ├─ 写 schedule_runs (status=triggered)
     │
     ▼
[Build TaskFromAction]
     │   - 复用 schedule.action 配置
     │   - source_context 标记为 trigger 派生
     │
     ▼
[Security Broker]    ← 仍然走，不绕过
     │
     ▼
[Execution Mode Gate]
     │  unattended_safe → 直接入队
     │  approval_required → 生成 pending_approval，不直接执行
     ▼
[Task Queue / Pending Approval Queue]
     │
     ▼
[Executor]  →  执行
     │
     ▼
[Result]
     │
     ├─ 写 schedule_runs (status=success/failed)
     ├─ 更新 schedules.last_run_at, run_count
     ├─ 失败时 failure_count++
     │
     ▼
[Notification (如配置)]
```

### 4.4 失败保护

- 同一 schedule 连续失败 ≥ 3 次 → 自动 disable，并 toast 通知用户
- 防止"无限失败循环"
- 用户可在控制台手动 re-enable

## 5. 验收标准

### 5.1 功能验收
- [ ] 用户能在控制台手动创建/编辑/启停/删除定时任务
- [ ] LLM 通过 `create_scheduled_task` 工具能创建任务
- [ ] cron 表达式支持标准 5 字段
- [ ] 自然语言（"每天 9 点" / "工作日 17:00" / "每周一" / "每 30 分钟"）能正确转 cron
- [ ] 文件监听能正确检测 add/change/unlink
- [ ] 文件 stable 检测有效（不在文件还在写时触发）
- [ ] 服务重启后所有 enabled 任务自动恢复
- [ ] misfire skip 策略正确丢弃错过的触发
- [ ] misfire run_once 启动后正确补跑一次
- [ ] 任务连续失败 3 次自动 disable
- [ ] 触发的执行仍走 Security Broker 与确认
- [ ] schedule_runs 历史可在 UI 查看 ≥ 30 天
- [ ] 手动触发按钮立即执行
- [ ] 删除 schedule 同时清理 cron 注册和 watcher

### 5.2 性能/可靠性验收
- [ ] cron 触发延迟 ≤ 1s
- [ ] file_watch 触发延迟 ≤ debounce + 200ms
- [ ] 重启恢复 100 个 schedule ≤ 2s
- [ ] 同一秒内多个 schedule 触发不互相阻塞
- [ ] 时区切换不导致重复触发

### 5.3 工程验收
- [ ] 单测：cron 解析、自然语言转换、misfire 策略、stable file 检测
- [ ] 集成测试：完整 trigger → task → result 链路
- [ ] 故障注入：service 强杀重启后定时任务正确恢复
- [ ] 文档：cron 表达式速查、触发器类型对比

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| LLM 误创建大量定时任务 | 资源浪费 | high 风险 + 强制确认 + 单用户最多 50 个 schedule |
| cron 表达式自然语言转换错误 | 触发时间不对 | 双重校验：正则 + LLM；UI 显示"下次运行时间"让用户验证 |
| 文件监听内存泄漏 | service 内存爆 | chokidar 数量上限 + 路径深度限制 |
| 触发任务死循环（任务又创建定时任务）| 资源耗尽 | schedule 标记 created_by；agent 创建的不能再创建 schedule |
| 错过触发后 run_all 雪崩 | 短时间大量任务 | run_all 仅手动开启，且最多补跑 10 次 |
| 时区/夏令时 | 触发时间偏移 | 显式存 timezone；启动时校验 |
| 用户睡眠/休眠时未触发 | 错过 | misfire 策略 |
| 文件夹被删除 | watcher 异常 | 失败重试 + disable + 通知 |
| 系统重启后服务未起 | 任务全跑不了 | 引导用户开启开机自启 |

## 7. 交付物清单

```
src/service/
  ├─ scheduler/
  │   ├─ engine.ts                  cron 引擎封装
  │   ├─ file_watcher.ts            chokidar 封装
  │   ├─ store.ts                   schedules / schedule_runs
  │   ├─ misfire.ts                 misfire 策略
  │   ├─ nl_to_cron.ts              自然语言转 cron
  │   ├─ failure_guard.ts           连续失败 disable
  │   └─ dispatch.ts                trigger → task
  └─ action_tools/tools/
      ├─ create_scheduled_task.ts
      ├─ list_scheduled_tasks.ts
      ├─ delete_scheduled_task.ts
      └─ pause_scheduled_task.ts
src/console/
  └─ schedules/
      ├─ list.tsx
      ├─ editor.tsx
      ├─ history.tsx
      └─ next_run_preview.tsx
docs:
  ├─ cron_cheatsheet.md
  ├─ trigger_types.md
  ├─ misfire_policies.md
  └─ phase_scheduler_demo.mp4
```

## 8. 与其他 Phase 的接口

- **依赖 Phase Action Tools**：定时任务的 action 通常是 action tool 调用；create_scheduled_task 自身就是一个 action tool
- **依赖 Phase 2.5 Security Broker**：触发的任务仍走完整安全链路
- **依赖 Phase 2 Confirmation**：创建 schedule 是 high 风险动作
- **被 Phase 6 使用**：动作模板可以注册为 schedule 的 action
- **不依赖** Phase 4 / Phase 5 — 可以与它们并行开发
