# Task 85 — Runtime Search / Popup / Auto Task Stability

## 1. 任务目标

修复联网问答变慢、Dock 运行态误判、Popup 卡片消失/重复弹窗、以及定时/邮件自动任务错归类到普通会话的问题。

## 2. 前置依赖

- 上一个任务：UCA-084 Overlay / Console / Notes / Preview Upgrade
- 必须已有的产物：UCA-041 项目/会话持久化，UCA-049 provider-agnostic agentic runtime，UCA-084 自动任务归档初版
- 不能同时修改的区域：连接器 OAuth/账户路由主流程；本任务只修运行时、通知和归档契约

## 3. 实施范围

- 负责模块：
  - `src/service/core/task-spec.mjs`
  - `src/service/core/http-server.mjs`
  - `src/service/core/config-store.mjs`
  - `src/service/executors/fast/fast-executor.mjs`
  - `src/desktop/renderer/dock.js`
  - `src/desktop/renderer/overlay.js`
  - `src/desktop/renderer/popup-card.js`
  - `src/desktop/tray/electron-main.mjs`
- 允许改动文件/目录：
  - 上述代码文件
  - `scripts/verify-*.mjs`
  - `phases/tasks/TASK_INDEX.md`
- 明确不做：
  - 不重做整个 agent 框架
  - 不迁移模糊来源的历史会话
  - 不删除 UCA-084 已有 UI 改动

## 4. 交付产物

- 代码：
  - DeepSeek / provider reasoning 配置读写迁移与执行前清洗
  - `GET /tasks/summary` 轻量接口
  - Dock 去掉 2 分钟运行态截断
  - Popup hover/scroll/focus 保活与同任务稳定 dedupe
  - 自动任务归档识别、系统项目归档、明确来源历史修复
- 文档：
  - 本任务文件
  - `TASK_INDEX.md` 索引更新
- 配置/脚本：
  - 覆盖 reasoning 清洗、task summary、popup 行为、自动任务识别的验证脚本或现有脚本扩展

## 5. 验证方式

- 构建：
  - `node --check` 覆盖修改过的 JS/MJS 文件
- 测试：
  - `node scripts/verify-deepseek-default-off.mjs`
  - `node scripts/verify-runtime-search-popup-autotask.mjs`
  - 相关现有脚本：通知、RAG、service core 中至少跑关键子集
- 手动验收：
  - 运行超过 2 分钟的任务 Dock 仍显示运行
  - 查询新闻/天气/最新信息时只走一次预检搜索，然后快速生成答案
  - 鼠标停留、滚动、按钮聚焦时 Popup 不自动消失
  - 定时/邮件自动任务不会写入当前普通项目；能明确识别的历史会话迁入系统项目

## 6. Git 执行方式

- 分支名：`task/uca-085-runtime-search-popup-autotask`
- Commit 格式：`UCA-085: stabilize search popup and auto task routing`
- 合并条件：验证全部通过 + 执行记录已更新

## 7. 完成后必须更新本文件

- 状态改为 `done` / `blocked`
- 填写实际新增内容
- 填写验证结果
- 填写遗留问题
- 更新下一任务交接内容

## 8. 对下一个任务的交接

- 下一个任务：UCA-084 的 84.3/84.4 可继续做输出策略与预览细节
- 本任务新增了什么：运行时轻量摘要接口、自动任务归档守卫、DeepSeek reasoning 清洗、Popup 保活
- 下一个任务直接可复用什么：`/tasks/summary`、自动任务 source 识别、Popup 保活契约
- 还没解决的问题：历史会话只迁移明确可识别项；模糊归类仍保留原项目

## 9. 执行记录

- 状态：`done`
- 执行分支：`task/uca-077-connector-foundation`（当前工作区）
- 开始日期：2026-04-25
- 完成日期：2026-04-25
- 实际新增内容：
  - `config-store` 读写时迁移 AI provider/taskRouting，清理 DeepSeek 上残留的 `enable_thinking:true`，并把 legacy DeepSeek model 归一到 v4 默认。
  - `fast-executor` 的 OpenAI-compatible 请求也走 `applyReasoningSelectionToBody`，DeepSeek v4 默认显式下发 `thinking: disabled`。
  - `agentic/planner` 相关快速联网问答改动已按后续恢复要求回滚到基线；本任务不再提交 planner 路径改动。
  - 新增 `GET /tasks/summary`，返回 active/recent/counts，并在摘要里保留 `selection_metadata.source_id` 等自动任务来源。
  - Dock 改读 `/tasks/summary`，移除“创建时间 2 分钟内才算运行”的错误限制。
  - Popup 卡片 hover、scroll、focus 时暂停自动隐藏；离开/停止交互后恢复计时。
  - Overlay 自动任务识别支持 summary source metadata，能把明确带 schedule/email 来源的历史会话迁入系统项目；背景完成结果不再自动打开完整 Overlay。
  - 更新通知/Popup 相关验证脚本，避免旧字符串断言卡住已经升级的行为。
- 验证结果：
  - `node --check` 通过：`config-store.mjs`、`http-server.mjs`、`dock.js`、`overlay.js`、`popup-card.js`、`task-event-stream.js`、`fast-executor.mjs`
  - `node scripts/verify-runtime-search-popup-autotask.mjs` passed
  - `node scripts/verify-deepseek-default-off.mjs` passed
  - `node scripts/verify-deepseek-v4.mjs` passed
  - `node scripts/verify-agentic-planner.mjs` passed
  - `node scripts/verify-service-core.mjs` passed
  - `node scripts/verify-rag-memory.mjs` passed
  - `node scripts/verify-notification-batch.mjs` passed
  - `node scripts/verify-notifications-unified.mjs` passed
  - `node scripts/verify-popup-card-fit.mjs` passed
- 遗留问题：
  - 历史会话迁移只处理能通过 task summary 明确识别为 schedule/email 的项目；没有 taskId 或来源模糊的会话不会自动移动。
  - planner 快速联网问答路径未随本任务提交；联网搜索执行框架需在恢复稳定后另开任务处理。
- 交接给下一个任务：
  - UCA-084.3 可以继续完善输出策略选择卡。
  - UCA-084.4 可以复用 `/tasks/summary` 与 Popup 保活契约做预览/文件入口修复。
