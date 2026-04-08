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

- 下一个任务：UCA-014
- 本任务新增了什么：可靠调度与审批队列
- 下一个任务直接可复用什么：schedule action model、pending approval entity、misfire 规则
- 还没解决的问题：模板化复用和 DAG 还未引入

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
