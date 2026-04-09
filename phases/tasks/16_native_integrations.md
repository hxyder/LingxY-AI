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

- 状态：done
- 执行分支：`task/uca-016-native-integrations`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 Explorer named-pipe server 与 .NET helper
  - 新增 .NET Native Messaging host 与用户级安装脚本
  - `uca-cli` 现在可直接提交到本地 runtime HTTP API
  - 浏览器 popup 现在可请求 Native Host 打开本地 runtime `/tasks`
  - Office bridge 现在支持真实 Office.js 选区采集与 HTTP / protocol fallback 两种提交方式
- 实际安装步骤与注册表位置：
  - Explorer：运行 `scripts/install-explorer-entry.ps1`
  - Explorer 菜单注册表：`HKCU\Software\Classes\*\shell\UCA.Analyze`
  - Explorer 目录菜单注册表：`HKCU\Software\Classes\Directory\shell\UCA.Analyze`
  - Browser Native Host：运行 `scripts/install-native-host.ps1 <ChromeExtensionId> <EdgeExtensionId>`
  - Chrome Native Host 注册表：`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.uca.host`
  - Edge Native Host 注册表：`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host`
- 浏览器和 Office 的已验证版本：
  - Windows：`10.0.26200.0`
  - Node.js：`v22.11.0`
  - .NET SDK：`9.0.312`
  - Microsoft Edge：`146.0.3856.109`
  - Google Chrome：`146.0.7680.178`
  - Office Click-to-Run：`16.0.19822.20142`
- 系统权限与已知环境限制：
  - 当前安装脚本全部使用 `HKCU` 用户级注册，不要求管理员权限
  - Native Host 必须把 `allowed_origins` 替换成真实扩展 ID 才能在浏览器里启用
  - Explorer 右键链路当前依赖本机 `node.exe`
  - Office 基础链已支持真实选区采集代码，但默认 ship 路径仍优先 protocol fallback
- 验证结果：
  - `node scripts/verify-native-integrations.mjs`
  - `npm run check`
- 遗留问题：
  - Native Host manifest 的 `allowed_origins` 仍需替换为真实 unpacked extension ID
  - Explorer 现代 Win11 一级菜单与完整 Shell Extension 仍未做
  - Office 默认仍以 protocol fallback 为主，真实本地 HTTP 直连受宿主策略限制
- 交接给下一个任务：
  - `UCA-017` 可直接复用浏览器 / Office / Explorer 的真实输入链到 provider runtime
  - `UCA-018` 可直接复用浏览器 popup 打开入口、runtime `/tasks` 跳转和 Office 提交结果链路
