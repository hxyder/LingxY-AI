# Task UCA-022 — 浮窗输入器与快捷动作

## 1. 任务目标

把浮窗从占位 view model 升级成真正的轻量输入器，支持快捷输入、剪贴板上下文、最近任务反馈与最小化动作入口。

## 2. 前置依赖

- 上一个任务：UCA-021
- 必须已有的产物：真实 renderer 页面、preload bridge、runtime HTTP API
- 不能同时修改的区域：Explorer 右键集成

## 3. 实施范围

- 负责模块：overlay renderer、快捷动作、最近任务 toast、快捷键响应
- 允许改动文件/目录：`src/desktop/overlay/`, `src/desktop/renderer/`, `src/desktop/tray/`
- 明确不做：系统级跟随鼠标浮窗、复杂动效系统

## 4. 交付产物

- 可输入指令的浮窗
- 快捷动作按钮
- 最近一次任务状态反馈

## 5. 验证方式

- renderer smoke
- 提交文本任务 happy path
- 快捷键拉起浮窗验证

## 6. Git 执行方式

- 分支名：`task/uca-022-overlay-composer`
- Commit 格式：`UCA-022: build overlay composer`
- 合并条件：浮窗可独立完成一次文本任务提交

## 7. 完成后必须更新本文件

- 写明浮窗布局与交互
- 写明快捷键行为
- 记录已支持的上下文类型

## 8. 对下一个任务的交接

- 下一个任务：UCA-023、UCA-024
- 本任务新增了什么：可实际输入和执行的浮窗层
- 下一个任务直接可复用什么：浮窗表单、任务反馈区域、快捷动作
- 还没解决的问题：文件右键输入弹窗、完整控制台管理页

## 9. 执行记录

- 状态：todo
- 执行分支：`task/uca-022-overlay-composer`
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
