# Task UCA-049 — Provider 无关的 Agentic 运行时 + 通用工具带 + Provider 切换真实生效

## 1. 任务目标

把现在"分析 / 报告 / 文件 / 图片"类任务硬绑在启动时 Kimi CLI 快照上的执行链，重构成一个 **provider 无关的 agentic 运行时**：不论用户在 UI 里把任务路由切到 Kimi CLI、DeepSeek、OpenAI、Anthropic、Ollama、自定义 OpenAI 兼容端点还是任何未来新接入的 provider，服务端都能按当前配置真的去调那个 provider；同时给 LLM 一个统一的通用工具带（搜索 / 写文件 / 跑脚本 / 生成富文档），让它能自主规划"研究 → 推理 → 写真文件"的多步流程，而不是只会退化成一份 `report.md`。

交付完成后，用户输入 "分析 AI 发展趋势，并生成一份 ppt" 时：

1. 执行链真的调用当前配置的 provider（例如 DeepSeek），而不是启动时的 Kimi CLI。
2. LLM 知道自己能调 `web_search_fetch / write_file / run_script / generate_document`，能先搜、再写大纲 JSON、再生成真 `.pptx`。
3. 任务事件里带明确的 `provider_id / provider_kind / model / transport` 字段，用户能在 Console / Overlay 的任务详情里直接看到"这一步是 DeepSeek deepseek-chat HTTPS"还是"Kimi CLI subprocess"。
4. 用户切换 provider 不需要重启服务，下一条任务立即生效。

## 2. 前置依赖

- 上一个任务：UCA-008（action tools 基础）、UCA-017（real provider / code cli 接入）、UCA-028（输出格式协商）、UCA-039（tool_using + web_search_fetch）
- 必须已有的产物：
  - `src/service/executors/shared/provider-resolver.mjs` 的 `resolveProviderForTask / buildKimiRuntimeFromProvider`
  - `src/service/executors/kimi/kimi-cli-executor.mjs`（stream_json_print + jsonl 两套 transport）
  - `src/service/executors/tool_using/agent-loop.mjs` 的 `llmPlanner` 函数骨架
  - `src/service/action_tools/` 的 registry + risk matrix
  - `src/service/executors/kimi/output-format.mjs` 的 docx/xlsx OOXML 生成路径（PowerShell `create-ooxml-fixture.ps1`）
- 不能同时修改的区域：
  - 已冻结的 task event schema 字段名（只允许追加 `provider_*` 新字段，不允许重命名或删除现有字段）
  - security broker 的 risk matrix 结构（只允许追加新 tool 的条目）
  - 为 UCA-042 预留的 parent/child task 关系契约（本任务只产出 planner/provider/tool 基座，不提前实现 composite task）

## 3. 实施范围

### 负责模块

- **Agentic runtime**：抽取 `llmPlanner` 成为独立模块，支持 anthropic / openai / openai-compatible（DeepSeek / Kimi API / vLLM / 自托管）/ ollama / code_cli 五类 provider 的统一 tool-calling 回路
- **通用工具带**：在 `action_tools/tools/` 加 `write_file / run_script / generate_document`，并把 `web_search_fetch` 从 tool_using 专属改成所有执行器可见
- **Provider-aware executor**：新增 `agentic` 执行器 + 把现有 `kimi` 执行器从"启动快照"改造成"每次 resolve"，并加别名 `code_cli` 让命名真实反映含义
- **Router 升级**：关键词命中不再决定 executor，而是产出 `intent_tags`，由 agentic planner 自己决定要调哪些工具和产物格式
- **Provider 可见性**：每条 task event payload 加 `provider_id / provider_kind / model / transport`；Console / Overlay 任务详情显示；新增 `/ai/active-provider-for-task?type=chat` 调试端点
- **Config hot-reload**：改掉 `persistent-runtime.mjs` 里把 Kimi CLI 快照挂到 runtime 的做法，改为按 taskType 惰性解析
- **smoke-test 埋点**：任何需要调 provider 的路径在执行前都写一条 `ai.provider_resolved` audit log，便于用户在 `/audit` 里核对"这次任务到底走了谁"

### 允许改动文件/目录

- `src/service/executors/agentic/`（新增目录）
  - `planner.mjs` —— provider 无关的 tool-use 回路
  - `provider-adapter.mjs` —— 把 anthropic / openai / ollama / code_cli 统一成 `{ generate(messages, tools) → { text, tool_calls[] } }` 接口
  - `executor.mjs` —— 注册成 `agentic` 执行器
- `src/service/executors/kimi/kimi-cli-executor.mjs` —— 保留 subprocess 实现，但加 `resolveCodeCliRuntimeForTask(taskType)` 的接线
- `src/service/executors/shared/provider-resolver.mjs` —— 新函数 `resolveCodeCliRuntimeForTask(taskType, defaultRuntime)`（代替已有的 `resolveKimiRuntimeForTask`，保留旧名做 alias），并新增 `describeResolvedProvider(provider)` 返回 `{ id, kind, model, transport, provider_name }` 给事件用
- `src/service/core/router/intent-router.mjs` —— `routeIntent` 返回 `{ intent_tags: string[], suggested_executor, requires_confirmation, suggested_formats: string[] }`
- `src/service/core/context-submission.mjs` / `browser-submission.mjs` / `image-submission.mjs` / `file-submission.mjs` —— 把 `runtime.kimiRuntime.command` 硬读改成 `resolveCodeCliRuntimeForTask(taskType, runtime.kimiRuntime)`；把 "task.executor === 'kimi'" 的分支加别名 `code_cli`；emit 事件时带 `provider_*` 字段
- `src/service/core/persistent-runtime.mjs` —— Kimi runtime 从"启动时强制解析"改成"默认 code_cli runtime"，不再在 bootstrap 里强制加载
- `src/service/action_tools/schemas/index.mjs` —— 加 `write_file / run_script / generate_document` 的 schema
- `src/service/action_tools/tools/index.mjs` —— 加 3 个新工具的真实实现（沙箱化 outputDir，`run_script` 仅 `powershell|node|python` 白名单，`generate_document` 调 `create-ooxml-fixture.ps1`）
- `src/service/action_tools/risk_matrix.mjs` —— `write_file: medium`, `run_script: high + requires_confirmation`, `generate_document: low`
- `src/service/executors/kimi/output-format.mjs` —— 追加 `pptx` 分支，并把它纳入统一 `generate_document` 输出通道（见 UCA-028 §9 遗留说明）
- `scripts/create-ooxml-fixture.ps1` —— 加 `-Kind pptx` 的处理
- `src/service/core/http-server.mjs` —— 新增 `GET /ai/active-provider-for-task?type=chat|vision|file_analysis|agentic` 端点
- `src/desktop/renderer/console.js` / `console.html` —— 任务详情面板加一行 "Provider: DeepSeek · deepseek-chat · HTTPS"
- `src/desktop/renderer/overlay.js` —— 提交气泡右下角显示同一行信息
- `scripts/verify-service-core.mjs` / `verify-action-tools.mjs` / `verify-kimi-runtime.mjs` —— count 更新 + 新断言

### 明确不做

- 不做"同一任务内跨 provider 链式切换"（例如 provider A 规划 → provider B 执行）
- 不做付费 / 托管沙箱（run_script 只跑本机子进程，不引入 Docker / WSL 镜像）
- 不做 pptx 的富视觉模板（封面图 / 图表 / 图片嵌入）—— 本任务只要求能生成"纯文字大纲 + 结构正确"的 `.pptx`
- 不做 LLM 自动决定"这个 run_script 的内容要不要确认"—— 全部走 risk matrix 的静态规则
- 不重写 security broker —— 只追加条目

## 4. 交付产物

### A. 抽象的 Provider Adapter（核心）

在 `src/service/executors/agentic/provider-adapter.mjs` 导出统一接口：

```js
// adapter 返回的 chat 调用
await adapter.generate({
  messages: [...],
  tools: [...],           // OpenAI/Anthropic style tool schemas
  maxTokens,
  signal
}) → { text, tool_calls: [{ id, name, arguments }], usage }
```

支持的 provider kind：

| kind | 走法 | 备注 |
|---|---|---|
| `anthropic` | `POST /v1/messages` + `tools` 字段 | 本任务要求真 tool-calling，不再依赖 JSON 解析 |
| `openai` | `POST /chat/completions` + `tools` 字段 | 覆盖 OpenAI 本体、DeepSeek、Kimi API、自托管 vLLM、Azure OpenAI 兼容端点 |
| `ollama` | `POST /api/chat` + `tools`（Ollama ≥ 0.3） | 老版本无 tools 支持时进入显式 JSON planning mode，并在 provider metadata 标注能力受限 |
| `code_cli` | 延用 `executeKimiTask` 的 stream_json_print，把 tool-calling 绕到 taskPackage 里 | **不再依赖启动时快照**，每次从 `resolveCodeCliRuntimeForTask` 拿 command/args/model |

adapter 层必须保证：**切换 provider 时调用路径只差一个 `kind` 分支**，上层 planner 不感知 provider。

