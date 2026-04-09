# Task UCA-025 — Windows 下 Electron Bootstrap 阻塞解法

## 1. 任务目标

解决当前 Windows 环境里 Electron 壳无法稳定拉起的问题，使桌面壳至少能完成一次真实 overlay 启动与 handoff 验收。

## 2. 前置依赖

- 上一个任务：UCA-021、UCA-022、UCA-023
- 必须已有的产物：renderer 页面、overlay composer、Explorer handoff 代码
- 不能同时修改的区域：Office Add-in

## 3. 实施范围

- 负责模块：Electron bootstrap、Windows 启动策略、shell smoke
- 允许改动文件/目录：`package.json`, `index.cjs`, `src/desktop/tray/`, `scripts/`, `docs/release/`
- 明确不做：切换整套桌面框架

## 4. 交付产物

- 可稳定启动的 Electron desktop shell
- 明确的 Windows 启动策略
- 一次真实 overlay 启动 smoke 记录

## 5. 验证方式

- `start-trial.ps1 -WithShell` 可成功启动
- helper 可成功唤起 overlay
- 至少一次真实窗口级 smoke

## 6. Git 执行方式

- 分支名：`task/uca-025-electron-windows-bootstrap`
- Commit 格式：`UCA-025: fix electron windows bootstrap`
- 合并条件：当前机器上 Electron 壳可真实启动

## 7. 完成后必须更新本文件

- 写明最终采用的启动策略
- 写明是否仍受 Electron Windows bug 影响
- 记录真实 smoke 的结果

## 8. 对下一个任务的交接

- 下一个任务：回到 UCA-023、再继续 UCA-024
- 本任务新增了什么：可启动的桌面壳入口
- 下一个任务直接可复用什么：overlay handoff 与 renderer UI
- 还没解决的问题：完整控制台工作台与发布打磨

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-025-electron-windows-bootstrap`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：恢复 Electron CJS bootstrap 入口；修正 `start-trial.ps1` 在 Windows PowerShell 5 下的进程参数拼接；显式清理 `ELECTRON_RUN_AS_NODE`；修复 helper overlay_prompt 的 mutex/同步 IO 问题，使 shell 可被 helper 真实唤起。
- 验证结果：`powershell -ExecutionPolicy Bypass -File .\\scripts\\start-trial.ps1 -WithShell` 可启动 Electron 进程；helper `overlay_prompt` 调用成功返回；`node scripts/verify-native-integrations.mjs`、`npm run check` 通过。
- 遗留问题：仍缺少窗口级自动化 UI smoke；当前机器上可能残留历史 Electron 进程，调试时建议先跑 `stop-trial.ps1`。
- 交接给下一个任务：回到 UCA-024，继续把控制台渲染工作台做成真实桌面页。
