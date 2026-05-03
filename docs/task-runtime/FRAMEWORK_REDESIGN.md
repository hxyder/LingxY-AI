# LingxY 任务框架整合设计（v2）

**Status**: 设计草案。取代早期内部任务清单里的 P0-0 TaskPlan 单点设计。保留当前已落地代码的投资，把规划器 / DAG / 并发 / 重规划 / MCP-Skill 分层 / 快慢通道 / 流式全部整合到一张图里。

本文档是**下一阶段开工前的架构对齐**。不先写代码，先把层次、接口、数据流定清楚，落地时每一步都能落到具体位置。

---

## 1. 设计原则

从前几轮迭代吸取的教训（都写进代码了）：

1. **LLM 是决策者，regex 是探测器**。所有语义分类让 LLM 做。正则只用于确定性原子（URL / 文件名 / 时间解析），或安全兜底（检测 LLM 幻觉），不做意图分类。
2. **单一大脑优先（single-brain first）**。默认一次 LLM 调用 + 完整工具+资源上下文能解决 80% 请求——就让它解决。规划器是**复杂场景才触发**的升级通道，不是默认路径。
3. **存量投资最大化**。现有的 connector catalog / workflow dispatcher / action tools / plugin registry / plan-executor 都能复用。重新设计是**整合**不是重写。
4. **渐进可退化**。每一层都有 fallback：规划器失败 → 单轮 agent；DAG 执行失败 → fail-open 到 single-turn；流式失败 → 等整段再 parse。
5. **可观测**。所有决策都写 timeline（已有 SSE），可复盘"为什么选了这条路"。

---

## 2. 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│ 用户输入（text / clipboard / image / file）                   │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 1 ── Triage（分流，0-LLM 或极轻模型）                  │
│                                                              │
│  1.a Fast path（纯代码）                                     │
│      open URL / launch app / copy clipboard / translate     │
│      ↳ 直接跳到 Layer 4                                      │
│                                                              │
│  1.b Schedule intercept（regex 只探测是否有时间短语）         │
│      有时间短语 → Layer 2b（理解 LLM 决定是 schedule 还是      │
│                          immediate，schedule 的直接建 schedule 返回） │
│                                                              │
│  1.c Complexity score（句式启发 + 可选 0.5B 本地小模型）     │
│      低复杂度 → Layer 2a（单轮 agent-loop）                  │
│      高复杂度 → Layer 2c（DAG planner）                      │
│      不确定   → Layer 2a，agent-loop 内部可升级（见 Replan）  │
└──────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼──────────────────┐
        ▼                 ▼                  ▼
┌──────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ 2a Single    │ │ 2b TaskPlan     │ │ 2c DAG Planner   │
│    Agent     │ │    (窄 LLM 调用)│ │    (流式输出)    │
│              │ │                 │ │                  │
│ ReAct 循环   │ │ schedule /      │ │ JSON Lines       │
│ 拿 tool_belt │ │ immediate /     │ │ 每个 line 是一   │
│ + 资源块 +    │ │ clarify /       │ │ 个节点：         │
│ workflow     │ │ rewritten       │ │ {id, kind, tool, │
│ guidance     │ │                 │ │  depends_on,     │
│              │ │ 命中 schedule   │ │  params}         │
│ 多数请求     │ │ 直接入 scheduler│ │                  │
│ 在这里解决   │ │ 不进 Layer 3    │ │ 输入 Layer 3     │
└──────────────┘ └─────────────────┘ └──────────────────┘
        │                                  │
        │                                  ▼
        │                      ┌───────────────────────────┐
        │                      │ Layer 3 ── DAG Engine     │
        │                      │                           │
        │                      │  - 流式接收 nodes         │
        │                      │  - Placeholder resolver   │
        │                      │    {{s1.result.foo}}      │
        │                      │  - Layer-wise Promise.all │
        │                      │  - Concurrency policy:    │
        │                      │     MCP → parallel_safe   │
        │                      │     Skill → serial_per_   │
        │                      │             session_key   │
        │                      │     Workflow → respects   │
        │                      │             pending appr. │
        │                      │  - Checkpoint + resume    │
        │                      │  - on_failure:            │
        │                      │     retry|skip|fail|      │
        │                      │     replan                │
        │                      │                           │
        │                      │  Replan Hook 失败回喂     │
        │                      │  规划器 → 新 plan         │
        │                      └───────────────────────────┘
        │                                  │
        │                                  ▼
