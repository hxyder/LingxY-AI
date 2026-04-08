# Task UCA-002 — Phase 0 协议、状态机与风险登记

## 1. 任务目标

把 ContextPacket、Task、TaskEvent、Artifact、FSM 和风险登记册定成正式协议，形成 Phase 1a 的开发输入。

## 2. 前置依赖

- 上一个任务：UCA-001
- 必须已有的产物：总体架构、进程模型
- 不能同时修改的区域：Phase 1a 的实现任务

## 3. 实施范围

- 负责模块：JSON Schema、任务状态机、风险表、Kimi bridge 协议
- 允许改动文件/目录：`docs/protocols/`, `phases/phase_0_definition.md`, `phases/architecture_cross_cutting.md`
- 明确不做：Electron/UI 代码

## 4. 交付产物

- 协议 schema
- FSM 图
- 风险登记册
- Kimi CLI 任务包定义

## 5. 验证方式

- schema 校验通过
- 纸面流程 walkthrough
- 风险登记条目不少于 15 条

## 6. Git 执行方式

- 分支名：`task/uca-002-phase0-protocols-risks`
- Commit 格式：`UCA-002: freeze protocols and risks`
- 合并条件：Phase 1a 工程师确认可直接开工

## 7. 完成后必须更新本文件

- 标明 schema 版本
- 写明已确认的恢复语义
- 写明未决 ADR 列表

## 8. 对下一个任务的交接

- 下一个任务：UCA-003
- 本任务新增了什么：正式协议与状态机
- 下一个任务直接可复用什么：共享类型和接口命名
- 还没解决的问题：桌面壳与 service 还未搭起来

## 9. 执行记录

- 状态：in_progress
- 执行分支：`task/uca-002-phase0-protocols-risks`
- 开始日期：2026-04-08
- 完成日期：
- 实际新增内容：
  - 新增 [context_packet.schema.json](/e:/linxi/docs/protocols/context_packet.schema.json)
  - 新增 [task.schema.json](/e:/linxi/docs/protocols/task.schema.json)
  - 新增 [task_event.schema.json](/e:/linxi/docs/protocols/task_event.schema.json)
  - 新增 [artifact.schema.json](/e:/linxi/docs/protocols/artifact.schema.json)
  - 新增 [kimi_bridge_protocol.md](/e:/linxi/docs/protocols/kimi_bridge_protocol.md)
  - 新增 [state_machines.md](/e:/linxi/docs/architecture/state_machines.md)
  - 新增 [risk_register_v1.md](/e:/linxi/docs/risks/risk_register_v1.md)
  - 新增 [phase_1a_demo_script.md](/e:/linxi/docs/phase_1a_demo_script.md)
  - 更新 [phase_0_definition.md](/e:/linxi/phases/phase_0_definition.md) 交付清单，使其与现有 docs 对齐
  - 更新 [scripts/verify-structure.mjs](/e:/linxi/scripts/verify-structure.mjs) 以覆盖协议、风险和 demo 文档
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - 4 个 schema 文件 JSON parse 通过
  - 风险登记册条目数 = 18，满足 `>=15`
  - 外部工程评审尚未执行，因此暂不标记 `done`
- 遗留问题：
  - 尚未引入自动 schema lint 或 schema-to-types 生成
  - 风险登记册还没有 owner / due date 细化字段，后续可在执行期继续增强
  - `UCA-003` 开始实现前，仍建议做一次工程 walkthrough 以确认协议命名无歧义
- 交接给下一个任务：
  - `UCA-003` 直接以 `docs/protocols/*.json` 作为共享契约起点
  - `Task FSM`、`Overlay FSM`、`Confirmation FSM` 以 [state_machines.md](/e:/linxi/docs/architecture/state_machines.md) 为准
  - code CLI 接入先遵循 [kimi_bridge_protocol.md](/e:/linxi/docs/protocols/kimi_bridge_protocol.md)，后续真实 CLI 差异通过适配层处理
  - 仍未解决的问题集中在“实现细节”而不是“命名与边界”，可以开始 UCA-003
