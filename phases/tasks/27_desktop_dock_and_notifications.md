# Task UCA-027 — 桌面 Dock 拖拽入口与完成通知

## 1. 任务目标

把当前“右键文件 -> 浮窗输入”扩展为更直观的桌面一级入口：常驻桌面 Dock 浮标支持点击打开输入浮窗、拖拽文件触发上下文交接，并在任务完成后给出桌面通知。

## 2. 前置依赖

- 上一个任务：UCA-023、UCA-024、UCA-026
- 必须已有的产物：Electron 桌面壳、Overlay 输入器、文件提交流程、Kimi Code CLI 可用
- 不能同时修改的区域：协议 schema 与已冻结 release baseline

## 3. 实施范围

- 负责模块：桌面 Dock 窗口、拖拽文件交接、Overlay 完成通知、气泡式会话层、基础结构校验
- 允许改动文件/目录：`src/desktop/`, `scripts/`, `phases/tasks/`
- 明确不做：网页内浮层统一设计、图片/文字/网页全场景入口统一交互

## 4. 交付产物

- 常驻桌面 Dock 浮标窗口
- Dock -> Overlay 的拖拽文件交接链路
- Overlay 任务完成后的桌面通知
- 气泡式会话 Overlay 与选择按钮
- 结果摘要预览、复制与继续追问
- 对应结构校验与渲染校验

## 5. 验证方式

- `node scripts/verify-structure.mjs`
- `node scripts/verify-desktop-renderer.mjs`
- `node scripts/verify-overlay-composer.mjs`
- `powershell -ExecutionPolicy Bypass -File .\\scripts\\start-trial.ps1`
- 桌面进程中可见 `UCA Dock` 窗口

## 6. Git 执行方式

- 分支名：`task/uca-027-desktop-dock`
- Commit 格式：`UCA-027: add desktop dock launcher`
- 合并条件：Dock 窗口、拖拽交接 IPC、完成通知与验证脚本均已落地

## 7. 完成后必须更新本文件

- 写明 Dock 的交互范围与当前限制
- 写明验证命令和运行态结果
- 写明下一步 UI 交接方向

## 8. 对下一个任务的交接

- 下一个任务：统一网页/图片/文字的一级轻交互入口
- 本任务新增了什么：桌面常驻图标式入口、拖拽文件交接、完成通知
- 下一个任务直接可复用什么：Dock -> Overlay handoff、桌面通知 IPC、现有 Overlay 输入器
- 还没解决的问题：非文件上下文如何以同样轻量的方式呈现

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-09
- 完成日期：2026-04-11
- 实际新增内容：新增 `src/desktop/renderer/dock.html` 与 `src/desktop/renderer/dock.js` 作为常驻桌面 Dock，并调整为圆形呼吸态浮标；扩展 `src/desktop/shared/manifest.mjs` 增加 `dock` 窗口和 `shellSubmitDroppedFiles` / `shellNotify` IPC；扩展 `src/desktop/tray/electron-main.mjs` 以支持 Dock 窗口定位、拖拽文件交接到 Overlay、桌面通知；扩展 `src/desktop/renderer/preload.cjs` 以支持拖拽文件路径解析、本地文本读取与剪贴板写入；扩展 `src/desktop/renderer/overlay.js` 与 `src/desktop/renderer/overlay.html`，加入气泡式会话层、动作选择按钮、结果摘要预览、复制结果摘要和基于结果继续追问；修复 Overlay 里旧文件路径残留导致的上下文误导；扩展 `src/service/extractors/file-ingest.mjs` 及配套脚本，使文本类、结构化文本类与常见 OOXML 办公文件（`docx`、`xlsx`）能够被更稳定地识别和提取。
- 验证结果：`node scripts/verify-structure.mjs`、`node scripts/verify-desktop-renderer.mjs`、`node scripts/verify-overlay-composer.mjs`、`node scripts/verify-file-kimi.mjs`、`npm run check` 通过；`powershell -ExecutionPolicy Bypass -File .\\scripts\\stop-trial.ps1` 与 `powershell -ExecutionPolicy Bypass -File .\\scripts\\start-trial.ps1` 成功；运行态进程中可见标题为 `UCA Dock` 的 Electron 窗口；`http://127.0.0.1:4310/health` 返回 `ok: true`。
- 遗留问题：尚未把图片、网页、纯文本选区统一接到和 Dock 一样的一级轻交互模型中；Dock 拖拽链路虽然已通过真实试用确认可用，但还缺统一的跨媒介会话入口；`pptx` 目前已接入解析通道但还没有单独的端到端验证夹具。
- 交接给下一个任务：可以直接在当前桌面壳上继续做“拖网页/拖图片/选中文字后唤起输入器”的统一交互设计，并复用现有气泡会话层、结果摘要预览与继续追问能力；文件入口侧已经具备 `txt/md/csv/json/yaml/html/xml/docx/xlsx/pdf/png/jpg/jpeg/webp/bmp/gif` 这一档常见类型支持基础。
