# Task UCA-010 — Scheduler、Pending Approval 与无人值守语义

## 1. 任务目标

让定时/触发任务可靠落地，并通过 `pending_approvals` 解决无人值守高风险动作的授权问题。

## 2. 前置依赖

- 上一个任务：UCA-008、UCA-009
- 必须已有的产物：execution_mode、Security Broker、audit_log
- 不能同时修改的区域：Office 与 PDF 能力

## 3. 实施范围

- 负责模块：Scheduler、schedules 表、schedule_runs 表、pending_approvals 表、计划任务 UI
- 允许改动文件/目录：`src/service/scheduler/`, `src/console/schedules/`, `src/service/action_tools/tools/`
- 明确不做：集群调度、任意 shell

## 4. 交付产物

- cron / file_watch / interval 触发器
- pending approval 队列
- TTL、superseded、审计
- 计划任务管理页

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
- misfire 测试
- 手动验证：create_scheduled_task、approve / reject / expire

## 6. Git 执行方式

- 分支名：`task/uca-010-scheduler-pending-approval`
- Commit 格式：`UCA-010: implement scheduler and pending approvals`
- 合并条件：无人值守与审批两条路径都跑通

## 7. 完成后必须更新本文件

- 写明支持的 trigger 类型
- 写明 pending_approvals 状态流
- 记录 schedule 上限与保护规则

## 8. 对下一个任务的交接

- 下一个任务：UCA-011、UCA-014
- 本任务新增了什么：可靠调度与审批队列
- 下一个任务直接可复用什么：schedule action model、pending approval entity、misfire 规则
- 还没解决的问题：模板化复用和 DAG 还未引入

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-010-scheduler-pending-approval`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 支持的 trigger 类型：
  - `cron`
  - `interval`
  - `file_watch`
  - `clipboard_watch`
- pending_approvals 状态流：
  - `pending -> approved`
  - `pending -> rejected`
  - `pending -> expired`
  - `pending -> superseded`
- schedule 上限与保护规则：
  - 单实例最大 `50` 个 schedule
  - `approval_required` 一律不直接执行，而是进入 `pending_approvals`
  - `unattended_safe` 遇到高风险 action tool 会自动转入 `pending_approvals`
  - misfire `run_all` 仍受恢复枚举上限保护，避免 catch-up 雪崩
  - 连续失败 `3` 次会自动 disable
- 实际新增内容：
  - 新增 `src/service/scheduler/`，落地 `engine / store / dispatch / misfire / failure_guard / nl_to_cron / pending-approvals / execute-action`
  - 将 `pending_approvals` 从 Action Tool loop 的局部逻辑抽成共享服务，补齐 `approve / reject / expire / superseded / resulting_task_id`
  - 在 in-memory store 与 SQLite schema manifest 中加入 `schedules / schedule_runs / pending_approvals`
  - 新增 4 个 scheduler action tools：`create_scheduled_task`、`list_scheduled_tasks`、`delete_scheduled_task`、`pause_scheduled_task`
  - 新增 console 侧 `schedules` 与 `pending-approvals` 视图模型
  - 新增 `docs/scheduler/` 与 `scripts/verify-scheduler.mjs`
- 验证结果：
  - `npm run check`
  - `node scripts/verify-scheduler.mjs`
- 遗留问题：
  - 真实 `node-cron` / `chokidar` watcher 尚未接入，目前是本地调度骨架与手动事件入口
  - `pending_approvals` 和 `schedule_runs` 仍是内存态，没有真实 SQLite DAO
  - task template 执行目前是 fast-executor 占位路径，还不是可配置模板引擎
  - **[与 UCA-046 冲突 / 待扩展]** 2026-04-11 新需求：scheduler 需要支持 **提前通知**（lead time reminder）和 **分类标签**（颜色 + 类别）。参考 Teams Calendar：8 小时 / 1 天任务默认提前 1 小时；1 周任务默认提前 1 天；用户可在创建时自定义，或通过 schedule 任务与 "需要用户做但还没做" 的状态互斥规则调整。本任务的 `schedule` 实体需在 UCA-046 里扩展 `{ category, color, leadTimeMs, userTodo: boolean, lastReminderAt }` 字段，scheduler engine 要加一条"到达 (run_at - leadTime) 时发通知"的 watcher 规则
  - “编辑参数后批准 / 推迟到明天” 还停留在 view model 和语义层，未接真实 UI 交互
- 交接给下一个任务：
  - `UCA-011` 可直接复用 `pending_approvals`、`/approvals`、console 视图模型入口，以及 `execution_mode` 语义做浏览器内动作确认
  - `UCA-014` 可直接复用 `schedule action model`、`schedule_runs`、misfire 策略和共享审批实体，继续往模板化与 DAG 扩展
