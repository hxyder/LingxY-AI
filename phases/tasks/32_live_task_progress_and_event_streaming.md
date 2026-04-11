# Task UCA-032 — 实时任务进度与事件流

## 1. 任务目标

把浮窗和桌面控制台的任务体验从“轮询后看到结果”升级成“实时看到任务步骤、状态变化和结果生成”。

## 2. 前置依赖

- 上一个任务：UCA-030、UCA-031
- 必须已有的产物：`/task/:id/events` SSE 端点、Overlay 会话时间线、Console 任务详情
- 不能同时修改的区域：任务事件存储 schema、运行时持久化基线

## 3. 实施范围

- 负责模块：renderer 侧 task event stream、Overlay 实时状态、Console 实时详情
- 允许改动文件/目录：`src/desktop/renderer/`, `src/service/events/`, `scripts/`, `phases/tasks/`
- 明确不做：服务端事件 schema 重构、跨设备推送

## 4. 交付产物

- 共享的 renderer 侧 task event stream 订阅模块
- Overlay 实时任务步骤与状态更新
- Console 任务详情实时时间线
- 对应验证脚本更新

## 5. 验证方式

- Overlay 提交任务后实时看到 `step_started / step_finished / success` 变化
- Console 选中任务后时间线可随事件实时增长
- `node scripts/verify-overlay-composer.mjs`
- `node scripts/verify-console-rendered-workspace.mjs`
- `npm run check`

## 6. Git 执行方式

- 分支名：`task/uca-032-live-task-progress`
- Commit 格式：`UCA-032: add live task progress streaming`
- 合并条件：用户在桌面 UI 中不必等待完整轮询，也能看见任务步骤变化

## 7. 完成后必须更新本文件

- 写明 Overlay 和 Console 分别如何消费 task events
- 写明哪些事件会即时展示，哪些事件仍然依赖补充刷新
- 写明回退策略

## 8. 对下一个任务的交接

- 下一个任务：跨媒介入口的一致状态提示与更细粒度通知
- 本任务新增了什么：共享 task-event-stream 模块与实时事件订阅体验
- 下一个任务直接可复用什么：事件摘要、任务事件订阅、实时状态 patch
- 还没解决的问题：更丰富的进度条、长文本 log 折叠、后台多任务聚合视图

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-10
- 完成日期：2026-04-11
- 实际新增内容：
  - 新增 `src/desktop/renderer/task-event-stream.js` 作为共享 renderer 侧 SSE 订阅模块
  - Overlay 在提交或载入任务后订阅 `/task/:id/events`，实时更新状态文案、步骤记录和结果生成提示
  - Console 任务详情订阅所选任务的事件流，实时补进时间线并 patch 任务状态摘要
  - Apple 风格 pop bubble：任务完成后气泡居中弹出，3-4 秒后自动消失；用户点击输入框 / 气泡会取消 auto-hide 进入"持久"模式
- 验证结果：`node scripts/verify-overlay-composer.mjs`、`node scripts/verify-console-rendered-workspace.mjs`、`npm run check` 通过
- 遗留问题：
  - 当前仍以事件摘要和关键状态为主，尚未做长日志折叠、细粒度进度条和多任务并行事件聚合视图
  - 多任务并发时的"任务切换"UI 尚未实现 —— 现在同时只能追踪一个 activeTaskId
- 交接给下一个任务：可直接复用 `task-event-stream.js`、`formatTaskEventSummary` 和任务状态 patch 逻辑