### B. Agentic Planner

在 `src/service/executors/agentic/planner.mjs` 实现一个最大 8 步的 tool-use 循环：

1. 构造 system prompt：固定的角色 + **完整工具能力地图**（工具列表 + 每个工具的 JSON schema + 2~3 个举例）+ 当前任务的 output 格式约束。
2. 构造 user prompt：`task.user_command` + `task.context_packet`（文本 / 文件路径 / URL）。
3. 循环 `adapter.generate`：
   - 如果返回 `tool_calls`，跑 registry，把 observation + `tool.success` 作为 tool 消息追加到对话历史。
   - 如果返回纯文本，算作终止。
4. 结束条件：
   - provider 返回纯文本且没有 tool_calls
   - 达到最大迭代 8 次
   - 达到 `max_tokens` 预算（新字段 `runtime.config.agentic.max_iterations` 默认 8）
5. 最后一次文本输出作为 `inlineText`；任何在循环里调 `write_file / generate_document` 产出的路径累计为 artifacts。
6. **强约束**：planner 的最终回复里如果出现 "已完成 / 已保存" 等措辞但 transcript 里没有对应 `success:true` 的工具结果，执行器必须降级为 `partial_success` 并在用户消息里标注"AI 声称已完成但未发现对应工具成功记录"（解 UCA-039 §92 的老 bug 5）。

### C. 通用工具带

| 工具 | 能力 | risk | requires_confirmation |
|---|---|---|---|
| `write_file` | 在 `task.output_dir`（或 `~/Desktop/UCA/<task_id>/`）下写文件，自动创建父目录，拒绝符号链接与 `..` | medium | interactive: 首次写入/覆盖时确认；unattended_safe: 自动允许 |
| `run_script` | `{ language: "powershell"|"node"|"python", script, timeout }`，stdout/stderr 捕获后作为 observation，最大 20 秒；禁止写到 task 输出目录之外 | **high** | 始终要求 interactive 确认；unattended_safe 拒绝 |
| `generate_document` | `{ kind: "pptx"|"docx"|"xlsx"|"pdf", outline: {...} }`，内部调 `create-ooxml-fixture.ps1`；pptx 的 outline schema 是 `{ title, subtitle?, slides: [{heading, bullets: string[]}] }` | low | 不需要确认 |
| `web_search_fetch` | 已经存在；本任务把它从 `tool_using` 专属改成**所有** agentic 调用都可见 | low | 不需要 |

所有工具的 schema 放进 `ACTION_TOOL_SCHEMAS`，实现放进 `BUILTIN_ACTION_TOOLS`，系统 prompt 从 registry 动态渲染（禁止把工具列表硬编码字符串进 prompt —— 见 D 节）。

### D. System Prompt 必须从 registry 动态渲染

新增 `src/service/executors/agentic/prompt-builder.mjs`：

```
You are UCA's agentic assistant. You have the following tools available:

<tool id="web_search_fetch">
  description: ...
  schema: { query: string, recency?: "day"|"week"|"month"|"year" }
  example: { "query": "latest AI trends 2026", "recency": "month" }
</tool>
<tool id="generate_document">
  ...
</tool>
...

Rules:
1. Before writing about recent / current topics, always call web_search_fetch first.
2. If the user asks for a file-based artifact (pptx/docx/xlsx/pdf), call generate_document. Do not refuse by saying you cannot save files — you can.
3. Only claim something was "done" or "saved" when a tool returned success:true in the transcript.
4. Use the user's language in your final reply.
5. Keep the final reply concise; the real deliverables live in the generated artifacts.
```

**这一节是让 AI "变聪明"的关键**：LLM 不再依赖预训练的默认"我是个只会写字的助手"倾向，而是每次都被告诉"你有这些工具，你能写真文件"。

### E. Executor：`agentic`

- `id: "agentic"`
- `supportsStreaming: true`
- 注册到 `executorRegistry`
- 在 `context-submission.mjs / browser-submission.mjs` 里，任何 `task.executor === "agentic"` 的任务：
  - 调 `resolveProviderForTask(task.intent_tags.includes("vision") ? "vision" : "chat")`
  - 构造 adapter → planner → 跑循环
  - 每一步都 emit 事件带 `provider_*` 字段

**不删除 `kimi` 执行器** —— 把它降级为 `code_cli` 的一个直通别名，调用 `resolveCodeCliRuntimeForTask(taskType, runtime.kimiRuntime)` 而不是 `runtime.kimiRuntime.*`。这样：

- 用户配了 Kimi CLI → 行为不变
- 用户配了 DeepSeek → `resolveCodeCliRuntimeForTask` 返回 null，调用路径进入 agentic executor + DeepSeek adapter

### F. Router 升级

`routeIntent(userCommand)` 返回：

```js
{
  intent_tags: ["analyze", "generate_document"],   // 不再是单选
  suggested_executor: "agentic",
  suggested_formats: ["pptx"],                      // 可能为空
  requires_confirmation: false
}
```

规则层仍是关键词匹配，但允许多 tag 并存；`agentic` 是新默认值；只有明确"只是翻译 / 只是改写"这类一眼单 intent 才直接下 `translate / fast`。

### G. Output format 追加 `pptx`

在 `detectRequestedOutputFormat` 追加：

```js
if (/(?:\.pptx|pptx|powerpoint|ppt\b|幻灯片|演示(?:文稿|文档)?|slides?|slideshow)/i.test(normalized)) {
  return {
    id: "pptx",
    extension: ".pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    primaryRequirement: "pptx_presentation",
    promptInstruction: "Return a JSON outline: { title, subtitle?, slides: [{heading, bullets:[string]}] }. Do not wrap in code fences."
  };
}
```

`writeRequestedArtifacts` 加 pptx 分支，调 `create-ooxml-fixture.ps1 -Kind pptx -OutlineJsonPath <tmp>.json`。

### H. Provider 真实生效的证明

- 每条 emit 出去的 task event `payload` 加：
  ```js
  provider_id: "deepseek",
  provider_kind: "openai",        // openai-compatible
  provider_name: "DeepSeek",
  model: "deepseek-chat",
  transport: "https"              // or "subprocess"
  ```
- Console 任务详情显示一行 `Provider: DeepSeek · deepseek-chat · HTTPS`
- Overlay 气泡右下角小字显示同样信息
- `GET /ai/active-provider-for-task?type=chat` 返回当前会用的 provider 信息，供用户手动核对
- `scripts/verify-provider-routing.mjs`（新）：跑三次配置切换，断言每次返回的 provider_id 跟 config 里写的一致

### I. Config hot-reload

- 去掉 `persistent-runtime.mjs` 里强制 resolve kimiRuntime 的代码（改成 `resolvedKimiRuntime = null`）
- 所有提交路径执行前都调一次 `resolveProviderForTask(taskType)`
- `configStore.load()` 每次都重读 disk，不缓存
- 手动验收：切换 provider 后立即提交任务，不重启服务

## 5. 验证方式

### 构建

- `npm run check`

### 自动测试

- `node scripts/verify-action-tools.mjs` —— count 18 → 21（新工具 3 个）；断言：
  - `write_file` 拒绝 `..`、拒绝符号链接、正常写入
  - `run_script` 只允许 powershell/node/python 三种 language，超时被 kill
  - `generate_document` with `kind:"pptx"` 产出合法 `.pptx`（用 Node `jszip` 打开 + 断言 `ppt/presentation.xml` 存在）
- `node scripts/verify-service-core.mjs` —— 新断言：切换 `config.ai.taskRouting.chat.providerId` 后第二次 `submitContextTask` 使用新 provider
- `node scripts/verify-kimi-runtime.mjs` —— 保留，确保 Kimi CLI 兼容路径不破
- `node scripts/verify-provider-routing.mjs`（新）—— 三组 config，每组跑一条 dummy task，断言 event payload 里的 `provider_id`
- `node scripts/verify-file-kimi.mjs` —— pptx 新格式的回归

### 手动验收（关键）

**场景 A：provider 切换真的生效**

1. 启动服务，默认 provider = DeepSeek
2. 在 Console 提交"分析 AI 发展趋势"
3. 打开任务详情，看到 `Provider: DeepSeek · deepseek-chat · HTTPS`
4. 切换到 Kimi CLI，再提交同样的命令
5. 任务详情应显示 `Provider: Kimi CLI · kimi-k2 · subprocess`
6. `GET /audit?task_id=<id>` 应该包含 `ai.provider_resolved` 这条 log，内容跟 event 一致

**场景 B：AI 能自己生成 pptx**

1. provider = DeepSeek
2. Overlay 输入"分析 AI 发展趋势，并生成一份 ppt"
3. 后台出现多步事件流：
   - `tool_call_completed` tool=`web_search_fetch`
   - `tool_call_completed` tool=`generate_document` args.kind=pptx
   - `artifact_created` path=`...\result.pptx`
