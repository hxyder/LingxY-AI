# Task UCA-029 — 统一网页 / 图片 / 文字轻交互入口

## 1. 任务目标

把网页、图片、纯文本选区等非文件上下文统一接到和 Dock / Overlay 一样的一级轻交互模型里，减少用户在不同媒介间的心智切换。

## 2. 前置依赖

- 上一个任务：UCA-027、UCA-028
- 必须已有的产物：Dock 浮标、Overlay 气泡会话、浏览器扩展与图片 OCR 基础链
- 不能同时修改的区域：已冻结浏览器协议与安全 broker 基线

## 3. 实施范围

- 负责模块：网页选区 handoff、图片 handoff、纯文本 handoff、统一轻交互入口
- 允许改动文件/目录：`browser_ext/`, `src/desktop/`, `src/service/core/`, `phases/tasks/`
- 明确不做：复杂多窗口编排、跨设备同步

## 4. 交付产物

- 网页 / 图片 / 文本统一 handoff 到 Overlay 的交互路径
- 跨媒介一致的一级动作入口
- 对应自动验证与试用说明

## 5. 验证方式

- 浏览器扩展捕获 + Overlay 唤起 smoke test
- 图片 / 文本选区提交流程 smoke test
- `npm run check`

## 6. Git 执行方式

- 分支名：`task/uca-029-unified-capture`
- Commit 格式：`UCA-029: unify lightweight capture entrypoints`
- 合并条件：至少三类上下文都能进入同一套 Overlay 对话流程

## 7. 完成后必须更新本文件

- 写明已统一接入的上下文类型
- 写明交互差异和残余例外情况
- 写明下一步收敛方向

## 8. 对下一个任务的交接

- 下一个任务：Overlay 会话时间线与跟进任务
- 本任务新增了什么：跨媒介统一入口
- 下一个任务直接可复用什么：统一的 handoff payload 与 Overlay 气泡会话入口
- 还没解决的问题：复杂网页结构、跨站兼容性、视觉结果定位

## 9. 执行记录

- 状态：todo
- 执行分支：`main`
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
