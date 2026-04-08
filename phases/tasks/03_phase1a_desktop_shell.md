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

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
