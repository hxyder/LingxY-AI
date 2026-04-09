# Task UCA-007 — Phase 2 状态、取消、重试与指标

## 1. 任务目标

把任务系统从“能跑”提升到“清楚可控”，包括失败分类、重试、取消、指标和完整详情页。

## 2. 前置依赖

- 上一个任务：UCA-005、UCA-006
- 必须已有的产物：文件流、浏览器流、事件总线
- 不能同时修改的区域：安全层与调度器

## 3. 实施范围

- 负责模块：SSE 重连、失败分类、重试策略、取消、metrics、详情页
- 允许改动文件/目录：`src/service/events/`, `src/service/failures/`, `src/service/retry/`, `src/console/`
- 明确不做：脱敏和权限策略

## 4. 交付产物

- 完整任务时间线
- 失败分类映射
- 重试/取消能力
- `/metrics`

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
- 故障注入测试
- 手动验证：取消、重试、断线重连

## 6. Git 执行方式

- 分支名：`task/uca-007-phase2-status-metrics`
- Commit 格式：`UCA-007: complete task status and retry flow`
- 合并条件：9 类失败全部有测试覆盖

## 7. 完成后必须更新本文件

- 写明失败分类表最终版本
- 填写 metrics 字段
- 记录断线重连结果

## 8. 对下一个任务的交接

- 下一个任务：UCA-008、UCA-009
- 本任务新增了什么：稳定的 task lifecycle 与操作控制
- 下一个任务直接可复用什么：confirmation 流、任务状态、队列控制
- 还没解决的问题：权限、隐私、动作工具仍未接入

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-007-phase2-status-metrics`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 `src/service/failures/classifier.mjs` 与 `user_messages.json`，冻结失败分类与用户提示
  - 新增 `src/service/events/sse.mjs`，提供历史回放 + 订阅的事件流骨架
  - 新增 `src/service/retry/retry-manager.mjs`，支持 `retry_same` / `retry_modified` / `retry_different_executor`
  - 新增 `src/service/metrics/registry.mjs`，提供 `/metrics` 文本导出与 UI 统计快照
  - 新增 `src/service/core/task-runtime.mjs`，统一 task lifecycle、取消、失败和 executor event 应用
  - 升级 browser/file 提交链路，使其写入扩展后的 task 状态字段并支持取消 / retry lineage
  - 新增 console task detail / filters view model
  - 新增运行文档 `docs/operations/failure_taxonomy.md` 与 `docs/operations/retry_strategies.md`
- 失败分类表最终版本：
  - `context_capture_error`
  - `permission_denied`
  - `parse_error`
  - `tool_unavailable`
  - `cli_execution_error`
  - `model_call_error`
  - `output_save_error`
  - `user_interrupted`
  - `network_error`
  - `timeout`
  - `internal_error`
- metrics 字段：
  - `task_total`
  - `task_running`
  - `task_failed_total`
  - `task_cancelled_total`
  - `failure_rate`
  - `queue_depth`
  - `queue_running`
  - `today_success_total`
  - `today_failed_total`
- 断线重连结果：
  - 当前使用 `store.getTaskEventsSince(taskId, since)` 做重放
  - `createTaskEventStream()` 先返回 replay，再暴露订阅接口
  - 真实 HTTP SSE 端点和 30s 断线恢复仍待后续接入
- 验证结果：
  - `node scripts/verify-structure.mjs`
  - `node scripts/verify-desktop-shell.mjs`
  - `node scripts/verify-service-core.mjs`
  - `node scripts/verify-file-kimi.mjs`
  - `node scripts/verify-browser-extension.mjs`
  - `node scripts/verify-status-metrics.mjs`
- 遗留问题：
  - 真实 HTTP `/task/:id/events?since=` SSE 端点仍未接到网络层
  - `retry_resume` 仍未启用，因为执行器还没有 checkpoint 能力
  - 任务详情 UI 还是 view model 级别，还没接真实渲染层
  - dedupe 当前只做内存级 5 分钟窗口，未落到持久化存储
- 交接给下一个任务：
  - `UCA-008` 可直接复用 `retryable` / `failure_category` / `execution_mode` 这些字段把工具确认流接进 lifecycle
  - `UCA-009` 可在 `task-runtime` 的 `createTaskRecord` 与 enqueue 前后插入安全 Broker 和 redaction 审计
