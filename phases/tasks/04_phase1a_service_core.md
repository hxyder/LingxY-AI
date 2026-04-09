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

- 状态：done
- 执行分支：`task/uca-004-phase1a-service-core`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 [uca-models.ts](/e:/linxi/src/shared/contracts/uca-models.ts) 作为 service 共享数据模型
  - 新增 [sqlite-schema.mjs](/e:/linxi/src/service/core/store/sqlite-schema.mjs) 冻结 tasks / task_events / artifacts 三张表的 Phase 1a 结构
  - 新增 [memory-store.mjs](/e:/linxi/src/service/core/store/memory-store.mjs) 作为结构验证用 store scaffold
  - 新增 [event-bus.mjs](/e:/linxi/src/service/core/events/event-bus.mjs)
  - 新增 [task-queue.mjs](/e:/linxi/src/service/core/queue/task-queue.mjs)
  - 新增 [intent-router.mjs](/e:/linxi/src/service/core/router/intent-router.mjs) 作为规则版路由骨架
  - 新增 [fast-executor.mjs](/e:/linxi/src/service/executors/fast/fast-executor.mjs) 作为流式执行器骨架
  - 新增 [service-bootstrap.mjs](/e:/linxi/src/service/core/service-bootstrap.mjs) 统一声明 service 入口、端点和运行时组件
  - 新增 [verify-service-core.mjs](/e:/linxi/scripts/verify-service-core.mjs)
  - 更新 [package.json](/e:/linxi/package.json) 增加 `verify:service-core`
  - 更新 [verify-structure.mjs](/e:/linxi/scripts/verify-structure.mjs) 纳入 service 核心文件
  - 更新 [index.ts](/e:/linxi/src/shared/contracts/index.ts) 导出 `uca-models`
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - `node scripts/verify-desktop-shell.mjs` 通过
  - `node scripts/verify-service-core.mjs` 通过
  - 当前验证的是 service 核心 scaffold 的契约与状态流，不是“真实 SQLite + HTTP + SSE + LLM 已跑通”
- 遗留问题：
  - 还未接入真实 SQLite 驱动
  - 还未实现 HTTP `/context`、`/task`、`/task/:id/events`
  - Fast executor 仍是 placeholder，没有接真实模型 SDK
  - overlay 与 service 的桥还没接起来，因此最小闭环还差最后一段
- 交接给下一个任务：
  - `UCA-005` 和 `UCA-006` 可直接复用 store schema、queue pool、event type 和路由命名
  - 如果后续接真实 HTTP/SSE，请保持 `service-bootstrap.mjs` 中的端点命名不变
  - 若开始引入 SQLite 与真实 executor，优先替换 adapter，不要先改 task/event/store 的结构
