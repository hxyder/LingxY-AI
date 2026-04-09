# Task UCA-014 — Phase 6 平台化基础（模板、DAG、预算）

## 1. 任务目标

在已有能力上建立模板化、可编排、可控成本的平台基础，而不是一次性做完整生态。

## 2. 前置依赖

- 上一个任务：UCA-010、UCA-012、UCA-013
- 必须已有的产物：Scheduler、Action Tools、Office/PDF 基础能力
- 不能同时修改的区域：前面 phase 的核心 ship 路径

## 3. 实施范围

- 负责模块：模板 schema、内置模板注册、DAG 调度器、预算管理、执行器注册、AI provider / code CLI / MCP / skills 注册、多设备同步占位、历史搜索占位
- 允许改动文件/目录：`src/service/templates/`, `src/service/dag/`, `src/service/cost/`, `src/service/embeddings/`, `src/service/ai/`, `src/desktop/console/`
- 明确不做：插件市场、多人协作、完整 macOS 移植、真实远端同步、持久化向量库、真实云端 provider SDK 对接

## 4. 交付产物

- 模板格式与至少 5 个内置模板
- DAG 运行时与可视化 view model
- 预算/配额与降级前预检
- 执行器/AI provider/code CLI/MCP/skills 多注册基础
- 控制台模板编辑、DAG、预算、历史搜索四个子面板骨架

## 5. 验证方式

- `npm run check`
- 3 节点 DAG demo
- 预算超限与降级路径验证

## 6. Git 执行方式

- 分支名：`task/uca-014-phase6-platform-foundation`
- Commit 格式：`UCA-014: add platform foundation`
- 合并条件：至少 5 个内置模板与 DAG happy path 可演示

## 7. 完成后必须更新本文件

- 写明模板 schema 版本
- 写明 DAG 限制
- 写明预算默认值与告警策略

## 8. 对下一个任务的交接

- 下一个任务：后续滚动 backlog
- 本任务新增了什么：平台化基线、内置模板集、预算预检、DAG 执行器、历史搜索占位、统一 AI 扩展注册表
- 下一个任务直接可复用什么：模板注册、预算管理、执行器选择、provider/code CLI/MCP/skills 注册、控制台子面板
- 还没解决的问题：模板持久化/导入导出、真实 provider SDK、向量库持久化、跨设备同步、插件市场、协作、远程 agent 仍需单独开题

## 9. 执行记录

- 状态：in_progress
- 执行分支：`task/uca-014-phase6-platform-foundation`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 模板 schema 版本：`1.0`
- DAG 限制：
  - 当前仅支持无环 DAG、静态边定义、节点级 `success/failed/blocked`
  - 失败传播为“失败节点之后的可达节点全部 blocked”
  - 尚未支持从失败节点断点恢复、条件分支、并行资源配额
- 预算默认值与告警策略：
  - 月预算 `$50`
  - 单任务预算 `$1`
  - `80%` 进入 warn
  - `100%` 进入 hard stop
  - 目前以预估 token 成本做前置判断，真实账单回写仍待后续任务补齐
- 实际新增内容：
  - `src/service/templates/`：模板 schema、parser、builtin registry、5 个内置模板
  - `src/service/dag/`：DAG 校验、调度器、可视化 view model
  - `src/service/cost/`：pricing、估算器、budget manager
  - `src/service/embeddings/`：本地 lexical embedding 占位与 search store
  - `src/service/ai/*/registry.mjs` 与 `builtin.mjs`：provider / code CLI / MCP / skills 注册基线
  - `src/desktop/console/`：template editor、DAG view、budget dashboard、history search 四个面板骨架
  - `src/service/core/service-bootstrap.mjs`：平台运行时与 Phase 6 相关 endpoint manifest
- 验证结果：
  - `npm run check`
  - `node scripts/verify-platform-foundation.mjs`
- 遗留问题：
  - 真实 provider/CLI/MCP 适配器仍是占位实现
  - 模板导入导出、模板市场、向量持久化尚未开始
  - 历史搜索当前是 lexical 相似度，不是最终 embedding/vector store 方案
- 交接给下一个任务：
  - 优先补模板持久化、模板编辑器即时校验、DAG 失败节点重试、预算超限 UI 和 provider 实际配置检测