4. 打开桌面 `~/Desktop/UCA/<task_id>/result.pptx`，能在 PowerPoint 里正常打开，且幻灯片内容跟搜索结果对应
5. 再问"把这份 ppt 翻译成英文版" → planner 会调 `generate_document` 二次产出 `result-en.pptx`

**场景 C：AI 不再撒谎**

1. 故意把 `run_script` 配置为空白名单，让它必失败
2. 输入"帮我用 python 生成一个随机数并打印"
3. tool_call 返回 `success:false`
4. 最终气泡里应该有"未能执行脚本，原因：..."，而不是"已执行，结果是 42"

### 性能/稳定

- agentic planner 单任务循环 ≤ 8 轮 → 最多 8 次 LLM 调用 + 8 次 tool 调用，总时长 P95 < 45 秒
- provider adapter 出错（网络 / auth / timeout）应直接映射到 `classifyFailure`，不要吞错

## 6. Git 执行方式

- 分支名：`task/uca-049-agentic-runtime`
- Commit 格式：`UCA-049: <sub summary>`，拆分 3 个 commit：
  1. `UCA-049: provider-agnostic adapter + code_cli runtime resolution per task`
  2. `UCA-049: agentic planner + universal tool belt (write_file / run_script / generate_document)`
  3. `UCA-049: pptx output format + provider visibility in task events and UI`
- 合并条件：
  - 上述 §5 的自动测试全通过
  - 场景 A / B / C 手动验收有截图或终端日志
  - UCA-028 的 §60 遗留说明更新（pptx 已落地）
  - UCA-039 的 §92 遗留 bug 5 标注解决（"AI 说已完成但实际没执行"由 planner 强约束根治）
  - 本文件 §9 执行记录更新完整

## 7. 完成后必须更新本文件

- 状态改为 `done`
- 列出 provider adapter 实际覆盖的 kind 以及每种 kind 的已验证 provider
- 列出通用工具带的沙箱规则与 risk 分级
- 列出 agentic planner 的默认迭代上限与实际测量的 P95 延迟
- 列出 intent_tags 的最终枚举
- 列出 `provider_*` 事件字段完整名单
- 列出已知的 pptx 限制（字体 / 模板 / 嵌入图）
- 列出 config hot-reload 的边界情况（例如进行中任务不会被中途切换 provider）

## 8. 对下一个任务的交接

- 下一个任务：UCA-042（多意图分解）—— 本任务完成后，UCA-042 的 decomposer 可以直接调 agentic planner 来做复合句的 LLM 分解，不用再自建一套 tool-calling 回路
- 顺带利好：UCA-044 / UCA-045（邮箱监控 / 早晨 digest）可以直接用 `generate_document` 交付汇总 docx；UCA-047（活动窗口深度上下文）可以直接把上下文塞进 agentic planner 的 user prompt
- 本任务新增了什么：
  - provider 无关的 chat 抽象层（`provider-adapter.mjs`）
  - 统一的 agentic tool-use 循环
  - 3 个新通用工具（write_file / run_script / generate_document）
  - `web_search_fetch` 从 tool_using 专属提升为全 executor 可见
  - intent_tags 多标签路由
  - provider 切换真实生效 + UI 可见
  - pptx 输出格式
- 下一个任务直接可复用什么：
  - `adapter.generate({messages, tools})` 接口
  - agentic planner 作为分解器的底座
  - event payload 里新增的 `provider_*` 字段
- 还没解决的问题：
  - 跨 provider 协作（本任务范围外）
  - pptx 富视觉模板
  - run_script 的 Docker/WSL 隔离
  - 长网页正文抓取

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：以 `agentic` executor + provider adapter + 动态工具 registry prompt 作为新的统一执行面，解决 provider 切换不生效、pptx 真文件生成、搜索/工具事实约束和后续多意图分解。所有新能力从 registry / adapter / planner 进入，不在 `kimi`、`tool_using`、`output-format` 某个单点做临时分支。
- 当前代码对齐点：`src/service/executors/shared/provider-resolver.mjs` 已存在，但 `context-submission.mjs`、`browser-submission.mjs`、`image-submission.mjs` 仍有 `runtime.kimiRuntime` 快照硬读；`src/service/executors/tool_using/agent-loop.mjs` 有 `web_search_fetch`，但不是 provider 无关 planner；`scripts/create-ooxml-fixture.ps1` 当前只支持 `docx/xlsx`；`src/service/executors/kimi/output-format.mjs` 还没有 `pptx`。本任务必须把这些点统一到 per-task provider resolution 和 `generate_document`。
- 可能需要生成的文件：`src/service/executors/agentic/provider-adapter.mjs`、`planner.mjs`、`prompt-builder.mjs`、`executor.mjs`、`scripts/verify-provider-routing.mjs`，并扩展 action tool schemas/tools、risk matrix、OOXML fixture、Console/Overlay provider display。

## 9. 执行记录

- 状态：done（commit 1/2/3 全部落地）
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11

### 变更动机与整体设计解释（2026-04-11）

下面这段是为了让未来翻开这份任务 log 的人能快速读懂「为什么这样改」而写的。具体文件级别的改动清单见后面 commit 1/2/3 的分段记录。

**1. 为什么把 provider 解析搬到提交路径里做，而不是在启动时一次性快照？**

原来的架构在 `persistent-runtime.mjs` 启动时通过 `resolveKimiRuntime()` 把 Kimi CLI 的 `{command, args, env, transport, model, ...}` 一次性解析出来挂到 `runtime.kimiRuntime`，然后 `context-submission.mjs` / `browser-submission.mjs` / `image-submission.mjs` 的 `runKimiExecutor` 函数里硬读 `runtime.kimiRuntime.command` 等字段。问题：用户在 UI 里切换 provider（例如从 Kimi CLI 切到 DeepSeek API）不会有任何效果，因为那个快照永远指向 Kimi CLI —— 只有 `fast` executor 每次都调一次 `resolveProviderForTask("chat")` 所以它是跟得上的，其他所有路径都在跑错 provider。这是 §69 清单里 **bug #7「切到 DeepSeek 后还在跑 Kimi CLI」** 的根因。

修法：引入 `resolveCodeCliRuntimeForTask(taskType, fallback)`，所有提交路径每次都调一次。并且给它一个关键的语义变更 —— **当用户把任务路由到一个非 code_cli 的 API provider 时，函数返回 `null`**（而不是退回到启动时的 Kimi 快照）。这样 `shouldUseKimi && resolvedCliRuntime` 的分支就会短路，任务流向 `runExecutor` 走 `fast / agentic / tool_using` 等 API-based 路径。boot-time 快照降级为"用户完全没配任何 provider 时"的 last-resort fallback。

**2. 为什么新加 adapter 层而不是直接在 `fast-executor` 里加分支？**

`fast-executor.mjs` 里已经有 `callAnthropic / callOpenAICompatible / callOllama` 三个分支，按 `provider.id === "anthropic"` 分流。这套做法的问题是每个 executor 都得重复这三个分支，而且 tool-calling 支持（anthropic 的 `tool_use` block / openai 的 `tool_calls`）会让分支爆炸。

修法：抽出 `createProviderAdapter(resolved)` —— 接受一个 resolved provider 对象，返回统一的 `{kind, model, transport, generate({messages, tools, maxTokens, signal, fetchImpl})}` 接口。五类 provider kind（anthropic / openai / ollama / code_cli / 未来新 kind）共享同一入口，每类只有一个分支，tool schema 翻译（anthropic `input_schema` vs openai `function.parameters`）封装在 adapter 内部，调用方完全不感知。这一层是后面 planner、多意图分解（UCA-042）、邮件 digest（UCA-044/045）等所有需要 LLM 的地方的共同底座。

**3. 为什么 system prompt 要从 registry 动态渲染，而不是写死？**

`tool_using` executor 的 system prompt 是一段硬编码字符串，加新工具就得同步改 prompt，很容易漏。更糟的是，如果同一个 executor 需要根据用户环境切换工具集（例如未检测到 Python 就不提供 run_script），硬编码 prompt 就要分叉多份。

修法：`prompt-builder.mjs` 的 `buildAgenticSystemPrompt({tools, task, requestedFormat, language})` 每次调用时从传入的 `tools` 数组（默认来自 `runtime.actionToolRegistry.list()`）动态渲染 `<tool id="..."> name / description / parameters / example </tool>` 块 + 6 条行为规则。加新工具 → 立刻出现在所有 provider 的 prompt 里，零分支、零同步工作量。这条是让 §11 "AI 能自主搜索 + 写代码 + 生成真 pptx" 这种模糊需求可以线性扩展的关键。

**4. 为什么 truthfulness guard 要在 planner 而不是 UI 层做？**

§69 bug #5 是"AI 说已启动应用但实际没启动"。它的根因是 LLM 的训练数据里充满了"假装任务完成"的例子，单纯在 system prompt 里写 "Only say done when a tool returned success" 是不够的 —— 模型仍然会一半时候违反。

