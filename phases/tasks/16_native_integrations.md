# Task UCA-016 — 原生入口与系统集成落地

## 1. 任务目标

把文件入口、浏览器入口、Office 入口从“协议/骨架”升级成真实可安装、可注册、可提交的系统集成。

## 2. 前置依赖

- 上一个任务：UCA-015
- 必须已有的产物：真实 HTTP / SSE 服务、桌面壳运行时、稳定的 ContextPacket 协议
- 不能同时修改的区域：真实 AI provider SDK

## 3. 实施范围

- 负责模块：Explorer 注册、C# helper / Named Pipe、Native Messaging 注册、浏览器 popup 跳转、Office.js 真实选区采集
- 允许改动文件/目录：`src/helper/`, `uca-cli/`, `uca-native-host/`, `browser_ext/`, `office_addin/`, `docs/runtime/`
- 明确不做：真实 OCR / provider SDK、模板市场

## 4. 交付产物

- Explorer 右键注册脚本
- 真实 helper 与 `Ctrl+Shift+E`
- 真实 Native Host 注册与浏览器提交
- 真实 Office 选区采集与基础提交

## 5. 验证方式

- `npm run check`
- Chrome / Edge 各 1 条真实 happy path
- Explorer 单文件、多文件、快捷键各 1 条真实 happy path
- Word / Excel / PPT 各 1 条基础 happy path

## 6. Git 执行方式

- 分支名：`task/uca-016-native-integrations`
- Commit 格式：`UCA-016: implement native integrations`
- 合并条件：三类入口都可在真实宿主环境提交任务

## 7. 完成后必须更新本文件

- 写明实际安装步骤与注册表位置
- 写明浏览器和 Office 的已验证版本
- 记录系统权限与已知环境限制

## 8. 对下一个任务的交接

- 下一个任务：UCA-017、UCA-018、UCA-020
- 本任务新增了什么：真实宿主入口与安装链路
- 下一个任务直接可复用什么：系统桥、浏览器/Office 实际输入源、安装文档
- 还没解决的问题：真实模型调用、真实 UI 渲染、发布打包

## 9. 执行记录

- 状态：todo
- 执行分支：`task/uca-016-native-integrations`
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
