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

- 状态：done
- 执行分支：`task/uca-018-console-ui`
- 开始日期：2026-04-08
- 完成日期：2026-04-09
- 实际新增内容：console 总 view model 接入 runtime health / Code CLI / provider / budget 摘要；first-run wizard 接入 Kimi Code CLI 主路径推荐；task detail 接入 provider / model / retry / cost 摘要；新增 `verify-console-ui`；新增 console runtime client，从本地 HTTP 组装 approvals / schedules / budget / history / audit 各子页面快照；补齐 `/schedules/:id/runs` 的读取与手动触发接口；desktop runtime host 可直接创建 console client；console runtime client 新增 task detail 拉取、SSE 事件订阅、任务取消/重试、审批通过/拒绝、计划任务立即执行能力；Electron console renderer 已具备首启引导、任务列表/详情、审批、计划、模板、预算、历史搜索、隐私开关与审计日志的桌面工作台。
- 验证结果：`npm run check`、`node scripts/verify-desktop-renderer.mjs`、`node scripts/verify-console-rendered-workspace.mjs`、`powershell -ExecutionPolicy Bypass -File .\scripts\start-trial.ps1 -WithShell` 均通过。
- 遗留问题：页面级 SSE 断线重连和更细的视觉打磨仍可继续增强，但核心桌面操作流已闭环。
- 交接给下一个任务：UCA-019 / UCA-020 可直接复用当前桌面工作台、隐私设置入口、审计入口和已有的 HTTP runtime 操作链路做最终打磨与发布验证。