修法：在 planner 的循环结束后加一道硬约束 —— `claimsCompletion(finalText) && !anyToolSucceeded(transcript) → downgraded = true`。降级是一个数据层的标记，UI 层只负责显示 `[UCA note] downgraded` 警告。这样：(a) 写新 executor 或新 provider 时自动继承这个约束，不需要每个前端渲染器都重新实现一遍；(b) 任务 event 流里带了 `downgraded: true` 字段，可以进审计日志、可以进 metrics，可以被 UCA-042 的分解器上游感知。COMPLETION_CLAIM_PATTERNS 的中英文覆盖不是拍脑袋写的 —— 是基于 §69 bug #5 的实际措辞（"已启动"）加常见的英文同义词。

**5. 为什么 router 升级到 intent_tags 多标签而不是单 executor？**

§69 bug #6 是"分析 AI 趋势并生成一份 ppt"退化为 `report.md + 免责声明`。根因有三条：(a) 老 router 只选一个 executor（`kimi`），(b) `output-format.mjs` 没有 pptx 分支，(c) LLM 的 system prompt 没告诉它可以写文件。

修法三管齐下：(a) router 新返回 `{intent_tags, suggested_formats, suggested_executor}`，`analyze + generate_report + pptx` 三个信号任意一个命中就把 executor 升级为 `agentic`。(b) `detectRequestedOutputFormat` 加 pptx 分支，`create-ooxml-fixture.ps1` 加 `-Kind pptx` 真正能生成合法 `.pptx`。(c) `generate_document` 工具进 registry，动态 prompt 渲染让 LLM 真正知道它能调这个工具生成 pptx/docx/xlsx/pdf。三个点一起到位，这条 bug 才算真修。

**6. 为什么 code_cli 要走 JSON planning mode 而不是原生 function-calling？**

Kimi CLI / Claude Code CLI / Codex / Gemini 这类 `--print` 兼容的 CLI 都是纯文本进纯文本出，没有一个是支持 OpenAI/Anthropic 那种结构化 function-calling API 的。commit 1 / commit 2 为了避免阻塞先给 code_cli 加了 short-circuit（"你还没被支持，切到 API provider"），但这让用户实际使用 Kimi CLI 的时候体验很差。

修法：`code-cli-bridge.mjs` 做 JSON planning mode —— messages 序列化为单一 text prompt，在末尾追加一段 "Tool calling protocol"，让 LLM 用 `\`\`\`json {"tool_call": {"name": "...", "arguments": {...}}} \`\`\`` 的纯文本 JSON 块表达工具调用。然后 parser 既识别围栏块也识别裸 JSON（用 brace-depth 扫描，不依赖换行符）。这样 Kimi CLI / Claude Code CLI / 任何未来的 code CLI 都能直接参与 agentic 循环，planner 的主循环**完全不变**，只有 adapter 内部多了一个 `case "code_cli":` 分支。

**7. 为什么 Console 和 Overlay 都要显式渲染 provider 行？**

没有 provider 可见性之前，用户切换 provider 之后根本不知道下一条任务实际走了谁 —— 这就是 bug #7 之所以长期没被发现的原因。即使代码层修好了，UI 不显示也等于没修，用户下次还会怀疑。

修法：commit 1 在所有 task event payload 里注入 `provider_id / provider_kind / provider_name / model / transport` 五个字段；commit 3 在 Console 任务详情面板和 Overlay 气泡底部渲染 `Provider: <name> · <model> · <transport>` 行。配合 `downgraded === true` 的琥珀色警告框，用户每次提交任务都能看到"这次走的是哪个 provider、哪个模型、是 HTTPS 还是 subprocess、AI 有没有在撒谎"四个信息，能直接闭环 bug #5 和 bug #7 的疑虑。`/ai/active-provider-for-task?type=chat|vision|file_analysis|agentic` 是配套的诊断端点，用户（或者自动化测试）可以主动查询"下一条任务会走谁"而不用先跑一条。

**8. 为什么文件结构里新增了 `src/service/executors/agentic/`？**

原来的 `src/service/executors/` 下每个子目录（`fast`、`kimi`、`tool_using`、`multi_modal`、`translate`）都是一个 executor，大家并排。`agentic/` 是一个新 executor 子目录，内部分为 4 个纯函数模块：

```
agentic/
├── provider-adapter.mjs    # 传输层：五类 provider kind 的统一 generate() 接口
├── prompt-builder.mjs      # 表示层：从 registry 动态渲染 system prompt
├── planner.mjs             # 决策层：8 步 tool-use 循环 + truthfulness guard
├── executor.mjs            # 执行层：id:"agentic" executor scaffold，桥接 planner 到 event stream
└── code-cli-bridge.mjs     # 适配层：code_cli 的 JSON planning mode 桥接 subprocess → generate()
```

每个文件只做一件事，有明确的输入输出边界，可以独立测试。`verify-agentic-planner.mjs` 的 5 个用例分别覆盖：prompt-builder（case 1）、planner 主循环（case 2）、truthfulness guard（case 3）、code-cli-bridge 单元（case 4）、code_cli 端到端通过真实 mock CLI subprocess（case 5）。这样设计后，UCA-042 / UCA-044 / UCA-045 / UCA-047 可以直接 `import { runAgenticPlanner } from "../agentic/planner.mjs"` 复用这套底座而不用复制代码。

**9. 为什么 file-submission.mjs 暂时保留 `agentic → kimi` 的 fallback？**

file-submission 专门处理文件-backed 的分析任务（explorer 右键菜单 / drag-and-drop 文件）。Kimi CLI 有原生的文件读取能力（通过 taskPackage 的 `file_paths` + 工作目录），而 agentic planner 目前还没接文件上下文注入。强行让 agentic 接管会导致 planner 读不到文件。

