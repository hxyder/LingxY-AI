# Task UCA-004 — Phase 1a Service 核心（Task / Store / Fast Executor）

## 1. 任务目标

跑通最小闭环：剪贴板上下文进入 service，生成 task，流式输出结果并持久化。

## 2. 前置依赖

- 上一个任务：UCA-003
- 必须已有的产物：桌面壳、共享协议
- 不能同时修改的区域：文件入口、浏览器扩展

## 3. 实施范围

- 负责模块：`uca-service`、SQLite、TaskQueue、IntentRouter、FastExecutor、SSE
- 允许改动文件/目录：`src/service/`, `src/shared/`
- 明确不做：Kimi 真实桥接、文件入口

## 4. 交付产物

- service 子进程
- SQLite 三张表
- 规则版 Intent Router
- Fast Executor 流式输出
- 任务中心最小可用

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- 手动跑“读取剪贴板 → 总结 → 任务详情页”

## 6. Git 执行方式

- 分支名：`task/uca-004-phase1a-service-core`
- Commit 格式：`UCA-004: implement phase1a service core`
- 合并条件：最小闭环演示录屏完成

## 7. 完成后必须更新本文件

- 写明 SQLite schema 最终版本
- 写明 SSE 接口与事件流
- 记录最小闭环验证结果

## 8. 对下一个任务的交接

- 下一个任务：UCA-005 和 UCA-006
- 本任务新增了什么：可运行的 task/event/store 内核
- 下一个任务直接可复用什么：ContextPacket 入库、SSE 流式输出、任务详情页
- 还没解决的问题：文件、浏览器、Kimi 都未接入

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
