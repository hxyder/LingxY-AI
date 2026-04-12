# UCA-065 — 复合动作顺序执行（Sequential Compound Action）

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-058, UCA-063  
**Branch**: `task/uca-065-sequential-compound`

## 目标

"打开 Outlook + 写请假邮件" 类的复合动作，在同一个 task 内顺序执行多步工具调用，而不是拆成独立 subtask，也不是退化为文字说明。

**性能目标：整个流程 < 30 秒**（昨天实测可用时的水平）：
- `launch_app` 步骤：即时执行，不调 LLM（Tier 0）
- LLM 只调用 1 次，用于生成邮件/文档内容
- 路由判断：纯正则，不走 decomposer LLM

参考框架：LangGraph 的 sequential chain、AutoGen 的 task pipeline。

## 问题根因

当前只有两种模式：
1. **单工具**：执行一个 tool call 后返回
2. **decompose**：拆成多个独立 subtask 并行执行

缺少第三种模式：**sequential compound** — 同一用户意图的多步顺序动作，在一个 task 里依次执行，每步可以用上一步的结果。

"打开 Outlook 写邮件"的正确执行顺序：
```
step 1: launch_app("outlook")   → 等待成功
step 2: compose_email(...)       → 基于 step 1 成功
step 3: 回复用户"邮件已草拟"
```

这三步是有依赖关系的顺序步骤，不是三个独立任务。

## 关键修改

### `src/service/core/task-spec.mjs`

新增 `execution_mode: "sequential_compound"`：

```js
// TaskSpec 新增字段
{
  execution_mode: "sequential_compound",  // 新增
  sequential_steps: [                      // 有序步骤列表
    { tool: "launch_app", args: { app: "outlook" } },
    { tool: "compose_email", args: { to: "...", subject: "...", body: "..." } }
  ]
}
```

### `src/service/core/router/intent-router.mjs`

识别复合动作模式，生成 `sequential_steps`：

```js
function detectSequentialCompound(userCommand) {
  // 模式："打开X，然后做Y"
  const OPEN_THEN_DO = /(?:打开|启动)\s*([^\s，,。]+)[，,]\s*(帮我|写|发|做|查)(.+)/;
  const match = userCommand.match(OPEN_THEN_DO);
  if (!match) return null;

  const appName = match[1];
  const action = match[2] + match[3];
  const steps = [
    { tool: "launch_app", args: { app: appName } }
  ];

  // 根据后续动作识别第二步工具
  if (/邮件|email/i.test(action)) {
    steps.push({ tool: "compose_email", args: { body: action } });
  } else if (/文件|document/i.test(action)) {
    steps.push({ tool: "write_file", args: { content: action } });
  }

  return steps.length > 1 ? steps : null;
}
```

### 新建 `src/service/executors/sequential/executor.mjs`

```js
export async function runSequentialCompound({ task, steps, runtime }) {
  const results = [];

  for (const step of steps) {
    const tool = registry.get(step.tool);
    if (!tool) {
      return { status: "failed", error: `Unknown tool: ${step.tool}` };
    }

    // 前一步的结果可以注入到当前步骤的 args（占位符替换）
    const resolvedArgs = resolveArgPlaceholders(step.args, results);
    const result = await registry.call(step.tool, resolvedArgs, { runtime, task });

    results.push({ tool: step.tool, result });

    // 某步失败时停止并返回 partial_success
    if (!result.success) {
      return {
        status: "partial_success",
        completedSteps: results.length - 1,
        totalSteps: steps.length,
        failedStep: step.tool,
        final_text: `在"${TOOL_LABELS[step.tool]}"步骤失败，已完成 ${results.length-1}/${steps.length} 步`
      };
    }
  }

  return {
    status: "success",
    steps: results,
    final_text: `已完成全部 ${steps.length} 个步骤`
  };
}
```

### `src/service/core/service-bootstrap.mjs`

注册 `sequential_compound` executor。

## 执行示例

```
用户：打开 Outlook，帮我写一封请假邮件，我生病不舒服

TaskSpec:
  goal: launch_and_act
  execution_mode: sequential_compound
  sequential_steps:
    1. launch_app({ app: "Outlook" })
    2. compose_email({ subject: "请假申请", body: "因身体不适..." })

执行：
  ▸ 启动 Outlook… ✓
  ▸ 撰写邮件… ✓
  
AI：已在 Outlook 中草拟了请假邮件：
    主题：请假申请
    正文：您好，因身体不适，我需要请假一天...
```

## 验证

- "打开 Outlook，帮我写一封请假邮件" → `sequential_compound` 模式，2步顺序执行
- 第一步失败（Outlook 未安装）→ 立即返回 `partial_success`，提示在哪步失败
- 全部成功 → 对话框显示完整结果，不是"Done."
- 不创建子任务，历史里是一条记录