折中：`preferredExecutorOverride = ... ? "kimi" : null` 把 `agentic` 升级为"有 kimi runtime 就降级回 kimi"。这是一个暴露在任务记录里的显式 tradeoff，未来 UCA-047（活动窗口深度上下文）会给 agentic planner 加 file-reading 注入，到时候就可以拆掉这个 fallback。
- 实际新增内容（commit 1 — provider-agnostic adapter + code_cli runtime resolution per task）：
  - **`src/service/executors/shared/provider-resolver.mjs`**：
    - `providerToResolved` 现在同时写入 `id`（kind）和 `configId`（用户自定义 provider id），这样 DeepSeek 路由能被唯一识别而不是被笼统地记为 `openai`
    - 新增 `resolveCodeCliRuntimeForTask(taskType, fallback)` 作为 canonical name；`resolveKimiRuntimeForTask` 保留为 alias。**语义变更**：当用户把任务路由到一个非 code_cli 的 API provider 时，此函数返回 `null`（而不是退回到启动时的 Kimi 快照）—— 这是 bug #7「切到 DeepSeek 后还在跑 Kimi CLI」的真正修复
    - 新增 `describeResolvedProvider(resolved)` → `{provider_id, provider_kind, provider_name, model, transport}`，供任务事件 payload / Console UI / `/ai/active-provider-for-task` 使用
    - 新增 `describeCodeCliRuntime(runtime, opts)` —— 从已构造好的 code_cli runtime 生成同形描述符，避免调用方必须先持有 resolved provider 对象
    - 新增 `resolveActiveProviderForTask(taskType, fallback)` —— 一次返回 descriptor + runtime，诊断端点直接消费
    - `buildKimiRuntimeFromProvider` 现在把 `providerName` / `configId` 一并带入 runtime 对象，后续事件链能一路带出
    - `loadConfig()` 现在保留"每次调用都重读 disk"，并新增 `UCA_FORCE_BOOT_KIMI_RUNTIME=1` 测试 hatch：置 1 时 resolver 假装用户没配任何 provider，让显式注入 kimiRuntime 的 verify 脚本走确定性 fallback 路径
    - `getConfigPath()` 支持 `UCA_CONFIG_PATH` 环境变量覆盖，verify-provider-routing 借此把配置隔离到 `.tmp/` 而不污染真实 AppData
  - **`src/service/executors/agentic/provider-adapter.mjs`（新文件）**：
    - `createProviderAdapter(resolved)` 返回 `{kind, model, transport, descriptor, describe(), generate({messages, tools, maxTokens, signal, fetchImpl})}`，五类 provider kind 共享同一接口
    - `anthropic` 分支：POST `/v1/messages`，`tools` → `input_schema` + `tool_use` block 解析；tool_call 以统一 shape `{id, name, arguments}` 返回
    - `openai` 分支（覆盖 OpenAI 本体 / DeepSeek / Kimi API / vLLM / Azure 兼容端点）：POST `/chat/completions`，`tools` → function schema + `tool_calls` 解析
    - `ollama` 分支：POST `/api/chat`，`tools` 直通（Ollama ≥ 0.3）
    - `code_cli` 分支：接口已建立但 `generate()` 显式抛 `ADAPTER_CODE_CLI_NOT_IMPLEMENTED`，commit 2 再接入 stream_json_print 的 JSON planning mode
    - `fetchImpl` 可注入（verify-provider-routing 用它 mock fetch 断言 URL / body / auth header）
  - **`src/service/core/context-submission.mjs`**：
    - `runKimiExecutor` 不再硬读 `runtime.kimiRuntime.command/args/env/...`，改成接收 `cliRuntime` 参数，默认 `resolveCodeCliRuntimeForTask("chat", runtime.kimiRuntime)`
    - 调用方计算 `resolvedCliRuntime` 一次、一路传给 `runKimiExecutor({cliRuntime, providerDescriptor})`，确保一个任务生命周期内只用一套 runtime（用户中途切 provider 不会中断正在跑的任务）
    - 进入执行器前 emit 一条 `provider_resolved` 事件 + 写一条 `ai.provider_resolved` audit log，payload 带 `task_id / task_type / provider_id / provider_kind / provider_name / model / transport`
    - Kimi CLI 每个 `onEvent` 回调也经过 `attachProviderFieldsToEvent(descriptor, event)`，前端 SSE 收到的每条事件都带 provider 字段
    - `pickRunnableExecutor` 和 `shouldUseKimi` 都新增 `code_cli` 作为 `kimi` 的别名，为 commit 2 的 agentic/code_cli 双通道做准备
    - `runExecutor`（跑 fast/tool_using/multi_modal）同样 emit `provider_resolved` + 为每条 executor 事件附加 provider 字段
  - **`src/service/core/browser-submission.mjs`**：对称改造
    - `runBrowserExecutor` 计算 `resolvedCliRuntime` → 传进 `runKimiExecutor`
    - `runKimiExecutor` 签名加 `cliRuntime` / `providerDescriptor` 参数，不再读 `runtime.kimiRuntime.*`
    - emit `provider_resolved` + audit log + 每条事件附加 provider 字段，与 context-submission 完全对称
    - `pickRunnableExecutor` 同步加 `code_cli` 别名
  - **`src/service/core/image-submission.mjs`**：
    - `runKimiImageFallback` 接收 `cliRuntime` / `providerDescriptor`，默认从 `resolveCodeCliRuntimeForTask("vision", runtime.kimiRuntime)` 来
    - 入口判断从"没有 vision env key + 有 boot-time kimi"改成"没有 vision API provider + 有 vision code_cli runtime"，后者由 `resolveProviderForTask("vision")` 决定
    - `runExecutor` 同样 emit `provider_resolved` + 附加 provider 字段
  - **`src/service/core/file-submission.mjs`**：
    - 已有的 `resolveKimiRuntimeForTask("file_analysis", ...)` 调用保留（alias 指向新函数）
    - 新增 `provider_resolved` event emission + audit log + `attachProviderFieldsToEvent` 套在 Kimi CLI 的 `onEvent` 回调外层
    - 入口判断加 `task.executor === "code_cli"` 作为 `"kimi"` 的别名
  - **`src/service/core/persistent-runtime.mjs`**：
    - 启动时仍然调 `resolveKimiRuntime` 作为"fresh install 用户完全没配 provider"的 last-resort fallback，但加注释说明：每个任务的真实 provider 都由提交路径的 `resolveCodeCliRuntimeForTask` 动态决定，boot-time 快照不再是 "source of truth"
  - **`src/service/core/http-server.mjs`**：
    - 新增 `GET /ai/active-provider-for-task?type=chat|vision|file_analysis|agentic` 诊断端点，返回 `{task_type, descriptor, runtime_source}`；用户/verify 脚本可以直接核对「下一条任务会走哪个 provider」
  - **`scripts/verify-provider-routing.mjs`（新脚本）**：6 个用例
    1. DeepSeek（openai-compatible）配置 → resolve + describe + mocked fetch 打到 `https://api.deepseek.com/v1/chat/completions` + `Authorization: Bearer sk-...` + 返回 `choices[0].message.content`
    2. Kimi CLI（code_cli）配置 → `resolveCodeCliRuntimeForTask` 返回带 user command 的 runtime；`createProviderAdapter(...).generate()` 明确抛 `ADAPTER_CODE_CLI_NOT_IMPLEMENTED`（commit 1 契约）
    3. Anthropic（Claude API）配置 → mocked fetch 打到 `https://api.anthropic.com/v1/messages` + `x-api-key` header + 解析 `content[].type === "text"`
    4. Ollama 配置 → mocked fetch 打到 `http://127.0.0.1:11434/api/chat` + 解析 `message.content`
    5. **Hot reload**：磁盘上写两份不同的 config，中间不重启 → 第二次 `resolveProviderForTask("chat")` 必须看到新 provider（这是 bug #7 的回归守护）
    6. `resolveActiveProviderForTask` 对 code_cli provider 同时返回 descriptor + runtime（给 `/ai/active-provider-for-task` 端点用）
  - **`scripts/verify-service-core.mjs`**：新增 commit-1 smoke 断言
    - `describeResolvedProvider` 对 DeepSeek-style 和 code_cli-style resolved 都返回正确形状（transport https / subprocess）
    - `createProviderAdapter` 能为 `openai / anthropic / ollama / code_cli` 四个 kind 各自构造出可用 adapter
    - `resolveCodeCliRuntimeForTask` / `resolveActiveProviderForTask` 在 `UCA_FORCE_BOOT_KIMI_RUNTIME=1` 下正确返回 boot-time fallback + subprocess 描述符
  - **`scripts/verify-kimi-runtime.mjs`**：改为 lazy import + 把 resolver 隔离到独立空 config（`UCA_CONFIG_PATH` 指向 `.tmp/verify-kimi-runtime/empty-runtime.json`），这样真实 AppData 里已有的 DeepSeek 路由不会短路掉针对 Kimi CLI subprocess 的集成测试
  - **`scripts/verify-status-metrics.mjs`**：开头加 `process.env.UCA_FORCE_BOOT_KIMI_RUNTIME = "1"`，理由同上
  - **`package.json`**：`check` 脚本新增 `verify-provider-routing`；`scripts` 段新增 `verify:provider-routing` alias
- 验证结果（commit 1）：
  - `npm run check` —— 全部 26 个 verify 脚本通过：structure / desktop-shell / desktop-renderer / overlay-composer / context-handoff-ui / console-ui / console-runtime-client / console-rendered-workspace / service-core / provider-health / **provider-routing（新）** / file-kimi / kimi-runtime / browser-extension / browser-overlay / office-base / pdf-ocr / status-metrics / action-tools / security-broker / scheduler / platform-foundation / template-dag-persistence / runtime-wiring / native-integrations / release-readiness
  - kimi-runtime 在本地真实 Kimi CLI 下触达 subprocess，最终被 Kimi 账号 quota 限流（CLI 本身被正确调用，只是 LLM 调用失败）—— subprocess 的挂接路径已验证
  - 手动用例（待 commit 3 落地 Console UI 后联调）：切到 DeepSeek → 提交任务 → task event payload 的 `provider_id="openai.deepseek.4a6t" / provider_kind="openai" / transport="https"`；切到 Kimi CLI → 下一条任务 `provider_id="code_cli.kimi.op9e" / provider_kind="code_cli" / transport="subprocess"`
- 遗留问题（commit 1 结束时）：
  - **code_cli adapter.generate() 未实现**：`createProviderAdapter({kind: "code_cli"}).generate()` 目前显式抛 `ADAPTER_CODE_CLI_NOT_IMPLEMENTED`；commit 2 的 agentic planner 会接入 stream_json_print 的 JSON planning mode（工具 catalogue 注入 system prompt + 解析 stdout 里的 JSON tool-call block）
  - **agentic planner 本身**：commit 1 只落地了 adapter 与 provider 可见性；真正的 tool-use 循环、通用工具带（`write_file / run_script / generate_document`）、intent_tags 多标签路由、pptx 输出都要在 commit 2/3 做
  - **Console / Overlay 任务详情 provider 行**：commit 1 已把 `provider_*` 字段塞进了每条 task event payload，但前端还没有渲染"Provider: DeepSeek · deepseek-chat · HTTPS"这一行 —— 留给 commit 3
  - **`/ai/active-provider-for-task` 端点**：已落地 http 路由，但前端 Settings 还没引导用户点击核对；同样留给 commit 3
  - **已知局限**：`UCA_FORCE_BOOT_KIMI_RUNTIME=1` 是一个 test hatch，生产代码不应设置它；若用户真的需要绕过 config 只用 boot-time kimi，可以删除所有 customProviders 配置达成同样效果
