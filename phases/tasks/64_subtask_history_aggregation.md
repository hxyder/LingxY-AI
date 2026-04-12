# UCA-064 — 子任务历史聚合 + 导航修复

**Status**: todo  
**Priority**: P1  
**Depends on**: UCA-041, UCA-056  
**Branch**: `task/uca-064-subtask-history`

## 目标

1. 历史会话中 composite 任务的子任务不再消失，可以查看完整执行内容
2. 任务详情页增加"返回"按钮，支持从子任务详情导航回父任务
3. 对话框里的 composite 任务结果聚合展示

## 问题根因

实测：点击历史会话 → 拆分的子任务消失，只返回一条父任务记录（"Done."）。

根因：
- `buildHistoryRecord()` 只为 parent task 生成一条嵌入记录，子任务内容没有写入
- Console 任务列表只展示 parent task，children 只在父任务的 `child_task_ids` 里有 ID 引用
- 任务详情页没有 back 导航（点击子任务后无路返回）

## 关键修改

### `src/service/core/task-runtime.mjs`

#### `buildHistoryRecord()` — composite 任务聚合

```js
function buildHistoryRecord(task, runtime) {
  // 对于 composite 任务，把子任务结果一并写入
  let fullText = [task.user_command, task.intent].filter(Boolean).join("\n");

  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0) {
    const children = task.child_task_ids
      .map(id => runtime?.store?.getTask(id))
      .filter(Boolean);
    const childSummaries = children.map((child, i) =>
      `[子任务 ${i+1}] ${child.user_command ?? child.intent}: ${child.failure_user_message ?? "(已完成)"}`
    ).join("\n");
    fullText += "\n" + childSummaries;
  }

  // ... 其余保持不变
}
```

#### `markTaskSucceeded()` — composite 父任务收口时聚合结果

```js
export function markTaskSucceeded(runtime, task) {
  // 若是 composite 任务，把子任务结果汇总写入 task.result_summary
  if (Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0) {
    const children = task.child_task_ids
      .map(id => runtime.store.getTask(id))
      .filter(Boolean);
    task.result_summary = children
      .map((c, i) => `${i+1}. ${c.user_command}: ${c.status}`)
      .join("\n");
  }
  // ... 其余保持不变
}
```

### `src/desktop/renderer/console.js`

#### 任务列表 — composite 任务展开显示子任务

```js
function renderTaskItem(task) {
  const hasChildren = Array.isArray(task.child_task_ids) && task.child_task_ids.length > 0;
  // 在任务行增加展开按钮
  // 展开后显示子任务列表，每项可以点击进入详情
}
```

#### 任务详情页 — 返回按钮

```js
function renderTaskDetail(task) {
  // 若 task 有 parent_task_id，显示 "← 返回父任务" 按钮
  if (task.parent_task_id) {
    const backBtn = document.createElement("button");
    backBtn.textContent = "← 返回";
    backBtn.onclick = () => renderTaskDetail(store.getTask(task.parent_task_id));
    detailHeader.prepend(backBtn);
  }
  // ... 其余详情渲染
}
```

### `src/desktop/renderer/overlay.js`

#### 对话框 composite 结果展示

当收到 composite 任务的最终状态时，聚合展示子任务结果：

```js
// 而不是只显示 "Done."
function renderCompositeResult(parentTask, children) {
  const successCount = children.filter(c => c.status === "success").length;
  const failCount = children.filter(c => c.status === "failed").length;

  let summary = `已完成 ${successCount}/${children.length} 个任务`;
  if (failCount > 0) summary += `，${failCount} 个失败`;

  // 列出每个子任务的简短结果
  const details = children.map((c, i) =>
    `${i+1}. ${c.user_command}: ${c.status === "success" ? "✓" : "✗"}`
  ).join("\n");

  return `${summary}\n${details}`;
}
```

## 验证

- Composite 任务完成后 → 历史里显示父任务 + 所有子任务内容
- 点击子任务详情 → 显示"← 返回"按钮
- 点击返回 → 回到父任务详情
- Overlay 里 composite 结果显示"已完成 2/3 个任务"而不是"Done."
- 历史搜索 → 可以找到子任务的内容（通过 embedding 聚合文本）
