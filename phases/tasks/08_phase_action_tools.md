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

- 状态：done
- 执行分支：`task/uca-008-action-tools`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 `src/service/action_tools/`，包含 registry、schema、risk matrix、12 类基础工具
  - 新增 `src/service/executors/tool_using/`，完成 bounded agent loop 与 tool call validator
  - 新增 `src/service/core/action-tool-submission.mjs`，把 tool-using executor 正式接入 task lifecycle
  - 新增 pending approvals / audit log 的 in-memory store 落点
  - 新增 console 侧 tool call confirm view model
  - 新增 `docs/action_tools/` 文档和 `scripts/verify-action-tools.mjs`
- 实际落地的工具列表：
  - `open_url`
  - `web_search`
  - `compose_email`
  - `send_email_smtp`
  - `open_file`
  - `reveal_in_explorer`
  - `launch_app`
  - `copy_to_clipboard`
  - `notify`
  - `file_op`
  - `take_screenshot`
  - `read_clipboard`
- execution_mode 最终状态值：
  - `interactive`
  - `unattended_safe`
  - `approval_required`
- 被拒绝的高风险动作行为：
  - `unattended_safe` 下高风险工具不会执行，任务返回 `partial_success`
  - `approval_required` 下需要确认的工具不会直接执行，而是写入 `pending_approvals`
  - `interactive` 下高风险工具进入 confirmation handler，可确认、编辑或拒绝
- 验证结果：
  - `node scripts/verify-structure.mjs`
  - `node scripts/verify-desktop-shell.mjs`
  - `node scripts/verify-service-core.mjs`
  - `node scripts/verify-file-kimi.mjs`
  - `node scripts/verify-browser-extension.mjs`
  - `node scripts/verify-status-metrics.mjs`
  - `node scripts/verify-action-tools.mjs`
- 遗留问题：
  - 工具执行当前仍是受控 placeholder，未直接连真实 OS API
  - SMTP、通知、剪贴板和应用启动还没有真实系统适配层
  - pending approvals 目前是内存态，尚未持久化到独立表
  - Security Broker 尚未插入 tool execution 前置链路
- 交接给下一个任务：
  - `UCA-009` 可直接复用 risk matrix、audit log、pending approvals 和 tool schema 做安全策略收口
  - `UCA-010` 可直接复用 `approval_required` 的 pending approval 语义做调度审批队列