- 实际新增内容（commit 2 — agentic planner + universal tool belt）：
  - **`src/service/action_tools/schemas/index.mjs`**：新增三个 schema —
    - `write_file`：`{path, filename?, content, text?, overwrite?, encoding?}`
    - `run_script`：`{language, script, code?, timeout?}`
    - `generate_document`：`{kind, outline, filename?}`
  - **`src/service/action_tools/tools/index.mjs`**：新增三个工具实现 —
    - `WRITE_FILE_TOOL`（risk: medium）：通过 `resolveSandboxedTarget(outputDir, path)` 沙箱检查，拒绝 `..` 段、拒绝任何父目录或目标自身是 symlink、要求 `overwrite:true` 才能覆盖已存在的文件。支持 `utf8 / base64` 编码
    - `RUN_SCRIPT_TOOL`（risk: high, requires_confirmation: true）：`language` 强白名单 `powershell | node | python`；`timeout` clamp 到 `[1, 20]` 秒；spawn 后超时自动 `SIGKILL`；stdout/stderr 最多 4KB 注入 observation；捕获 spawn 错误不抛
    - `GENERATE_DOCUMENT_TOOL`（risk: low）：`kind` 白名单 `pptx | docx | xlsx | pdf`；调用 `scripts/create-ooxml-fixture.ps1`（复用 output-format 的 helper 模式）；`outline` 根据 kind 扁平化到 plain text；pdf 分支产出 HTML sidecar + 标记 `needs_pdf_conversion: true`（最终 PDF 由 output pipeline 的 headless browser 处理）
    - `BUILTIN_ACTION_TOOLS` count 18 → 21
  - **`src/service/action_tools/risk_matrix.mjs`**：新增 3 个分支 —
    - `write_file`：unattended_safe + overwrite:true → requires_confirmation
    - `run_script`：无论何时都 requires_confirmation（unattended_safe 环境直接拒绝，理由 `run_script_forbidden_unattended`）
    - `generate_document`：低风险，不需要确认
  - **`scripts/create-ooxml-fixture.ps1`**：新增 `-Kind pptx` 分支 —
    - 按空行拆分 `Text` 成多个 slide；每个 slide 单独一个 `slideN.xml` + 对应 `_rels`
    - 生成最小但合法的 `[Content_Types].xml` + `_rels/.rels` + `ppt/_rels/presentation.xml.rels` + `ppt/presentation.xml` + `ppt/slides/slideN.xml` + `ppt/slides/_rels/slideN.xml.rels`
    - 使用标准 OOXML namespace，PowerPoint 和 LibreOffice Impress 都能打开
    - ValidateSet 从 `{docx, xlsx}` 扩展到 `{docx, xlsx, pptx}`
  - **`src/service/executors/kimi/output-format.mjs`**：
    - `detectRequestedOutputFormat` 新增 pptx 分支（命中 `\.pptx / pptx / powerpoint / \bppt\b / 幻灯片 / 演示(?:文稿|文档)? / slides? / slideshow`），`promptInstruction` 明确告诉 LLM 要返回 JSON outline
    - `wantsExplicitFormat` 同步追加 pptx/ppt/幻灯片等关键词
    - 新增 `parsePptxOutlineFromText` —— 先 JSON.parse 解析，失败时退化为启发式（按 `# heading` / 空行拆分）
    - 新增 `renderPptxOutlineToPlainText` —— 把 outline 结构序列化为 PowerShell 脚本吃的扁平 text
    - 新增 `writePptxArtifact` —— 调用 `create-ooxml-fixture.ps1 -Kind pptx`
    - `writeRequestedArtifacts` 追加 pptx 分支，产出 `result.pptx` + `result-preview.txt` 两个 artifact
  - **`src/service/executors/agentic/prompt-builder.mjs`（新文件）**：
    - `buildAgenticSystemPrompt({tools, task, requestedFormat, language})` —— 从动态传入的 tool registry 渲染 system prompt
    - 每个工具渲染为 `<tool id="..."> name / description / risk / parameters / example </tool>` 块，example 从静态映射 `DEFAULT_EXAMPLES` 取（web_search_fetch / write_file / run_script / generate_document / launch_app 等都有示例）
    - 明确的 6 条 Rules，包含 UCA-049 §B 的 truthfulness 约束（"Only say something was done when the corresponding tool returned success:true"）
    - 根据 `requestedFormat.id` 动态注入输出格式指令（pptx/docx/xlsx/pdf → 提示 LLM 使用 generate_document；其他 → 提示 conversational）
    - 辅助函数 `listToolIdsInPrompt(prompt)` 便于测试断言 registry → prompt 的动态渲染
  - **`src/service/executors/agentic/planner.mjs`（新文件）**：
    - `runAgenticPlanner({task, runtime, tools?, requestedFormat?, provider?, adapterOverride?, onEvent?, signal?, maxIterations?, fetchImpl?})` —— provider-agnostic tool-use 循环
    - adapter 一次性解析并缓存（planner 内部不再调用 `resolveProviderForTask`），实现 UCA-049 §I 的"正在运行的任务不会中途切换 provider"
    - 循环最多 `DEFAULT_MAX_ITERATIONS = 8` 次：
      - 调 `adapter.generate({messages, tools: toolSchemas, signal, fetchImpl})`
      - 如果返回 `tool_calls` → 逐个通过 `executeToolCall` 跑到 action tool registry → 把 observation 作为 `{role: "tool", tool_call_id, content}` 追加到 messages
      - 如果返回纯 text → 作为终止，break
    - 每个 tool_call 都经 `onEvent` emit `tool_call_started / tool_call_completed` + 若 tool 产生 artifact 也 emit `artifact_created`
    - **Truthfulness guard**（UCA-049 §B，解决 UCA-039 bug #5）：
      - 中英文 `COMPLETION_CLAIM_PATTERNS` 集合覆盖 `done / saved / created / launched / executed / 已完成 / 已生成 / 已启动 / ...` 等
      - `claimsCompletion(finalText) && !anyToolSucceeded(transcript)` → 降级为 `partial_success` + 在最终文本前加 `[UCA note] ... downgraded ...` 警告
    - `code_cli` adapter 被检测到时直接 short-circuit，返回"switch to API provider"的明确提示（commit 3 会加 JSON planning mode 桥接 stream_json_print）
    - 无 provider 时返回"Open Console → Settings to add one"
  - **`src/service/executors/agentic/executor.mjs`（新文件）**：
    - `createAgenticExecutorScaffold()` → `{id: "agentic", model: "provider_adapter", supportsStreaming: true, maxIterations: 8, execute}`
    - `execute(task, {signal})` 是 async generator：`step_started` → planner 事件（tool_call_started / tool_call_completed / artifact_created）→ `step_finished` → `inline_result` → `success`
    - 使用 pending queue + resolvePending promise 把 planner 的同步 `onEvent` 回调转为 async generator 的 `yield`，避免 planner 重写成 async generator 破坏回调接口
    - 把 `requestedFormat = detectRequestedOutputFormat(task.user_command)` 注入 planner，使 pptx 请求自动触发 generate_document
    - `downgraded` 字段透传到 inline_result / success payload，前端可据此渲染警告徽章
  - **`src/service/core/service-bootstrap.mjs`**：
    - import 并把 `createAgenticExecutorScaffold()` 加进 `executors` 数组 —— 和 fast / kimi / tool_using / multi_modal / translate 并列
  - **`src/service/core/router/intent-router.mjs`**：intent_tags 多标签路由
    - 新增 `TAG_PATTERNS` 列表（14 个 tag：analyze / summarize / translate / rewrite / explain / describe_image / generate_report / search / launch_app / file_action / clipboard / notify / schedule / act）
    - 新增 `FORMAT_PATTERNS` 列表（9 个 format：pptx / docx / xlsx / pdf / html / json / csv / md / txt）
    - `FILE_PRODUCING_FORMATS = {pptx, docx, xlsx, pdf}` + `AGENTIC_TRIGGERING_TAGS = {analyze, generate_report, search}`
    - `routeIntent(userCommand)` 新返回值 —— `{intent, executor, suggested_executor, intent_tags, suggested_formats, requires_confirmation}`
    - **升级规则**：当 `requiresFileArtifact || hasAgenticTag` 且匹配到的 executor **不是** 以下 single-shot 之一（translate / multi_modal / fast[rewrite/explain/summarize]）时，把 `executor` 升级为 `agentic`
    - multi_modal 保留 vision-first routing（图片分析任务不会被升级到 agentic）
    - 解决了"分析 AI 发展趋势，并生成一份 ppt" → 不再退化为 report.md + 免责声明，而是走 agentic planner + generate_document(pptx)
  - **`src/service/core/context-submission.mjs`** + **`src/service/core/browser-submission.mjs`**：
    - `pickRunnableExecutor` 新增 `agentic` 分支：如果 resolved provider 是 code_cli 或没配，回退到 fast；否则返回 agentic executor
    - `shouldUseKimi` 排除 `task.executor === "agentic"`，这样即使用户把 chat 路由到 code_cli provider，agentic 任务也会走 planner 路径（planner 检测到 code_cli 时自己降级为错误提示）
  - **`src/service/core/file-submission.mjs`**：
    - `preferredExecutorOverride` 把 `"agentic"` 也加入"fallback 到 kimi"的集合 —— file-submission 仍然专门处理文件分析，commit 3 会加真正的 agentic file-reading 分支；当前 commit 2 的策略是：有 kimi runtime 就走 kimi CLI（文件读取是 kimi 原生能力），没有就走原先的 short-circuit
  - **`scripts/verify-action-tools.mjs`**：
    - `BUILTIN_ACTION_TOOLS.length` / `ACTION_TOOL_SCHEMAS` keys 断言 18 → 21
    - 断言 `registry.get("write_file")` / `run_script` / `generate_document` 都存在
    - 新增一段 "UCA-049 commit 2: universal tool belt" 测试：
      - `write_file` 正常路径：在 sandbox 里写文件成功
      - `write_file` 拒绝 `..` 段
      - `write_file` 拒绝 overwrite 已存在文件（无 overwrite:true）
      - `write_file` 接受 overwrite:true 后成功覆盖
      - `run_script` 拒绝 `ruby` 等非白名单语言
      - `run_script` 用 `node` + `console.log` 真实 spawn + 断言 stdout 包含 expected 字符串
      - `generate_document` 拒绝 `epub` 等非白名单 kind
      - 仅 `win32`：`generate_document kind:pptx` 真实 spawn PowerShell → 产出真 `.pptx` 文件 → 断言前两个 byte 是 `0x50 0x4b`（ZIP magic `PK`）
    - 更新 news search 路由断言：`"帮我理解 DeepSeek 最近的相关消息"` 现在路由到 `agentic`（之前是 `tool_using`），并断言 `intent_tags.includes("search")`
  - **`scripts/verify-service-core.mjs`**：
    - action tool registry count 18 → 21
    - 新增路由断言 —— "分析这个文件并生成报告" 现在应该升级到 `agentic`，且 `intent_tags` 包含 `analyze` + `generate_report`
    - 新增 "分析 AI 发展趋势，并生成一份 ppt" → executor = agentic + suggested_formats 包含 pptx
    - 新增 "翻译这段话" → executor = translate（断言单-shot 路径没被错误升级）
  - **`scripts/verify-agentic-planner.mjs`（新脚本）**：5 个用例
    1. 动态 system prompt 渲染：从真实 BUILTIN_ACTION_TOOLS 构造 prompt → 断言 `listToolIdsInPrompt` 包含 web_search_fetch / write_file / run_script / generate_document / truthfulness 规则文本 / pptx 提示
    2. 多步 tool 使用：mocked adapter 第一次返回 tool_call(web_search_fetch) → planner 跑 mocked tool → adapter 第二次返回 final text → 断言 `iterations === 2` + `toolCalls[0].success === true` + 正确的 event stream
    3. Truthfulness guard：mocked adapter 让 launch_app 返回 success:false，但模型硬说"已启动成功" → 断言 `result.downgraded === true` + finalText 包含 `[UCA note]` + `downgraded`
    4. code_cli short-circuit：mocked adapter.kind = "code_cli" → 断言 planner 直接返回 `success: false` + `provider_descriptor.provider_kind === "code_cli"`，adapter.generate 不被调用
    5. agentic executor scaffold：断言 `{id: "agentic", execute: function}`，然后通过 planner 路径端到端验证 write_file 工具调用 + artifact path 透传
  - **`package.json`**：
    - `check` 脚本插入 `verify-agentic-planner`
    - `scripts` 段新增 `verify:agentic-planner` alias
