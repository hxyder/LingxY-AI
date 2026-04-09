# Task UCA-023 — 文件右键交接与输入弹窗 UI

## 1. 任务目标

把 Explorer / 本地文件入口接到真正的桌面输入弹窗：右键文件后弹出 UCA 输入窗口，展示文件列表、允许用户填写要求，然后执行任务。

## 2. 前置依赖

- 上一个任务：UCA-021、UCA-022、UCA-016
- 必须已有的产物：真实 renderer 壳、原生入口注册、runtime HTTP API
- 不能同时修改的区域：Office Add-in

## 3. 实施范围

- 负责模块：Explorer 入口参数交接、桌面输入弹窗、上下文预览、执行后反馈
- 允许改动文件/目录：`scripts/`, `src/helper/explorer_selection/`, `src/desktop/`, `docs/runtime/`
- 明确不做：复杂权限管理或多用户协作

## 4. 交付产物

- 右键文件后弹出的输入 UI
- 文件列表预览
- 提交 / 取消 / 最近结果反馈

## 5. 验证方式

- 右键单文件 happy path
- 多文件选择 happy path
- 输入取消不提交验证

## 6. Git 执行方式

- 分支名：`task/uca-023-context-handoff-ui`
- Commit 格式：`UCA-023: wire explorer prompt ui`
- 合并条件：用户可不碰命令行完成“右键 -> 输入 -> 执行”

## 7. 完成后必须更新本文件

- 写明 Explorer 到 UI 的交接机制
- 写明文件列表预览策略
- 记录用户取消和异常情况

## 8. 对下一个任务的交接

- 下一个任务：UCA-024
- 本任务新增了什么：面向非技术用户的文件入口交互
- 下一个任务直接可复用什么：上下文弹窗、文件预览、任务提交流
- 还没解决的问题：完整运营控制台与发布打磨

## 9. 执行记录

- 状态：blocked
- 执行分支：`task/uca-023-context-handoff-ui`
- 开始日期：2026-04-08
- 完成日期：
- 实际新增内容：Explorer helper 向桌面浮窗交接文件列表；Electron 单实例 handoff；浮窗文件预览卡片与按文件提交逻辑；安装脚本已切到 overlay_prompt 模式。
- 验证结果：`node scripts/verify-context-handoff-ui.mjs`、`dotnet build src/helper/explorer_selection/UcaExplorerSelectionHelper/UcaExplorerSelectionHelper.csproj`、`node scripts/verify-native-integrations.mjs`、`npm run check` 通过。
- 遗留问题：当前 Windows 环境下实际拉起 Electron 壳时，`require('electron')` 会解析到 npm stub 路径字符串而不是 Electron API，导致 `start-trial.ps1 -WithShell` 与 helper 唤起流程还不能完成真实 UI smoke。
- 交接给下一个任务：先完成 UCA-025，解决 Windows 下 Electron bootstrap 阻塞，再回到本任务做“右键 -> 输入 -> 执行”的真实端到端验收。
