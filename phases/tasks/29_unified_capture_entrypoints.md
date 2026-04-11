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

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-09
- 完成日期：2026-04-11
- 实际新增内容：
  - 浏览器右键菜单改为 handoff 到桌面 Overlay
  - 页面内浮动 chip 的 翻译/总结/解释 动作不再直接跳到桌面 Overlay —— 而是在网页上就地显示 Apple 风格内联结果框（由 UCA-037 接管），只有用户显式点击 "在对话框打开" 才 handoff
  - Overlay 新增网页 / 图片 / 文字选区上下文接收与统一提交逻辑
  - 浏览器 capture 任务支持按 executor 选择执行器
  - 统一的 handoff payload 追加了 `priorResult` / `priorUserCommand` 字段，实现跨媒介的跟进上下文传递
- 验证结果：`node scripts/verify-browser-extension.mjs`、`node scripts/verify-overlay-composer.mjs`、`node scripts/verify-desktop-renderer.mjs`、`npm run check` 通过
- 遗留问题：
  - 真实网页正文抓取仍以选区 / URL / 元数据为主，复杂网页结构化提取和跨浏览器细节还需要继续补强
  - **[已知缺陷]** 用户反馈：对不同段落连续触发翻译时，**第二次翻译显示的仍是上一段的内容** —— 怀疑是浮动 chip 的 selection state、service-worker 的 runQuickAction 闭包、或内联结果框旧实例导致，需要进一步定位（上下文：用户测试路径是网页上选中 A 段→翻译→换选 B 段→翻译）
  - **[与 UCA-047 冲突 / 待扩展]** 2026-04-11 新需求："检测当前活动的主窗口，可以直接基于主窗口，理解文件路径。如果是网页，可以识别链接，并进行一系列操作，当用户唤醒以后。" 本任务的 `capture-context.ps1` 只抓 clipboard 和 Explorer 选中文件；真正的 active window 深度抓取（浏览器 URL、Word/Excel 当前文件路径、VS Code 打开的文件等）由 UCA-047 继续做
- 交接给下一个任务：统一 handoff payload + priorResult 已成形，UCA-030 / UCA-038 直接复用此通道做会话记忆传递；UCA-047 在此基础上深化 active window extractor
