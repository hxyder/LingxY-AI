# Task UCA-024 — 控制台真实工作台 UI

## 1. 任务目标

把当前 console view model 接成真正的管理界面，让任务列表、详情、审批、计划任务、模板、预算和历史搜索都能在可视化桌面界面里操作。

## 2. 前置依赖

- 上一个任务：UCA-021、UCA-019
- 必须已有的产物：renderer 基础层、runtime client、平台持久化 API
- 不能同时修改的区域：发布签名与安装器

## 3. 实施范围

- 负责模块：控制台主工作台、任务列表、详情抽屉、审批页、模板页、预算页、历史搜索页
- 允许改动文件/目录：`src/desktop/console/`, `src/desktop/renderer/`, `docs/`
- 明确不做：多人协作、云同步

## 4. 交付产物

- 真正的桌面控制台
- 任务管理与追踪界面
- 审批与计划任务管理页
- 模板 / 预算 / 历史搜索页

## 5. 验证方式

- renderer smoke
- 手动回归：任务详情、审批、模板、预算、历史搜索
- `npm run check`

## 6. Git 执行方式

- 分支名：`task/uca-024-console-workspace`
- Commit 格式：`UCA-024: build rendered console workspace`
- 合并条件：非技术用户可通过控制台完成主要管理操作

## 7. 完成后必须更新本文件

- 写明已接线页面
- 写明未完成页面
- 记录 UI 状态同步和刷新策略

## 8. 对下一个任务的交接

- 下一个任务：发布体验打磨与试用反馈
- 本任务新增了什么：面向最终用户的主控工作台
- 下一个任务直接可复用什么：真实桌面管理界面、任务管理流程、设置入口
- 还没解决的问题：安装体验、视觉细化、试用反馈闭环

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-024-console-workspace`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：已把 Electron console renderer 升级为桌面工作台布局，并接上任务列表/详情、审批、计划、模板、预算、历史搜索的本地 runtime 读写链路；新增 `verify-console-rendered-workspace.mjs` 收口桌面工作台结构校验；补充了桌面壳启动烟测，确认控制台与浮窗走 Electron，而不是浏览器页面。
- 验证结果：`node scripts/verify-desktop-renderer.mjs`、`node scripts/verify-console-rendered-workspace.mjs`、`npm run check`、`powershell -ExecutionPolicy Bypass -File .\scripts\start-trial.ps1 -WithShell`
- 遗留问题：需要继续做视觉细化、真实用户流程打磨和发布安装体验，但当前桌面工作台已经具备一级管理操作能力。
- 交接给下一个任务：下一个任务可直接在当前桌面工作台基础上做发布体验打磨、真实用户试用回路、首启引导和安装后默认入口收口。
