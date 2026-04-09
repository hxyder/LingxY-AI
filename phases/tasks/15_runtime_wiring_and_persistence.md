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

- 状态：done
- 执行分支：`task/uca-015-runtime-wiring`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 SQLite 持久化 store、runtime path/config store、HTTP/SSE server、persistent runtime launcher
  - 新增 Electron main entry 与 desktop runtime host
  - 扩展 service bootstrap 支持注入持久化 store、artifact store、config store、security config
  - 新增 `docs/runtime/local_runtime.md` 与 `scripts/start-runtime.mjs`
- 实际启用的端口与进程模型：
  - 本地 HTTP runtime 默认监听 `127.0.0.1:4310`
  - 验证脚本使用随机端口 `0` 启动后回填真实监听端口
  - 进程模型当前为 “Node service runtime + Electron main entry”，桌面窗口仍使用 data URL 壳承接后续 UI
- SQLite 表与 DAO 的最终落地范围：
  - `tasks`
  - `task_events`
  - `artifacts`
  - `schedules`
  - `schedule_runs`
  - `pending_approvals`
  - `audit_logs`
- 配置持久化位置与迁移策略：
  - 默认配置文件为 `%APPDATA%/UCA/config/runtime.json`
  - 当前持久化字段以 `security` 配置为主
  - 当前采用“向后兼容 JSON 合并”策略，尚未引入版本化 migration
- 验证结果：
  - `node scripts/verify-runtime-wiring.mjs`
  - `npm run check`
- 遗留问题：
  - 真实 Electron UI 仍是 data URL 壳，不是最终渲染层
  - 真实原生入口、真实 provider SDK、真实 Office/browser 安装链仍在后续任务
  - `/templates/validate` 与 `/dag/preview` 目前只提供网络落点，尚未接完整业务逻辑
- 交接给下一个任务：
  - `UCA-016` 可直接复用本地 HTTP base URL、持久化 SQLite、runtime config 和 Electron entry
  - `UCA-017` 可直接复用持久化 runtime、budget/config store 和 provider registry 网络入口
  - `UCA-018` 可直接复用 `/task`、`/task/:id/events`、`/tasks`、`/security/state` 等真实 API
