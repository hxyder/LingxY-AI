# Task UCA-014 — Phase 6 平台化基础（模板、DAG、预算）

## 1. 任务目标

在已有能力上建立模板化、可编排、可控成本的平台基础，而不是一次性做完整生态。

## 2. 前置依赖

- 上一个任务：UCA-010、UCA-012、UCA-013
- 必须已有的产物：Scheduler、Action Tools、Office/PDF 基础能力
- 不能同时修改的区域：前面 phase 的核心 ship 路径

## 3. 实施范围

- 负责模块：模板 schema、DAG 调度器、预算管理、执行器注册、多设备同步占位
- 允许改动文件/目录：`src/service/templates/`, `src/service/dag/`, `src/service/cost/`, `src/console/template_editor/`
- 明确不做：插件市场、多人协作、完整 macOS 移植

## 4. 交付产物

- 模板格式
- DAG 运行时
- 预算/配额
- 执行器多路由基础

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
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
- 本任务新增了什么：平台化基线
- 下一个任务直接可复用什么：模板、预算、执行器注册
- 还没解决的问题：插件市场、协作、远程 agent 仍需单独开题

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
