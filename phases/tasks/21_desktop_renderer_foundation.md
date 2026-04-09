# Task UCA-021 — 真实桌面渲染壳基础层

## 1. 任务目标

把当前 Electron data-url 壳升级成真正可扩展的 renderer 结构，建立托盘、主控制台、浮窗的真实页面加载、预加载桥与基础 UI 布局。

## 2. 前置依赖

- 上一个任务：UCA-015、UCA-018、UCA-020
- 必须已有的产物：本地 runtime、窗口 manifest、HTTP runtime client
- 不能同时修改的区域：浏览器扩展与 Office add-in

## 3. 实施范围

- 负责模块：Electron main 窗口加载、preload bridge、renderer HTML/CSS/JS、基础桌面导航
- 允许改动文件/目录：`src/desktop/`, `scripts/`, `docs/`
- 明确不做：Explorer 右键弹窗、浮窗文件上下文接力、最终视觉打磨

## 4. 交付产物

- 真正的本地 renderer 页面
- console / overlay 基础 UI
- preload bridge
- renderer 验证脚本

## 5. 验证方式

- `node scripts/verify-desktop-renderer.mjs`
- `npm run check`
- Electron main 可解析 renderer 入口

## 6. Git 执行方式

- 分支名：`task/uca-021-desktop-renderer`
- Commit 格式：`UCA-021: build desktop renderer foundation`
- 合并条件：桌面壳不再使用 data-url 占位页面

## 7. 完成后必须更新本文件

- 写明 renderer 目录结构
- 写明 preload 暴露能力
- 记录 console / overlay 当前可做的交互

## 8. 对下一个任务的交接

- 下一个任务：UCA-022、UCA-023、UCA-024
- 本任务新增了什么：真实桌面 UI 基础层
- 下一个任务直接可复用什么：renderer 页面、preload bridge、窗口装载方式
- 还没解决的问题：右键文件后的输入弹窗、浮窗上下文接力、完整管理台页面

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-021-desktop-renderer`
- 开始日期：2026-04-08
- 完成日期：2026-04-09
- 实际新增内容：新增 `src/desktop/renderer/` 真实 renderer 目录，包含 `console.html/.js`、`overlay.html/.js`、`shared.css` 和 `preload.cjs`；Electron main 从 data-url 占位页切换到本地 HTML 页面加载；新增 `uca:shell-show-window` / `uca:shell-hide-window` IPC；console 页面具备 runtime 状态、快速文本任务提交、最近任务列表的基础布局；overlay 页面具备快捷动作、输入框和提交按钮的基础布局；新增 `verify-desktop-renderer` 并接入全量校验；后续 UCA-022、UCA-023、UCA-024 已分别在此基础上补齐浮窗交互、文件右键输入和完整桌面工作台。
- 验证结果：`verify-structure`、`verify-desktop-shell`、`verify-desktop-renderer`、`npm run check`、`powershell -ExecutionPolicy Bypass -File .\scripts\start-trial.ps1` 均已通过。
- 遗留问题：桌面渲染基础层已完成，后续只剩持续的体验打磨与发布细化，不再属于本任务范围。
- 交接给下一个任务：下一个阶段可直接复用完整 renderer 页面、preload bridge、窗口装载方式和已落地的 console / overlay / handoff UI。