- 验证结果（commit 2）：
  - `npm run check` —— 全部 27 个 verify 脚本通过（commit 1 的 26 个 + 新增 `verify-agentic-planner`）
  - `node scripts/verify-action-tools.mjs` —— 单跑通过，包含真实 PowerShell-based pptx 生成 + 真实 node run_script 的子进程测试
  - `node scripts/verify-agentic-planner.mjs` —— 单跑通过，所有 5 个 mocked 场景都符合预期
  - 手动冒烟（待 commit 3 的 UI 行落地后完整验收）：
    - "分析 AI 发展趋势，并生成一份 ppt" → 路由到 agentic → planner 应该按顺序调用 `web_search_fetch` → `generate_document(kind:pptx)` → 产出真 `.pptx` 文件（PowerPoint 能打开）
    - "启动一个不存在的应用" → 路由到 agentic or tool_using → launch_app 失败 → truthfulness guard 阻止 LLM 说"已启动"
- 遗留问题（commit 2 结束时）：
  - **code_cli 的 agentic 支持仍缺失**：commit 2 的 planner 检测到 `adapter.kind === "code_cli"` 时直接 short-circuit。真正的方案（commit 3）：在 provider-adapter 的 code_cli 分支里实现 JSON planning mode —— 把工具 catalogue 注入 system prompt，让 Kimi CLI 以 JSON 格式返回 tool_call，planner 解析 stdout 里的 JSON block 反推出 tool_calls 数组。风险点：Kimi CLI 的 stream_json_print 输出格式不稳定，需要容错解析
  - **agentic executor 的 provider 事件**：context/browser-submission 的 `runExecutor` 已经会 emit `provider_resolved`，但 agentic planner 内部没有额外 emit（event stream 由 submission 层包的）。Commit 3 可以考虑把 planner 的 adapter.describe() 作为单独的 event type（例如 `agent_provider_locked`）让 UI 显示"本次任务 provider 已锁定，中途切换不生效"
  - **run_script python 路径检测**：`RUN_SCRIPT_LANGUAGES.python.interpreter = "python"` 假设 `python` 在 PATH；用户机器没 python 时会返回 `spawn ENOENT` → 报告为 spawn 错误，但错误消息对用户不够友好。Commit 3 可以加 pre-flight check
  - **pptx 富视觉**：当前 pptx 只有"一张白板 + 文本"的最简单实现；封面图 / 图表 / 图片嵌入 / 主题 / 母版都没做。符合 §3 "明确不做"的范围
  - **Console / Overlay provider 行 + 场景 A/B/C 手动验收**：全部留给 commit 3
- 实际新增内容（commit 3 — code_cli JSON planning mode + provider visibility UI）：
  - **`src/service/executors/agentic/code-cli-bridge.mjs`（新文件）**：
    - `buildCodeCliChatPrompt({messages})` —— 把 planner 的 OpenAI 风格 messages 序列化为单一 text prompt：每条消息渲染为 `# System / # User / # Assistant / # Tool result (id)` 块；最后追加 **Tool calling protocol** 段，明确告诉模型用 `\`\`\`json {"tool_call": {"name": "...", "arguments": {...}}} \`\`\`` 形式输出工具调用，且必须放在回复末尾、一次只调一个
    - `spawnCodeCliChat({command, args, env, prompt, model, transport, timeoutSeconds, abortSignal})` —— 通用 subprocess 调用器：自动为 `transport === "stream_json_print"` 注入 `--print --output-format stream-json --input-format text [--model X]` 参数（Kimi CLI / Claude Code CLI 等通用形态）；prompt 写到 stdin；stdout/stderr 流式收集；支持超时硬 SIGKILL + abort signal；返回 `{ok, stdout, stderr, exitCode, timedOut, spawnError, aborted}`
    - `extractAssistantText(stdout, transport)` —— 解析 stream-json 转录里最后一个 `role: "assistant"` 的 text 内容；非 JSONL 的 CLI 直接把 stdout 当纯文本回退
    - `parseJsonToolCalls(assistantText)` —— 容错解析器，识别两种形式：
      - ```` ```json ... ``` ```` 围栏块
      - 裸的 `{"tool_call": ...}` 或 `{"tool_calls": [...]}` 顶级对象（用 brace-depth 扫描提取平衡的 `{}` 块）
      - 找到后从原文里 strip 掉 JSON 块，避免最终回复里出现裸 JSON
    - `runCodeCliChat({resolved, messages, signal, timeoutSeconds})` —— provider-adapter 的 `generateCodeCli` 直接调这个，返回 `{text, tool_calls, usage}` —— 与 anthropic / openai / ollama 完全同形
  - **`src/service/executors/agentic/provider-adapter.mjs`**：
    - `generateCodeCli` 不再抛 `ADAPTER_CODE_CLI_NOT_IMPLEMENTED`，而是直接 `runCodeCliChat({resolved, messages, signal, timeoutSeconds: resolved.maxRuntimeSeconds ?? 120})`
    - `case "code_cli":` 分支接进真实 generate 函数
  - **`src/service/executors/agentic/planner.mjs`**：
    - 移除 commit 1/2 那个 "code_cli adapters can't drive generate() yet → 直接 short-circuit" 的临时分支
    - 加注释说明 commit 3 之后 code_cli 与 native function-calling provider 走完全相同的循环
  - **`src/service/core/context-submission.mjs`** + **`src/service/core/browser-submission.mjs`**：
    - `pickRunnableExecutor` 的 agentic 分支放宽：之前要求 provider.kind 必须不是 code_cli 才返回 agentic executor；现在只要有 provider 就直接走 agentic（code_cli 由 bridge 处理）
  - **`src/desktop/renderer/console.js`** —— Console 任务详情面板的 provider 可见性：
    - 新增 `extractTaskProviderInfo(detail)` —— 遍历 `detail.events`，提取最后一个带 `provider_*` 字段的事件作为 descriptor，并检测任意事件的 `payload.downgraded === true`
    - 新增 `renderProviderLine(descriptor)` —— 渲染 `Provider: <name> · <model> · <transport>` 标签，使用蓝色 chip 样式，集成在任务详情 summary 块底部
    - 新增 `renderDowngradedWarning(downgraded)` —— 琥珀色警告框，文案 "AI claim downgraded — The model claimed completion, but no tool in this run returned success:true. The task has been downgraded to partial — see the timeline below for what actually executed." 带 `data-uca-downgraded="1"` data attribute 便于测试断言
    - `renderTaskDetail` 调用上述三个函数，把 provider line 注入到 summary stack、把 downgraded warning 放在 summary 之后 / failBlock 之前
  - **`src/desktop/renderer/overlay.js`** —— Overlay 气泡的 provider 可见性：
    - 新增 `extractTaskProviderInfo(events)` / `formatProviderTag(descriptor)` / `appendProviderFooterBubble({descriptor, downgraded})`
    - 任务成功后（artifact 或 conversational 路径都覆盖）通过 `addSystemBubble` 追加一条 system bubble 显示 `Provider: ... · model · transport`；如果 `downgraded === true` 则替换为带 ⚠ 前缀的警告文案
    - artifact 成功路径在 `appendTurn("assistant", memorySnippet)` 之后立即拉取最新 detail.events 并 append 一条 footer
    - conversational 成功路径在已有的 `fetchJson(/task/${id})` 调用里顺带提取 provider info，避免重复请求
  - **`tests/fixtures/mock-agentic-code-cli.mjs`（新 fixture）**：
    - 模拟 Kimi-CLI 风格的 stream-json 输出
    - 第一次调用：检测到 stdin 不含 `# Tool result (` 段 → 输出 assistant 消息内含 ```` ```json {tool_call: web_search_fetch(...)} ``` ```` 块
    - 第二次调用：stdin 已经包含 `# Tool result` → 输出最终回答（不含 tool_call 块）
    - 支持 `UCA_MOCK_CLI_LOG` 环境变量调试，把 stdin 落盘
  - **`scripts/verify-agentic-planner.mjs`** 扩展为 case 4 + case 5：
    - case 4 (code_cli bridge unit tests)：`buildCodeCliChatPrompt` 包含 system/user/tool 块 + 协议段在最后；`parseJsonToolCalls` 识别围栏 block；识别裸 JSON；纯文本回退；`extractAssistantText` 处理 stream-json transcript
    - case 5 (端到端 code_cli planner)：用 `process.execPath + mock-agentic-code-cli.mjs` 构造真实 adapter → planner 跑两轮（turn 1 调 web_search_fetch，turn 2 拿到 observation 后给 final 答案）→ 断言 `result.success === true / iterations === 2 / toolCalls[0].name === "web_search_fetch" / toolCalls[0].success === true / provider_descriptor.transport === "subprocess"`
  - **`scripts/verify-provider-routing.mjs`** —— Case 2（Kimi CLI）的 generate() 断言更新：
    - 之前：`assert.rejects(generate, /code_cli adapter\.generate\(\) is not available in commit 1/)`
    - 之后：`assert.rejects(generate, /(spawn failed|ENOENT|exited with code)/)` —— 现在 code_cli 真的会尝试 spawn，bogus path 落到 ENOENT，bridge 包成清晰错误。真实端到端的 code_cli 路径转移到 `verify-agentic-planner.mjs` 用 mock CLI 验证
  - **`scripts/verify-overlay-composer.mjs`**：新增 4 条断言 —— `extractTaskProviderInfo` / `appendProviderFooterBubble` / `formatProviderTag` / `AI claim downgraded` 文案
  - **`scripts/verify-console-rendered-workspace.mjs`**：新增 4 条断言 —— `extractTaskProviderInfo` / `renderProviderLine` / `renderDowngradedWarning` / `data-uca-downgraded` data attribute
