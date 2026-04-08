# Task UCA-008 — Action Tools 与执行模式分流

## 1. 任务目标

为系统增加受控工具调用能力，并明确 interactive / unattended_safe / approval_required 三种执行模式。

## 2. 前置依赖

- 上一个任务：UCA-007
- 必须已有的产物：confirmation 流、任务状态与审计入口
- 不能同时修改的区域：Security Broker 细节实现

## 3. 实施范围

- 负责模块：ActionToolRegistry、ToolUsingExecutor、风险矩阵、12 类基础工具
- 允许改动文件/目录：`src/service/action_tools/`, `src/service/executors/tool_using/`, `src/console/tool_call_confirm/`
- 明确不做：任意 shell、桌面 GUI 自动化

## 4. 交付产物

- 工具注册表
- Agent loop
- 风险矩阵
- execution_mode 分流

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
- 工具 schema 校验
- 手动验证 compose_email / file_op / notify / web_search

## 6. Git 执行方式

- 分支名：`task/uca-008-action-tools`
- Commit 格式：`UCA-008: add action tools and execution modes`
- 合并条件：high-risk 工具确认链路全部通过

## 7. 完成后必须更新本文件

- 写明实际落地的工具列表
- 写明 execution_mode 最终状态值
- 记录被拒绝的高风险动作行为

## 8. 对下一个任务的交接

- 下一个任务：UCA-009、UCA-010
- 本任务新增了什么：系统动作层与 agent tool loop
- 下一个任务直接可复用什么：工具 schema、风险矩阵、pending approval 接口
- 还没解决的问题：安全审计和调度器还未闭环

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
