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

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
