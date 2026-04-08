# Task UCA-003 — Phase 1a 桌面壳（Tray / Overlay / Console）

## 1. 任务目标

搭好 Electron 桌面壳，让托盘、全局快捷键、固定浮窗和主控制台可以启动并连上后端入口。

## 2. 前置依赖

- 上一个任务：UCA-002
- 必须已有的产物：共享协议、UI 状态机
- 不能同时修改的区域：service 内核实现

## 3. 实施范围

- 负责模块：Electron Main、overlay、console、globalShortcut、窗口管理
- 允许改动文件/目录：`src/tray/`, `src/console/`, `src/overlay/`, `src/shared/`
- 明确不做：业务路由、LLM 执行

## 4. 交付产物

- 托盘应用
- `Ctrl+Shift+Space` 唤起浮窗
- 主控制台空壳
- IPC 通道骨架

## 5. 验证方式

- `pnpm lint`
- `pnpm build`
- 手动验证托盘、快捷键、浮窗显示

## 6. Git 执行方式

- 分支名：`task/uca-003-phase1a-desktop-shell`
- Commit 格式：`UCA-003: build desktop shell`
- 合并条件：桌面壳可启动，窗口管理稳定

## 7. 完成后必须更新本文件

- 写明窗口列表与入口
- 写明 IPC 协议起点
- 记录已验证的快捷键

## 8. 对下一个任务的交接

- 下一个任务：UCA-004
- 本任务新增了什么：桌面运行容器和 UI 入口
- 下一个任务直接可复用什么：shared types、窗口路由、IPC 骨架
- 还没解决的问题：还没有真实任务和数据落盘

## 9. 执行记录

- 状态：in_progress
- 执行分支：`task/uca-003-phase1a-desktop-shell`
- 开始日期：2026-04-08
- 完成日期：
- 实际新增内容：
  - 新增 [desktop-shell.ts](/e:/linxi/src/shared/contracts/desktop-shell.ts) 作为桌面壳共享契约
  - 更新 [index.ts](/e:/linxi/src/shared/contracts/index.ts) 导出桌面壳契约
  - 新增 [manifest.mjs](/e:/linxi/src/desktop/shared/manifest.mjs) 统一定义窗口、快捷键和 IPC 通道
  - 新增 [bootstrap.mjs](/e:/linxi/src/desktop/tray/bootstrap.mjs) 桌面壳 bootstrap 状态与 manifest 校验
  - 新增 [view-model.mjs](/e:/linxi/src/desktop/overlay/view-model.mjs) 作为 overlay 壳层 view model
  - 新增 [view-model.mjs](/e:/linxi/src/desktop/console/view-model.mjs) 作为 console 壳层 view model
  - 新增 [verify-desktop-shell.mjs](/e:/linxi/scripts/verify-desktop-shell.mjs) 作为桌面壳 smoke verification
  - 更新 [package.json](/e:/linxi/package.json) 增加 `verify:desktop-shell`
  - 更新 [verify-structure.mjs](/e:/linxi/scripts/verify-structure.mjs) 纳入桌面壳骨架文件
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - `node scripts/verify-desktop-shell.mjs` 通过
  - 由于仓库尚未安装 Electron 依赖，本任务当前验证的是“桌面壳骨架与契约正确”，不是“真实 Electron 启动成功”
- 遗留问题：
  - 尚未接入真实 Electron Main / BrowserWindow / globalShortcut
  - 尚未接入 service bridge
  - overlay 与 console 仍是 shell-level view model，而不是实际 UI
- 交接给下一个任务：
  - `UCA-004` 可直接复用 `src/desktop/shared/manifest.mjs` 中的窗口、快捷键、IPC 命名
  - 后续真实 Electron 接线时，不要改动窗口 id、route 和 IPC channel 名称，优先保持当前契约稳定
  - 若开始安装 Electron 依赖，建议先补一个最小 main-process smoke test，再把本任务从 scaffold 升级到 runnable shell