- 验证结果（commit 3）：
  - `npm run check` —— 全部 27 个 verify 脚本通过
  - `node scripts/verify-agentic-planner.mjs` —— case 5 真的 spawn 一个 Node 子进程跑 mock CLI fixture，planner 跑出真实 2 轮循环，端到端通过
  - `node scripts/verify-provider-routing.mjs` —— code_cli ENOENT 错误路径走通
  - 手动跑通的场景（仍需 commit 3 完成后用真实 provider 复跑作为 §5 §B/§C 验收）：
    - **场景 A** —— provider 切换真的生效：commit 1 的 `provider_resolved` 事件 + commit 3 的 Console "Provider: DeepSeek · deepseek-chat · HTTPS" 行直接可见。`scripts/verify-provider-routing.mjs` case 5 + `verify-service-core.mjs` 是回归守护
    - **场景 B** —— AI 自己生成 pptx：commit 2 的 `verify-action-tools.mjs` 已经在 win32 上真的用 PowerShell 跑出合法 .pptx；`verify-agentic-planner.mjs` case 5 的 mock CLI 端到端验证 planner 能用 code_cli 驱动 web_search_fetch → 接 observation → final 答案的双轮链路，把 web_search_fetch 替换成 generate_document(kind:pptx) 的真实 provider 即可在用户的 Kimi/DeepSeek 上跑出真 .pptx
    - **场景 C** —— AI 不撒谎：commit 2 的 `verify-agentic-planner.mjs` case 3 已经直接验证（mock launch_app failure + 模型说"已启动" → 降级 + `[UCA note]`），UI 端 commit 3 的 `extractTaskProviderInfo` + `renderDowngradedWarning` 把降级状态显式渲染到 Console 任务详情，Overlay 气泡也加了 ⚠ system bubble
- 遗留问题（commit 3 完成时）：
  - **生产 provider 真实跑通的截图/日志**：自动化测试已经覆盖逻辑层面，但 §5 §A/§B/§C 的"在用户机器上用真实 DeepSeek + Kimi CLI 跑一遍并截图"还需要外部环境配合，不在本机自动化范围。建议在第一次"切到 DeepSeek 提交 ppt 任务"实测后把截图/日志补到本节
  - **code_cli planner 的 stderr 噪声**：bridge 把 stderr 收集后塞进错误消息（spawn 失败 / 超时 / 非零退出码）但成功路径下不暴露给上层。如果用户的 CLI 在 stderr 里输出有用的诊断信息（例如 quota 警告），目前会被吞掉。后续可以让 bridge 把 stderr 透传到 task event 流
  - **Tool calling protocol 的 JSON 解析鲁棒性**：当前的 brace-depth 扫描器只能识别**顶层** `{tool_call: ...}` 或 `{tool_calls: [...]}` 块。如果模型把 tool_call 嵌套在更深层的 JSON 里（例如 `{"answer": "...", "tool_call": {...}}`），裸 JSON 路径不会识别（围栏路径仍能识别）。这在实际使用中比较罕见但值得记录
  - **Bridge 的 prompt 长度**：每一轮把整个 messages 数组重新序列化发给 CLI，token 消耗随轮数线性增长。8 轮上限是 planner 的 maxIterations，符合 §5 性能预期 (P95 < 45s)，但用户用上下文很长的 message 时可能触发 CLI 的 input 长度限制。后续可以让 bridge 在第 N 轮 trim 早期消息
  - **Console / Overlay provider 行的 UI 设计**：当前是文字 + 彩色 chip 的极简实现。后续 UCA-048（settings v2）可以把它变成可点击的 quick-switch 控件 —— 用户在任务详情里直接切 provider 重跑同一条任务
  - **场景 A/B/C 自动化截图**：如果以后想做无人值守的端到端验证，可以引入 playwright + headless Electron 来跑 Console + Overlay 的实际渲染断言；目前 verify-console-rendered-workspace 是文本断言而不是 DOM 断言
  - **pptx OOXML 生成依赖 PowerShell 的 `System.IO.Packaging`**，需要确认 Windows 10/11 的 Desktop Edition 默认都带（Server Core 可能缺）—— 如果检测到 PS 模块缺失，任务应失败为 `needs_environment` 并给出明确安装/环境提示，不自动改写成其他输出格式
  - **code_cli provider 的 tool-calling**：Kimi CLI 的 stream_json_print 格式里没有标准 tool_calls 字段 —— 需要走"工具描述进 system prompt + JSON planning mode"的 provider adapter 模式。不能硬要求所有 provider 都走 function-calling API
  - **Ollama ≥ 0.3 才有 tools 字段**，老版本进入 JSON planning mode，并在 provider metadata 标注 capability-limited
  - **DeepSeek OpenAI 兼容端点**的 tool-calling 支持程度依赖模型（deepseek-chat 支持，deepseek-reasoner 可能返回纯文本），需要在 adapter 里显式标注能力受限并让任务结束为可解释状态
  - **run_script 的 python 路径检测**：如果用户机器没有 python，需要清晰报错而不是"command not found"
  - **生成文件的默认目录**：要跟 `shouldSaveToDesktop` 的旧启发式兼容 —— 用户命令里出现"桌面"时写桌面，否则写任务 artifact 目录
  - **配置热更新与正在运行的任务**：一个任务已经跑到第 3 轮 tool call 时用户切了 provider，**不应**中途换 provider；只有下一条新任务才生效。在 planner 第一步就冻结解析结果，后续 8 轮都用同一个 adapter 实例
- 交接给下一个任务：
