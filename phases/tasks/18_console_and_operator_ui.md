# Task UCA-018 — Console、Overlay 与操作员 UI 接线

## 1. 任务目标

把现有 view model 骨架接成真实 UI，让任务、审批、调度、模板、预算、历史搜索都能在桌面控制台里完成闭环。

## 2. 前置依赖

- 上一个任务：UCA-015、UCA-016
- 必须已有的产物：真实运行时、真实 HTTP / SSE、真实输入源
- 不能同时修改的区域：最终打包脚本

## 3. 实施范围

- 负责模块：console 渲染层、overlay 动作接线、task detail、pending approvals、schedules、template editor、budget dashboard、history search
- 允许改动文件/目录：`src/desktop/console/`, `src/desktop/overlay/`, `src/desktop/tray/`
- 明确不做：provider SDK 深度优化、团队协作功能

## 4. 交付产物

- 真实 console UI
- 真实 overlay 提交流程
- 审批/调度/模板/预算/历史搜索操作页
- 实时 task detail 和重试/取消操作

## 5. 验证方式

- `npm run check`
- 手动验证：提交任务、取消、重试、审批、计划任务、模板预览、预算提醒
- UI smoke / 截图回归

## 6. Git 执行方式

- 分支名：`task/uca-018-console-ui`
- Commit 格式：`UCA-018: implement console and operator ui`
- 合并条件：控制台主要工作流均可在真实 UI 中完成

## 7. 完成后必须更新本文件

- 写明已接线的页面与未接线页面
- 记录实时刷新与断线恢复表现
- 写明 overlay 与 console 的用户入口

## 8. 对下一个任务的交接

- 下一个任务：UCA-019、UCA-020
- 本任务新增了什么：真实操作员界面与 UI 闭环
- 下一个任务直接可复用什么：真实 console 页面、UI 事件流、用户操作入口
- 还没解决的问题：模板持久化细节、最终发布验证

## 9. 执行记录

- 状态：in_progress
- 执行分支：`task/uca-018-console-ui`
- 开始日期：2026-04-08
- 完成日期：
- 实际新增内容：console 总 view model 接入 runtime health / Code CLI / provider / budget 摘要；first-run wizard 接入 Kimi Code CLI 主路径推荐；task detail 接入 provider / model / retry / cost 摘要；新增 `verify-console-ui`。
- 验证结果：`npm run check` 通过；`verify-console-ui`、`verify-status-metrics`、`verify-security-broker` 均通过。
- 遗留问题：真实 Electron 渲染层、overlay 提交流程、pending approvals / schedules / history / templates 的页面级联动仍未完成。
- 交接给下一个任务：后续优先继续把 console 各子页面接到 HTTP / SSE；当前首启向导和任务详情已经可复用 runtime health 与 Code CLI 状态。