┌────────────────────────────────────────────────────────────┐
│ Layer 4 ── Tool Invocation Surface（已有，复用）           │
│                                                            │
│  action_tool_registry    │ Gmail / Drive / Outlook ...     │
│  connector workflow      │ draft-confirm-send / ...        │
│  MCP catalog bridge      │ external MCP tools              │
│  skill runtime           │ stateful long-running skills    │
│  scheduler / at-trigger  │ deferred tasks                  │
└────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────┐
│ Layer 5 ── 结果聚合 + UI 流                                │
│   timeline events, pending approval cards,                │
│   inline_result, error recovery surfaces                  │
└────────────────────────────────────────────────────────────┘
```

---

## 3. 跟现有代码的映射

| 新概念 | 现有文件 / 状态 | 动作 |
|---|---|---|
| Layer 1 Fast path | [`core/router/fast-path-router.mjs`](src/service/core/router/fast-path-router.mjs) tier 0/1 | **保留原样**。已经在 agent-loop tier-0 用到 |
| Layer 1 Schedule intercept | [`core/intent/trigger.mjs`](src/service/core/intent/trigger.mjs) + [`plan-executor.mjs`](src/service/core/intent/plan-executor.mjs) + [`understand.mjs`](src/service/core/intent/understand.mjs) | **保留，职责收窄**。trigger 只做 hasTimePhrase，plan-executor 只处理 schedule/clarify，不扩 quantifier/reference |
| Layer 1 Complexity score | 缺失 | **新建 `intent/triage.mjs`**：启发规则 + 可选本地小模型 + 从 agent-loop 回流升级信号 |
| Layer 2a Single-turn agent | [`executors/tool_using/agent-loop.mjs`](src/service/executors/tool_using/agent-loop.mjs) | **现有，已在 UCA-086 做 single-brain 富化**。ReAct 循环 + resourceHint + workflowHint + guidance |
| Layer 2b TaskPlan | 同 Layer 1.b 的 plan-executor | **已有** |
| Layer 2c DAG Planner | [`core/router/decomposer.mjs`](src/service/core/router/decomposer.mjs) 输出 flat subtasks | **升级**：把 `runLlmDecomposition` 的输出 schema 改成 DAG `{nodes:[], edges:[]}`；prompt 改成要求 LLM 声明 `depends_on` 和 `params` 的 placeholder |
| Layer 2c 流式输出 | 缺失 | **新建 `dag/streaming-parser.mjs`**：JSON Lines tokenizer，一个完整闭合对象 → emit |
| Layer 3 DAG engine | [`dag/scheduler.mjs`](src/service/dag/scheduler.mjs) 骨架（串行 for，stub executeNode） | **升级为生产实现**：并发 `Promise.all` 每层、真实 `executeNode` 派发到 Layer 4 |
| Layer 3 Placeholder | 缺失（全仓 `{{` 零结果） | **新建 `dag/placeholder.mjs`**：deep-walk `{{nodeId.path}}` 替换，失败清晰报错 |
| Layer 3 Concurrency policy | 缺失 | **新建 `dag/concurrency-policy.mjs`** + 契约 schema 加 `concurrency` + `session_key` 字段 |
| Layer 3 Replan Hook | 缺失（agent-loop 内有 ReAct 重试，跨工具没有） | **新建 `dag/replan-hook.mjs`**：`on_failure: "replan"` 的 node 失败时回喂 LLM |
| Layer 4 Action tools | [`action_tools/*`](src/service/action_tools/) | **保留** |
| Layer 4 Workflow dispatcher | [`connectors/core/workflow-dispatcher.mjs`](src/service/connectors/core/workflow-dispatcher.mjs) | **保留** |
| Layer 4 MCP bridge | [`connectors/core/mcp-catalog-bridge.mjs`](src/service/connectors/core/mcp-catalog-bridge.mjs)（已写但未接入 service-bootstrap）| **需要接入**（P0-2 原来就在单子上） |
| Layer 4 Skill runtime | [`ai/skills/`](src/service/ai/skills/) 只有 builtin + registry，没有"跑一个 Skill"的 runtime | **新建 skill executor**：执行单个 Skill、管 session_key、返回结果 |
| Layer 5 Timeline UI | overlay.js + console.js 已接完 SSE | **保留**，新事件类型（`dag_node_started` 等）继续走同一通道 |

---

## 4. 关键接口（精确到 JSON 结构）

### 4.1 Triage 决策结果

```ts
type TriageResult =
  | { lane: "fast_path", tool: string, args: object, tier: 0 | 1 }
  | { lane: "schedule", schedule_id: string, replyText: string }
  | { lane: "clarify", question: string }
  | { lane: "single_turn" }          // 默认，走 agent-loop
  | { lane: "dag_planner" }          // 高复杂度，走 DAG
```

### 4.2 DAG Plan（LLM 输出 schema）

```json
{
  "summary": "查 3 个城市天气并生成对比 ppt",
  "nodes": [
    {
      "id": "weather_sh",
      "kind": "mcp_tool",
      "tool": "weather.current",
      "params": { "city": "上海" },
      "depends_on": [],
      "concurrency": "parallel_safe",
      "timeout_ms": 10000,
      "on_failure": "retry:2"
    },
    {
      "id": "weather_bj",
      "kind": "mcp_tool",
      "tool": "weather.current",
      "params": { "city": "北京" },
      "depends_on": [],
      "concurrency": "parallel_safe",
      "on_failure": "retry:2"
    },
    {
      "id": "compare",
      "kind": "agent_loop",
      "params": {
        "userCommand": "对比这三城天气，输出中文结构化对比",
        "inputs": {
          "shanghai": "{{weather_sh.result}}",
          "beijing":  "{{weather_bj.result}}",
          "chengdu":  "{{weather_cd.result}}"
        }
      },
      "depends_on": ["weather_sh", "weather_bj", "weather_cd"]
    },
    {
      "id": "ppt",
      "kind": "action_tool",
      "tool": "generate_document",
      "params": { "kind": "pptx", "content": "{{compare.result.text}}" },
      "depends_on": ["compare"],
      "on_failure": "replan"
    }
  ]
}
```

`kind` 决定 Layer 3 路由到哪个 executor：
- `mcp_tool` → MCP catalog bridge / action tool registry
- `workflow` → connector workflow dispatcher
- `skill` → skill runtime（尊重 `session_key`）
- `action_tool` → action tool registry
- `agent_loop` → 递归调用一个 single-turn agent（Layer 2a）作为子节点，适合需要 ReAct 的步骤

### 4.3 Placeholder 语法

形式：`{{<nodeId>.<dot path>}}` 或 `{{<nodeId>.result[<index>].<path>}}`

- 解析器在 executeNode 前 deep-walk node.params，发现字符串形如 `{{...}}` 就 lookup `results[nodeId]`
- 支持嵌套：字符串可以含多个 `{{}}`，字符串模板插值
- 失败模式：引用的 node 不在 results（尚未运行 / 已失败） → 抛 `PlaceholderUnresolved` 错误，Layer 3 按 `on_failure` 处理
- **不**支持 Turing-complete 表达式（没有 `{{ a + b }}`）；复杂变换放到 agent_loop kind 的节点里

### 4.4 Concurrency Policy

契约 schema（tool / workflow / skill manifest）统一加：

```json
{
  "concurrency": "parallel_safe" | "serial_per_session",
  "session_key_template": "{{task_id}}:{{tool_id}}",  // serial_per_session 才用
  "timeout_ms": 30000,
  "retry_policy": { "max": 2, "backoff_ms": 1000 }
}
```

Layer 3 调度器：
- 每层 topo 里按 `concurrency` 分组
- parallel_safe 一组用 `Promise.all` 全并发
- serial_per_session 按 `session_key` 分桶，同桶串行，跨桶并发

默认：MCP tool / action tool → `parallel_safe`；Skill → `serial_per_session`；Workflow → respects pending_approval（已有）。

### 4.5 Replan Hook

```ts
async function onNodeFailed(node, error, state) {
  if (node.on_failure === "replan") {
    const replanContext = {
      original_plan: state.plan,
      completed: state.results,      // 已完成 node 的 results
      failed_node: node.id,
      failure_excerpt: error.message.slice(0, 500),
      user_command: state.userCommand
    };
    const newPlan = await dagPlannerLLM.replan(replanContext);
    return { action: "replace_remaining", newPlan };
  }
  // retry / skip / fail 按声明处理
}
```

---

## 5. 分阶段落地

**每阶段都可以独立 ship 并带来净收益**。不强制按顺序——可以跳过某个阶段，只要这阶段还没 block 生产。

### Phase 0 —— 当前状态（已 ship）

- Single-brain agent-loop (UCA-086) ✓
- intent-router 不再误分类 (UCA-087) ✓
- plan-executor 处理 schedule/immediate/clarify ✓
- Connector catalog + workflows + plugin registry ✓

### Phase 1 —— Triage + DAG schema 骨架（约 1 周）

目标：**装好骨架但不负责执行**，单轮 agent 仍然是主路径。

- [ ] `intent/triage.mjs`：整合 fast-path-router（原 tier0/1）+ 现 plan-executor 为一个统一 Triage 函数，返回 `TriageResult`
- [ ] `context-submission` 入口先调 triage 再走后续分支
- [ ] `dag/schema.mjs`：定义 DAG JSON schema + validator + `kind` 枚举 + placeholder 语法规范
- [ ] `dag/placeholder.mjs`：`resolveParams(params, results)` 实现 + 错误类
- [ ] 测试：triage 分流决策、placeholder 解析、schema validation

**这阶段对用户体验无感，是基建**。

### Phase 2 —— DAG Planner + Execution（1-1.5 周）

目标：能真的跑一个多节点 DAG（串行先，把所有 piping 通了）。

- [ ] 升级 `router/decomposer.mjs` 输出 DAG 而非 flat subtasks（保留 flat 作为 fallback）
- [ ] `dag/scheduler.mjs` 的 `executeNode` 接入真实 tool / workflow / agent_loop 调用
- [ ] `composite-submission.mjs` 检测 DAG → 走 DAG engine；否则维持现 flat 行为
- [ ] 验证：查天气 + 生成 ppt 这类真实多步任务能端到端跑

### Phase 3 —— 并发 + Concurrency Policy（0.5-1 周）

目标：无依赖分支并发，提升复杂任务的真实速度。

- [ ] `dag/scheduler.mjs` 改为 layer-by-layer 拓扑，每层 `Promise.all`
- [ ] contract schema 加 `concurrency` + `session_key`，所有 connector tool 填 parallel_safe，skill 填 serial_per_session
- [ ] `dag/concurrency-policy.mjs`：按桶串行、跨桶并发
- [ ] 接通 `mcp-catalog-bridge`（P0-2）同时做，让外部 MCP 工具挂 parallel_safe

### Phase 4 —— Replan Hook（0.5 周）

- [ ] `dag/replan-hook.mjs`：on_failure="replan" 时回喂 planner
- [ ] planner prompt 支持 "replan" mode：输入含 failed_node + reason，输出替换剩余 plan 的子 plan

### Phase 5 —— 流式 interleaving（1 周，可选）

目标：把"Planner 吐完整 plan → 执行"的等待压缩成"吐第一个闭合 node 就启动"。

- [ ] `dag/streaming-parser.mjs`：JSON Lines tokenizer，增量 emit
- [ ] planner 输出改为 JSON Lines
- [ ] scheduler 接收流式 nodes，边接收边调度无依赖节点
- [ ] UI timeline 加"规划中..."bubble 展示流式过程

**这阶段是优化，不做不影响正确性**。

### Phase 6 —— Skill executor + session_key runtime（1 周）

- [ ] `src/service/ai/skills/executor.mjs`：执行单个 Skill、管理 session_key 绑定的状态
- [ ] session_store：`<userData>/skill-sessions/<session_key>/`
- [ ] 契约 schema 支持声明 Skill 要保留哪些文件到 session

---

## 6. 跟早期内部任务清单的对应

| 本文档的 Phase | 原 P0/P1 条目 | 覆盖 |
|---|---|---|
| Phase 1 | P0-0c（澄清 UI）+ 新 Triage 层 | 部分（Triage 收入 plan-executor / fast-path） |
| Phase 2 | P1-A + P1-B + P1-D | 完整 |
| Phase 3 | P1-C + P1-F | 完整 |
| Phase 4 | P1-E | 完整 |
| Phase 5 | P1-H | 完整 |
| Phase 6 | P1-I | 完整 |
| — | P0-1 Microsoft scope | 独立，跟本框架无关，先做 |
| — | P0-2 外部 MCP 接入 catalog | 独立，Phase 3 会用，可以并行 |
| — | P0-0d 撤 legacy regex | 独立，跟 Phase 1 Triage 一起做 |

---

## 7. 非目标（主动放弃）

不做这些——已经在过去迭代吃过亏：

- ❌ 任何"regex 在 LLM 之前做意图分类"的尝试
- ❌ 双 LLM pass（normalize → classify → plan → verify 五步走）——那是 Task Runtime 覆辙
- ❌ 用 DAG 重写简单单轮任务。单轮 agent 解决的场景不引入 DAG
- ❌ 手写 Turing-complete 表达式模板（`{{ a + b * 2 }}`）。需要复杂变换就加 agent_loop node
- ❌ 纯本地小模型做 Triage 的复杂度打分——先用启发，有数据再引本地小模型

---

## 8. 需要用户决定的点

1. **是否按这个分阶段走**？（Phase 0 已完，从 Phase 1 开始）
2. **Phase 2 的 DAG Planner 用什么样的 LLM**？当前 LLM 栈已有 Anthropic / OpenAI / DeepSeek / Ollama，推荐用 chat 通道（同 agent-loop）。
3. **DAG 执行在进程内还是独立 worker**？当前建议进程内 `Promise.all`，避免 IPC 复杂度。
4. **复杂任务的默认 fallback 策略**？推荐：DAG 执行任何节点 3 次连续失败（含 retry）→ 整个 plan 降级为"把原 userCommand 交给单轮 agent 重试一次"。

不回答这 4 个问题我不会开工。
