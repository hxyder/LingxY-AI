# UCA-056 — Decomposer 硬化 + State Machine Guards

**Status**: done  
**Priority**: P2  
**Depends on**: UCA-051, UCA-052  
**Branch**: `task/uca-056-decomposer-guards`

## 目标

1. decomposer 输出必须经过 schema 验证，malformed JSON 不再 silent 降级
2. task-runtime 状态转换必须有 guard，防止 failed subtask 误计为成功
3. 消除 decomposer 内部对 `routeIntent()` 的 circular dependency

## 问题根因

### decomposer.mjs
- `normaliseSubtasks()` 对 `{"subtasks": "not an array"}` silent 返回 `[]`
- 调用方以为"无需分解"，实际上是"decomposer 崩了"
- decomposer 内部调用 `routeIntent()`，形成循环：intent → decompose → intent → ...

### task-runtime.mjs
- `failed` subtask 计入 "finished" 数量，进度条显示 100% 但实际失败
- executor 可以 emit 两次 `success`，runtime 不拒绝第二次
- `refreshCompositeParentStatus()` 并发 race：两个 child 同时完成时读到 stale parent state

## 关键修改

### `src/service/core/router/decomposer.mjs`

1. 新增 `validateDecomposerOutput(parsed)` schema check：
   ```js
   function validateDecomposerOutput(parsed) {
     if (!Array.isArray(parsed?.subtasks)) {
       return { valid: false, error: "subtasks must be an array" };
     }
     for (const t of parsed.subtasks) {
       if (typeof t.command !== "string" || !t.command.trim()) {
         return { valid: false, error: "each subtask must have a non-empty command" };
       }
     }
     return { valid: true };
   }
   ```

2. 失败时明确返回结构（不再 silent 返回 `[]`）：
   ```js
   const validation = validateDecomposerOutput(parsed);
   if (!validation.valid) {
     return {
       subtasks: null,
       error: "decomposer_invalid_output",
       fallback: "single_task",
       reason: validation.error
     };
   }
   ```

3. 去除 circular dependency：decomposer 不再内调 `routeIntent()`，改由 TaskSpec 编译器（UCA-051）统一路由

### `src/service/core/task-runtime.mjs`

1. Progress 计算修复（failed 不计入 finished）：
   ```js
   const finished = statuses.filter(s =>
     ["success", "partial_success"].includes(s)  // 移除 "failed"、"cancelled"
   ).length;
   const failed = statuses.filter(s => ["failed", "cancelled"].includes(s)).length;
   // 向 UI 同时暴露 progress + failureCount
   ```

2. Duplicate event guard：
   ```js
   if (task.status === "success" && event.type === "success") {
     return; // 拒绝第二次 success
   }
   ```

3. `refreshCompositeParentStatus()` 乐观锁：
   ```js
   const parent = runtime.store.getTask(parentTaskId);
   const expectedVersion = parent._version ?? 0;
   // ...计算新状态...
   runtime.store.updateTaskCAS(parentTaskId, newState, expectedVersion);
   // CAS 失败时 re-read + retry（最多 3 次）
   ```

## 验证

`verify-service-core.mjs` 新增场景：
- `decomposer` 收到 malformed LLM output → 返回 `{error: "decomposer_invalid_output", fallback: "single_task"}`（不 silent）
- `task-runtime` failed subtask → progress 不计为 100%，UI 显示 failure count
- `task-runtime` duplicate success event → 第二次被 guard 拒绝
