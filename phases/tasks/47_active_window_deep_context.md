# Task UCA-047 — 活动窗口深度上下文：浏览器 URL、Office 文件路径、VSCode 打开的文件

## 1. 任务目标

让用户按快捷键唤起 UCA 时，系统不止抓"剪贴板里有啥"，而是能进一步理解"当前前台窗口是哪个应用、它正在做什么"：
- 浏览器（Edge / Chrome / Firefox）前台 → 抓当前 tab 的 URL + 标题
- Office（Word / Excel / PowerPoint）前台 → 抓当前打开的文档完整路径
- VS Code / JetBrains 前台 → 抓当前打开的文件路径
- Explorer 前台 → 抓当前选中的文件（已支持，保留）
- PDF reader / 其他应用 → 尽力抓窗口标题里能识别的路径

然后 UCA 在 overlay 里直接显示"你当前在看 XX.pdf"，用户说"总结一下"时自动把这个文件当成上下文。

## 2. 前置依赖

- 上一个任务：UCA-029（统一 capture entrypoints 基础）、UCA-023（context handoff UI）、UCA-040（PS 脚本 UTF-8 修复）、UCA-049（provider 无关 agentic runtime）
- 必须已有的产物：`scripts/capture-context.ps1`、Win32 API p/invoke 模板、notification 链路
- 不能同时修改的区域：安全 broker 基线、content_script 注入

## 3. 实施范围

- 负责模块：Windows UI Automation 探测器、浏览器 URL 抓取、Office COM 探测、VSCode 命令行参数探测、Overlay 上下文预览
- 允许改动文件/目录：`scripts/capture-context.ps1`（扩展）、`scripts/active-window-probe.ps1`（新建，走 UI Automation）、`src/desktop/tray/electron-main.mjs`、`src/desktop/renderer/overlay.js`、`phases/tasks/`
- 明确不做：跨平台支持（macOS / Linux 单独任务）、截取窗口内文字（OCR 截图）、iOS / Android 屏幕投射

## 4. 交付产物

- **`scripts/active-window-probe.ps1`**：
  - 用 `System.Windows.Automation` / `UIAutomationClient`
  - 按前台窗口的 `process.Name` 分派：
    - `msedge` / `chrome` / `firefox` → 爬 Accessibility tree 找地址栏（`LocalizedControlType: Edit` + `Name ~= "Address and search bar"`），回 URL + title
    - `winword` / `excel` / `powerpnt` → 通过 COM `Application.ActiveDocument.FullName`（或 ExcelApp.ActiveWorkbook.FullName）
    - `code` → 解析窗口标题 `<filename> - <foldername> - Visual Studio Code`，结合 `Get-Process code` 的启动参数推断
    - `notepad++` / `sublime_text` → 窗口标题解析
    - 其他 → 返回 `process.Name` + `window.Title` + `pid`
  - 输出 JSON：`{ process, title, detected_kind: "web_url"|"file_path"|"unknown", payload: { url? / filePath? / extra } }`
  - 继承 UCA-040 的 UTF-8 no-BOM stdout
- **Electron main 扩展**：`captureActiveWindowContext()` 并联调用 `capture-context.ps1` + `active-window-probe.ps1`，合并结果
- **Overlay 预览**：收到 `payload.activeWindow` 时气泡头部显示一个小卡片：
  - 🌐 `当前浏览器：<title> · <url>`（+ "分析此页面" 按钮）
  - 📄 `当前文档：<filename>`（+ "总结" 按钮）
  - 📝 `当前文件：<path>`（+ "代码审查" 按钮）
- **Intent hint**：当 overlay 检测到 active window 是浏览器 URL，自动把 `capture.url` 填好；用户说"总结"时 fast executor 可以同时看到 URL 作为上下文
- **Overlay settings**（在 UCA-048 的设置面板加开关）：
  - 启用 active window probe
  - 白名单 / 黑名单（避免抓到敏感窗口）

## 5. 验证方式

- `node scripts/verify-active-window-probe.mjs`（新建）：mock PowerShell stdout → 端到端合并到 `captureActiveWindowContext` 输出
- 手动：前台开 Edge → Ctrl+Shift+Space → overlay 显示当前 URL；前台开 Word 打开一个 .docx → 显示 "当前文档"；前台开 VSCode → 显示文件名

## 6. Git 执行方式

- 分支名：`task/uca-047-active-window-context`
- Commit 格式：`UCA-047: active window deep context probe`
- 合并条件：三大类应用（浏览器 / Office / VSCode）至少两类能稳定抓到上下文；安全白名单可配

## 7. 完成后必须更新本文件

- 列出已支持的 process → 抓取方式映射
- 列出 UI Automation 的失败行为与用户提示
- 列出白名单 / 黑名单默认值

## 8. 对下一个任务的交接

- 下一个任务：跨平台的 active window probe（mac/Linux）
- 本任务新增了什么：Windows 下的主动上下文理解能力
- 下一个任务直接可复用什么：`active-window-probe.ps1` 的 JSON 输出 schema、overlay 预览组件
- 还没解决的问题：私密浏览器（隐身模式）URL 抓取、TLS 锁定应用、需要 UAC 提升的进程

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：把 active window 探测作为 capture pipeline 的一个正式 source，输出统一 JSON schema 后并入 existing handoff payload；浏览器、Office、VS Code、Explorer 都通过同一 `activeWindow` 字段交给 Overlay 和 agentic planner。
- 当前代码对齐点：`scripts/capture-context.ps1` 目前主要覆盖 clipboard / Explorer 选中项，UCA-040 已统一 UTF-8 no-BOM stdout；`src/desktop/tray/electron-main.mjs` 有热键和 overlay handoff 入口。新增探测器要继承这些编码与安全约束，并由 UCA-048 feature flag 和白/黑名单控制。
- 可能需要生成的文件：`scripts/active-window-probe.ps1`、`scripts/verify-active-window-probe.mjs`，并扩展 `src/desktop/tray/electron-main.mjs`、`src/desktop/renderer/overlay.js` 的 active window preview。

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题（开工前已识别）：
  - 用户需求（2026-04-11）："检测当前活动的主窗口，可以直接基于主窗口，理解文件路径。如果是网页，可以识别链接，并进行一系列操作，当用户唤醒以后。"
  - UI Automation 在部分有 DPI 缩放 / Chromium Widevine 的浏览器里可能抓不到地址栏
  - COM 调用需要应用允许 automation，某些企业策略可能禁用
  - 白名单默认需要保守（排除银行 / 密码管理器等）
- 交接给下一个任务：
