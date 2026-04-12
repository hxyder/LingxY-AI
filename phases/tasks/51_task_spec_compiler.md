# UCA-051 — TaskSpec 编译层（单一信息源）

**Status**: done  
**Priority**: P1  
**Depends on**: UCA-049, UCA-050  
**Branch**: `task/uca-051-task-spec`

## 目标

建立 TaskSpec 作为 Single Source of Truth：用户输入 → TaskSpec（结构化需求）→ ExecutionPlan（执行步骤）。消除 intent-router / decomposer / executor 各层独立做决策、相互矛盾的根本问题。

## TaskSpec 核心字段

```json
{
  "goal": "qa|search_and_answer|analyze_and_report|generate_document|open_or_reveal_file|transform_existing_file|launch_and_act|schedule_or_notify|translate|multimodal_analyze",
  "user_goal_text": "原始用户输入",
  "topic": "推断出的主题",
  "needs_current_web_data": true,
  "artifact": {
    "required": false,
    "kind": "pptx|docx|xlsx|pdf|html|csv|md|txt",
    "quality": "draft|formal"
  },
  "source": {
    "files": [],
    "urls": [],
    "selection_text": "",
    "clipboard": ""
  },
  "constraints": {
    "language": "zh-CN",
    "can_split": true,
    "must_use_tools": false,
    "must_verify_artifact": false
  },
  "required_steps": [],
  "success_contract": {
    "artifact_created": false,
    "artifact_registered": false,
    "tool_called": false
  }
}
```

## Hardened Rules（强制执行，不可被 AI 覆盖）

| 条件 | 规则 |
|---|---|
| `needs_current_web_data = true` | 第一步必须调用 `web_search_fetch` |
| `artifact.required = true` | 成功定义为 artifact 文件存在 + 已注册到 manifest |
| `goal = open_or_reveal_file` | 必须先 resolve path → verify_file_exists → open_file |
| `goal = generate_document` | 必须调 `generate_document` 工具，不能仅输出文本 |
| `goal = launch_and_act` | 必须调 `launch_app` 工具，不能仅输出"已启动"文本 |

## 关键修改文件

### 新建 `src/service/core/task-spec.mjs`
- TaskSpec 类型定义（JSDoc）
- `createTaskSpec(userText, contextPacket)` — 基于 LLM 或规则生成 TaskSpec
- `validateTaskSpec(spec)` — schema 验证，返回 `{valid, errors}`
- `applyHardenedRules(spec)` — 应用强制规则，补全 required_steps

### 修改 `src/service/core/router/intent-router.mjs`
- `routeIntent()` 改为输出 TaskSpec（而不仅仅是 executor 字符串）
- 内部调用 `createTaskSpec()` 再决定 executor

### 修改 `src/service/core/task-runtime.mjs`
- 接受 TaskSpec，调用 `applyHardenedRules()` 生成 ExecutionPlan
- ExecutionPlan 决定 executor 选择，而不是 intent-router 直接决定

## 验证

- 新建 `scripts/verify-task-spec.mjs`，覆盖：
  - `qa` goal：无 artifact，无 tool 要求
  - `search_and_answer`：required_steps 包含 `web_search_fetch`
  - `generate_document(pptx)`：artifact.required=true，executor=agentic
  - `open_or_reveal_file`：required_steps 包含 resolve → verify → open
  - `translate`：executor=translate，无 artifact
