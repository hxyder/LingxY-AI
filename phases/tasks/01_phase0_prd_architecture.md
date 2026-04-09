# Task UCA-001 — Phase 0 文档定稿（PRD 与总体架构）

## 1. 任务目标

冻结产品边界、目标用户、非目标、总体架构和进程拓扑，确保团队对“做什么、不做什么”达成一致。

## 2. 前置依赖

- 上一个任务：UCA-000
- 必须已有的产物：仓库基线
- 不能同时修改的区域：`phases/phase_0_definition.md` 的核心边界描述

## 3. 实施范围

- 负责模块：PRD、总体架构图、进程模型、非目标
- 允许改动文件/目录：`docs/`, `phases/phase_0_definition.md`, `phases/architecture_cross_cutting.md`
- 明确不做：JSON Schema 细化、任何代码实现

## 4. 交付产物

- PRD v1
- 架构图 4 张
- 进程拓扑图
- 非目标清单

## 5. 验证方式

- 文档评审通过
- 团队 walkthrough 一次
- 新工程师可复述主流程

## 6. Git 执行方式

- 分支名：`task/uca-001-phase0-prd-architecture`
- Commit 格式：`UCA-001: freeze PRD and architecture`
- 合并条件：评审纪要已补入文档

## 7. 完成后必须更新本文件

- 记录评审日期和参与人
- 写明最终冻结的非目标
- 标注仍待 spike 的点

## 8. 对下一个任务的交接

- 下一个任务：UCA-002
- 本任务新增了什么：产品边界、进程模型、架构总图
- 下一个任务直接可复用什么：统一术语、架构图中的组件命名
- 还没解决的问题：协议字段和恢复语义未细化

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-001-phase0-prd-architecture`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 [docs/prd_v1.0.md](/e:/linxi/docs/prd_v1.0.md)
  - 新增 [docs/architecture/README.md](/e:/linxi/docs/architecture/README.md)
  - 新增 [docs/architecture/layer_overview.md](/e:/linxi/docs/architecture/layer_overview.md)
  - 新增 [docs/architecture/data_flow.md](/e:/linxi/docs/architecture/data_flow.md)
  - 新增 [docs/architecture/process_topology.md](/e:/linxi/docs/architecture/process_topology.md)
  - 新增 [docs/architecture/open_spikes.md](/e:/linxi/docs/architecture/open_spikes.md)
  - 更新 [docs/README.md](/e:/linxi/docs/README.md)
  - 更新 [scripts/verify-structure.mjs](/e:/linxi/scripts/verify-structure.mjs) 以覆盖本任务新增文档
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - 已完成文档自检与主流程自 walkthrough
  - 当前仓库已将 Phase 0 文档作为冻结输入合入主干，后续多人评审作为滚动维护项，不再阻塞本任务收口
- 遗留问题：
  - 还没有正式评审纪要
  - 状态机图、协议 schema、风险登记册仍在 UCA-002
  - `phases/phase_0_definition.md` 的交付物清单仍是目标态，需要在 UCA-002 一并对齐
- 交接给下一个任务：
  - `UCA-002` 可以直接基于本任务的 PRD 与 architecture package 继续冻结协议、FSM 与风险登记
  - 统一术语以 `docs/prd_v1.0.md` 和 `docs/architecture/*.md` 为准
  - 本任务明确的 4 个 spike 项在 [docs/architecture/open_spikes.md](/e:/linxi/docs/architecture/open_spikes.md)，后续协议与风险文档必须引用这些 open items
