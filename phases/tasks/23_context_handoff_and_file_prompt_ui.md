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

- 状态：done
- 执行分支：`task/uca-023-context-handoff-ui`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：Explorer helper 向桌面浮窗交接文件列表；Electron 单实例 handoff；浮窗文件预览卡片与按文件提交逻辑；安装脚本已切到 overlay_prompt 模式；helper 多选批处理与 handoff 文件自动清理；取消动作会清空本次上下文。
- 验证结果：`node scripts/verify-context-handoff-ui.mjs`、`dotnet build src/helper/explorer_selection/UcaExplorerSelectionHelper/UcaExplorerSelectionHelper.csproj`、`node scripts/verify-native-integrations.mjs`、`npm run check`、`powershell -ExecutionPolicy Bypass -File .\\scripts\\start-trial.ps1 -WithShell`、helper `overlay_prompt` 实测返回成功且 handoff 目录被消费清空。
- 遗留问题：右键到浮窗再到“输入后提交”的最后一步还没有自动化 UI 测试脚本，当前依赖 shell smoke 与静态/协议验证。
- 交接给下一个任务：UCA-024 直接复用已可启动的桌面壳、overlay handoff、文件预览卡片和 task 提交流。
