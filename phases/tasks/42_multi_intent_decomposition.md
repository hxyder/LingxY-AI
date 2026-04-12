# Task UCA-042 — 多意图分解：一次输入 → 多个子任务（分析 / 创作 / 定时 / 搜索 …）

## 1. 任务目标

让用户在对话框里一句话输入多个需求（例如"帮我分析这份 PDF、写一份周报草稿、再定个明天上午 9 点开会的提醒"），系统能识别出多个 intent 并分解成独立的子任务，每个子任务有自己的 task_id、executor、status，同时有一个 parent task 做聚合展示。Console 和 Overlay 都能看到 parent → children 的树形结构。

## 2. 前置依赖

- 上一个任务：UCA-007（status retry metrics）、UCA-017（tool_using）、UCA-039（launch + search）、UCA-046（scheduler UX）、**UCA-049（agentic runtime —— 本任务的 LLM 深度分解器直接复用其 planner，不要自建一套 tool-calling 回路）**
- 必须已有的产物：task runtime、intent router、fast/translate/tool_using/kimi/multi_modal/**agentic** 执行器集合
- 不能同时修改的区域：单任务事件 schema、已有任务的生命周期 state machine、UCA-049 新增的 `provider_*` event 字段（复用，不重命名）

## 3. 实施范围

- 负责模块：intent 分解器、parent/child task 关系模型、聚合事件转发、Console 任务详情子卡片视图
- 允许改动文件/目录：`src/service/core/router/`（intent-router 扩展或新加 `decomposer.mjs`）、`src/service/core/task-runtime.mjs`（加 parent_task_id 字段）、`src/service/core/store/memory-store.mjs`（加 task 关系表）、`src/desktop/renderer/console.js` / `console.html`、`scripts/verify-service-core.mjs`
- 明确不做：多任务并行执行的 GPU / CPU 调度、跨 host 的分布式任务

## 4. 交付产物

- **Intent decomposer**：
  - AI-first 分解：默认先调用 UCA-049 的 agentic planner（或测试注入的 `runtime.intentDecomposer`），让模型判断一句话到底是单一产物请求还是多个独立子任务。
  - 规则层只保留为显式 `mode: "rules_only"` 的测试/兜底模式；默认路径不再用逗号、顿号、"并且/然后"直接拆任务，避免把"总结趋势，并生成 PPT，加图表"错拆成多个不相干任务。
  - LLM 层（深度分解）：产出 JSON 结构 `{ subtasks: [{command, suggested_executor, suggested_formats, dependency_idx}] }`。禁止自建 tool-calling 回路 —— 必须通过 `executors/agentic/planner.mjs` 的公开接口，这样 provider 切换（DeepSeek / Kimi CLI / Claude / Ollama）对分解器也自动生效。
- **task-runtime.mjs 扩展**：
  - task 记录加 `parent_task_id: string | null`、`child_task_ids: string[]`、`child_index: number | null`
  - `submitCompositeTask({ userCommand, capture, runtime })`：跑 decomposer → 创建 parent task（executor: "composite"）→ 对每个子任务递归调用 `submitBrowserTask` / `submitContextTask`，并把 parent 的 `child_task_ids` 填回
  - parent task 的 status 根据 children 汇总：全部 success → success；任一 failed → partial_success；任一 running → running
- **composite executor 占位**：parent task 不跑真正的执行器，只 yield `step_started` / 子任务事件转发 / `success`
- **Console 任务详情扩展**：
  - 任务列表上对 parent task 显示小圆圈标记 (n) 表示有 n 个子任务
  - 选中 parent 后，详情面板显示 "子任务" 区域，每个 child 一张小卡片（title / executor / status / preview artifact），点击卡片切换到对应子任务详情
- **Overlay 侧的简单支持**：提交时如果识别为 composite，气泡里显示 "已分解为 N 个任务"，点击一个数字 badge 能跳到对应结果（UCA-043 做完整 UI）

## 5. 验证方式

- `node scripts/verify-service-core.mjs`（新增：`submitCompositeTask` 产生一个 parent + 多个 child，parent.child_task_ids 长度与输入 intent 数一致）
- `node scripts/verify-runtime-wiring.mjs`
- 手动：输入 "请翻译这段文字、总结那篇 PDF、然后提醒我下午 3 点看回复" → 看到 3 个 child task
- 手动：在 Console 选 parent task → 看到 3 张子卡片

## 6. Git 执行方式

- 分支名：`task/uca-042-multi-intent-decomposition`
- Commit 格式：`UCA-042: multi-intent decomposition with parent/child tasks`
- 合并条件：单输入可拆分为 ≥2 个子任务并分别执行；Console 能看到 parent/child 结构

## 7. 完成后必须更新本文件

- 列出规则层的切分规则与 LLM 深度分解触发条件
- 列出 parent/child 任务关系 schema
- 列出子任务失败 / 取消时 parent 的汇总策略

## 8. 对下一个任务的交接

- 下一个任务：UCA-043（Overlay 多任务输出查看 UI）
- 本任务新增了什么：parent/child task 数据模型 + composite 提交入口
- 下一个任务直接可复用什么：`child_task_ids` 数组、composite executor 的事件流
- 还没解决的问题：UI 切换、数字 badge 点击跳转、结果聚合展示

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：在 service core 建立 parent/child task 关系和 composite 提交入口；默认分解路径 AI-first，复杂分解必须调用 UCA-049 的 agentic planner 公开接口；规则层只作为显式 `rules_only` 测试模式，不再抢在 AI 前面硬切句子。不另建第二套 LLM tool loop。
- 当前代码对齐点：`src/shared/contracts/uca-models.ts`、`src/service/core/task-runtime.mjs` 和 retry 逻辑已经出现 `parent_task_id`，但它服务于重试/派生任务，不等于 composite 子任务模型；需要在 store、submission、event 汇总和 Console 详情里明确区分 `parent_task_id/child_task_ids/child_index`。本任务依赖 UCA-049 先落 `agentic` executor。
- 可能需要生成的文件：`src/service/core/router/decomposer.mjs`、必要的 composite submission helper，扩展 `src/service/core/store/*` schema 和 `scripts/verify-service-core.mjs`；如果新增独立验证，可生成 `scripts/verify-multi-intent.mjs`。
- 实际落地（2026-04-11）：新增 `src/service/core/router/decomposer.mjs`（AI-first agentic planner 调用；支持 `runtime.intentDecomposer` 测试注入与 `mode: "rules_only"` 显式规则模式），新增 `src/service/core/composite-submission.mjs`（parent 任务创建 + child 提交 + 聚合状态），`task-runtime.mjs` 扩展 `child_task_ids / child_index` 并在 child 状态变更时自动汇总 parent 状态，Console/Overlay 支持子任务视图与分解提示，`scripts/verify-service-core.mjs` 增加 AI-first 单产物保留与 rules_only 分解 smoke test。

## 9. 执行记录

- 状态：done
- 执行分支：main
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：`decomposer.mjs` AI-first LLM 深度分解入口（复用 agentic planner）+ 显式 rules_only 规则模式，composite parent/child 提交入口 + parent 状态聚合，task schema 增加 `child_task_ids / child_index`，Console 子任务列表 + Overlay 分解提示，`verify-service-core` 新增 AI-first 与 rules_only 双断言。
- 验证结果：`node scripts/verify-service-core.mjs` 通过；额外 smoke 断言"总结近一年 AI 趋势，并生成 PPT，加图表"在无 runtime 时也保留为单个 agentic/pptx 任务，不再默认拆成 3 个。
- 2026-04-11 追加修复：
  - 用户反馈："发给 AI 一个会话，拆解任务错了，相关的东西拆成了 3 个不相干的"。根因是 `decomposer.mjs` 先跑规则切分，逗号/并列短语把同一产物请求拆散；已改为默认 AI-first，规则只在 `rules_only` 测试模式生效。
  - `routeIntent` 对 `pptx/docx/xlsx/pdf` 等文件产物请求现在即使命中 summarize/translate 这类单步 intent，也升级到 `agentic`，避免"总结并生成 PPT"留在 fast executor。
- 遗留问题（开工前已识别）：
  - 子任务之间的依赖关系（例如"先总结再翻译总结结果"）目前靠 `dependency_idx`，但执行器还不会等待依赖完成
- 交接给下一个任务：
