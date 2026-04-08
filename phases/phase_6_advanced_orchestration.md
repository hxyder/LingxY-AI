# Phase 6 — 平台化与高级编排

> 周期估计：W31+（持续滚动） · 角色：1 后端 + 1 前端 + 1 PM
> 上一阶段：[Phase 5](phase_5_pdf_visual_fallback.md) · 下一阶段：—（产品进入持续演进期）

## 1. 目标

把 UCA 从"自带几个动作"变成"用户/团队可以自己组合动作的平台"。同时引入**成本配额**机制，让产品在长周期使用下不会因 Token 成本失控而劝退用户。

## 2. 范围

### 2.1 必做（核心平台能力）

| # | 模块 | 范围 |
|---|---|---|
| 1 | 用户自定义动作模板 | YAML/JSON 描述 + 注册机制 |
| 2 | 动作模板编辑器 | UI 可视化编辑 |
| 3 | 多执行器注册 | Claude / OpenAI / Kimi / Ollama 同时可用 |
| 4 | 执行器路由策略 | 按意图/成本/隐私级别选择 |
| 5 | 动作链编排 | 任务间依赖 (DAG) |
| 6 | 从结果派生任务 | 任务结果作为新任务输入 |
| 7 | 成本与配额管理 | Token 计费 / 月预算 / 超出预警 |
| 8 | 历史任务向量索引 | 用户能"找类似的旧任务" |
| 9 | 模板市场 (本地) | 社区可分享 yaml 模板 |
| 10 | 设置同步 | 多设备配置/凭据同步（可选） |

### 2.2 评估中
- 团队工作区
- 远程 Agent（云端常驻）
- 第三方插件 SDK
- 公式 / 手写 OCR
- macOS 移植

## 3. 架构

### 3.1 动作模板格式

```yaml
# templates/legal_contract_review.yaml
id: legal.contract.review
name: 合同条款风险审查
description: 读取合同 PDF，标记权利义务、违约条款、关键日期
version: 1.0
author: der

input:
  source_types: [file, file_group]
  file_mime_filter: ["application/pdf", ".docx"]
  required_fields: []

steps:
  - id: extract
    executor: pdf_text
    inputs: { file: ${context.file_paths[0]} }
    outputs: [text]

  - id: analyze
    executor: kimi_cli
    inputs:
      prompt_template: |
        你是法律顾问。审阅以下合同，输出 JSON：
        {
          "obligations": [...],
          "risks": [...],
          "key_dates": [...],
          "termination_clauses": [...]
        }
      text: ${steps.extract.outputs.text}
    outputs: [analysis_json]

  - id: report
    executor: fast
    inputs:
      prompt_template: |
        基于以下分析，写一份中文 markdown 报告：
        ${steps.analyze.outputs.analysis_json}
    outputs: [report_md]

output:
  primary: ${steps.report.outputs.report_md}
  format: markdown_report
  save_required: true

cost_estimate:
  tokens_in: 30000
  tokens_out: 5000

permissions:
  network: required
  file_write: required
```

### 3.2 Executor Registry 升级

```typescript
interface Executor {
  id: string;
  name: string;
  capabilities: { intents: Intent[], inputTypes: SourceType[] };
  cost: (task: Task) => CostEstimate;
  privacyLevel: "local_only" | "cloud_with_redaction" | "cloud_full";
  execute(task: Task): AsyncIterable<TaskEvent>;
  cancel(taskId: string): Promise<void>;
}

class ExecutorRegistry {
  register(e: Executor): void;
  pick(intent: Intent, constraints: {
    maxCost?: number;
    privacyLevel?: PrivacyLevel;
    preferredId?: string;
  }): Executor;
}
```

注册时声明能力 + 成本 + 隐私级别。Intent Router 在路由时根据用户偏好和当前预算选择。

### 3.3 动作链 DAG

```
TaskGraph:
  nodes:
    - id: A  executor: pdf_text  inputs: {file: ...}
    - id: B  executor: kimi_cli  inputs: {text: ${A.text}}
    - id: C  executor: fast      inputs: {summary: ${B.summary}}
  edges:
    - {from: A, to: B}
    - {from: B, to: C}
```

执行器：
- 节点级状态（pending/running/success/failed）
- 任意节点失败 → 子图标 blocked
- 重试可从失败节点开始
- UI 用图形化时间线显示

### 3.4 成本与配额

```jsonc
{
  "budget": {
    "monthly_usd_limit": 50,
    "per_task_usd_limit": 1.0,
    "warn_at_percent": 80,
    "hard_stop_at_percent": 100
  },
  "spent": {
    "this_month_usd": 32.4,
    "this_month_tokens_in": 4_200_000,
    "this_month_tokens_out": 850_000
  },
  "executor_pricing": {
    "claude-haiku":   { "in": 0.25, "out": 1.25 },
    "claude-sonnet":  { "in": 3.00, "out": 15.00 },
    "kimi-k2":        { "in": 1.00, "out": 5.00 },
    "ollama-local":   { "in": 0,    "out": 0 }
  }
}
```

