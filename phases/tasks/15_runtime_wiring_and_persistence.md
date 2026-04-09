# Task UCA-015 — 真实运行时接线与持久化落地

## 1. 任务目标

把当前 scaffold 升级成真正可启动、可持久化、可联网访问的本地运行时。

## 2. 前置依赖

- 上一个任务：UCA-014
- 必须已有的产物：桌面壳契约、service bootstrap、任务协议、Phase 6 registry 基线
- 不能同时修改的区域：Explorer / Browser / Office 的真实系统桥

## 3. 实施范围

- 负责模块：真实 Electron Main、BrowserWindow、globalShortcut、HTTP API、SSE、SQLite DAO、配置持久化
- 允许改动文件/目录：`src/desktop/`, `src/service/core/`, `src/service/events/`, `src/service/core/store/`, `src/service/security/`
- 明确不做：真实 provider SDK、真实 Native Host / Office.js / OCR runtime

## 4. 交付产物

- 可启动桌面壳
- 可访问的本地 HTTP / SSE 服务
- SQLite 持久化 DAO
- 本地配置持久化

## 5. 验证方式

- `npm run check`
- 最小手动验证：打开托盘、唤起 console、创建 task、查看 SSE 时间线
- 重启后 task / audit / schedules 仍可恢复

## 6. Git 执行方式

- 分支名：`task/uca-015-runtime-wiring`
- Commit 格式：`UCA-015: wire real runtime and persistence`
- 合并条件：Electron + HTTP + SQLite 三条链路均可本地跑通

## 7. 完成后必须更新本文件

- 写明实际启用的端口与进程模型
- 写明 SQLite 表与 DAO 的最终落地范围
- 记录配置持久化位置与迁移策略

## 8. 对下一个任务的交接

- 下一个任务：UCA-016、UCA-017、UCA-018
- 本任务新增了什么：真实运行时、网络层、持久化基础
- 下一个任务直接可复用什么：HTTP/SSE、SQLite、桌面窗口生命周期、配置读写
- 还没解决的问题：Native 集成、真实 AI runtime、真实 UI 渲染

## 9. 执行记录

- 状态：todo
- 执行分支：`task/uca-015-runtime-wiring`
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