每次任务开始前估算成本，超出 per_task 限制时弹出确认；月预算超出 hard_stop_at_percent 时拒绝新任务（用户可临时提额）。

### 3.5 历史向量索引

```
每个 task 完成后：
  1. 提取 user_command + intent + context_summary
  2. 用本地 embedding 模型 (BGE-small) 算向量
  3. 存到本地 vector store (sqlite-vss / chromadb-local)

用户在浮窗输入 "和上次一样" / "类似上次的报告" 时：
  → 取最近 10 条命令，向量相似度 > 0.85 的提示复用
```

## 4. 流程设计

### 4.1 动作模板 → 执行 流程

```
1. 用户在控制台选 "合同审查" 模板
2. 拖入 contract.pdf
3. service.parseTemplate(yaml) → TaskGraph
4. 为每个 step 创建子 task
5. DAG 调度执行
6. UI 显示节点时间线
7. 任意节点失败 → 显示具体节点 + 重试入口
8. 全部成功 → 拼装最终产物
```

### 4.2 成本预算流程

```
任务提交 → estimateCost(task)
  → if estimate > per_task_limit:
       → 弹出 "本任务预计 $1.30，超过单任务上限 $1.00"
       → 选项：[确认] [换便宜执行器] [取消]
  → if monthly_spent + estimate > monthly_limit:
       → 拒绝 / 临时提额
执行中 → 累计实际 token
执行后 → 更新 spent
月底 → 重置
```

### 4.3 派生任务流程

```
任务 A 完成产出 report.md
用户在产物界面点 "基于此继续"
  → 产生新 task B
  → B 的 ContextPacket 自动引用 A 的 artifact
  → B.parent_task_id = A.id
  → UI 显示父子链
```

## 5. 验收标准

### 5.1 功能验收
- [ ] 用户能加载/编辑/保存动作模板
- [ ] 模板编辑器有语法校验和即时预览
- [ ] 至少 5 个内置模板（合同审查/学术总结/数据汇报/邮件起草/竞品分析）
- [ ] 注册 ≥ 4 个执行器（Claude/Kimi/OpenAI/Ollama）
- [ ] 路由能按"成本最优"或"隐私最高"两种偏好运行
- [ ] DAG 执行可视化（≥ 3 节点链路 demo）
- [ ] 任意节点失败可单独重试
- [ ] 任务可派生子任务且 UI 显示父子关系
- [ ] 月度预算超 80% 时弹通知
- [ ] 月度预算耗尽时拒绝新任务并提示
- [ ] 历史命令向量搜索 top-5 相关
- [ ] 模板可导出/导入 yaml

### 5.2 性能验收
- [ ] 模板解析 ≤ 50ms
- [ ] DAG 调度延迟 ≤ 100ms
- [ ] 向量搜索（10k 任务）≤ 200ms

### 5.3 工程验收
- [ ] 模板 schema 单测 + 兼容性测试
- [ ] DAG 调度器单测：循环检测、依赖解析、失败传播
- [ ] 成本估算单测：每个执行器
- [ ] 模板示例集 + 文档

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 模板 yaml 表达力不足 | 用户写不出复杂动作 | 留 plugin 钩子，允许嵌入 JS 表达式（沙箱） |
| 第三方模板有恶意行为 | 安全 | 模板沙箱执行 + 明示其请求权限 |
| DAG 编排复杂度过高 | 用户用不会 | 提供可视化拖拽编辑器 |
| 多执行器路由策略错乱 | 用户感觉不可控 | 任务详情显示"为何选了这个执行器"的解释 |
| 成本估算不准 | 预算保护失效 | 估算保守 + 实际不准时事后补正 |
| 向量索引膨胀 | 磁盘占用 | 30 天滚动 + 用户可清空 |

## 7. 交付物清单

```
src/service/
  ├─ templates/
  │   ├─ schema.ts
  │   ├─ parser.ts
  │   ├─ runtime.ts
  │   └─ builtin/
  ├─ executors/
  │   ├─ registry.ts
  │   ├─ openai/
  │   └─ ollama/
  ├─ dag/
  │   ├─ scheduler.ts
  │   └─ visualizer.ts
  ├─ cost/
  │   ├─ estimator.ts
  │   ├─ budget.ts
  │   └─ pricing.json
  └─ embeddings/
      ├─ bge_local.ts
      └─ store.ts
src/console/
  ├─ template_editor/
  ├─ dag_view/
  ├─ budget_dashboard/
  └─ history_search/
docs:
  ├─ template_authoring_guide.md
  ├─ cost_management.md
  └─ phase_6_demo.mp4
```

## 8. 完成判定

Phase 6 没有传统意义的"结束"。建议每 2 个月做一次 review，决定下一批要进入的 backlog：
- AppSource 上架
- 远程 Agent
- 多人协作
- macOS 移植
- 第三方插件 SDK

如果某次 review 显示用户活跃度和留存稳定 + 成本可控 + 失败率 < 5%，可以宣布 UCA 进入"GA / 正式版"阶段。
