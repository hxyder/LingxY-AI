# UCA-066 — 性能快速通道（Performance Fast Path）

**Status**: todo  
**Priority**: P0  
**Depends on**: UCA-052, UCA-058  
**Branch**: `task/uca-066-performance-fast-path`

## 目标

对不需要 LLM 的操作建立零延迟快速通道，对 LLM 必需的操作实现流式输出。硬性性能指标：

| 场景 | 目标 | 说明 |
|---|---|---|
| 纯启动（"打开微信"）| **< 200ms** | 完全不调 LLM |
| 翻译选中文字 | **< 800ms** | 专用翻译 API |
| 定时提醒（时间明确）| **< 300ms** | 直接写 scheduler |
| **复合动作（"打开Outlook起草邮件"）** | **< 30s** | launch 瞬时 + 1次 LLM 生成邮件内容 |
| 搜索 + 回答 | 首字 **< 1.5s** | 流式输出 |

> 复合动作"打开Outlook写邮件"昨天实测可用、速度可接受。目标是确保这条路径**始终可靠**，不因路由错误退化为 3 次 LLM 调用或被错误分解。

## 复合动作的实际时序（< 30s 如何达到）

```
当前（有 bug 时）：
  decomposer LLM 调用（3-8s）→ 拆成 2 个 subtask → 各自独立 LLM（3-8s×2）= 9-24s + 不可靠

修复后（正确路径）：
  ① UCA-058 guard：跳过 decomposer LLM 调用         =  0ms（节省 3-8s）
  ② intent-router 词边界匹配                         < 10ms
  ③ launch_app("Outlook") → 启动进程                 ~200-500ms
  ④ LLM 生成邮件内容（1次调用）                       3-8s
  ⑤ compose_email 工具调用                            < 100ms
  ────────────────────────────────────────────────────
  总计                                                 ~4-9s（远低于 30s）
```

**关键**：复合动作里 `launch_app` 是 Tier 0（瞬时），只有"生成邮件内容"这一步需要 LLM（1次调用）。整条路径 LLM 只调用 1 次，不是 3 次。

## 问题根因

目前所有请求都走相同的重路径：
```
输入 → intent-router(LLM?) → decomposer(LLM) → executor → tool_using(LLM) → 结果
        最多3次LLM调用，总延迟 9-24s，且 decomposer 可能破坏复合动作
```

对于"打开微信"这种确定性动作，走了 3 次 LLM 调用，实际执行只需 1 行代码。

## 快速通道分类

### Tier 0：纯确定性（< 100ms，无 LLM）

| 动作 | 工具 | 触发条件 |
|---|---|---|
| 启动应用 | `launch_app` | 匹配应用名关键词 |
| 打开 URL | `open_url` | 输入包含 http/www |
| 复制到剪贴板 | `copy_to_clipboard` | "复制" + context 有选中文字 |
| 发送系统通知 | `notify` | "提醒"/"通知"+ 内容完整 |
| 打开文件 | `open_file` | 输入包含完整路径 |

### Tier 1：轻量 API（< 800ms）

| 动作 | 方案 | 说明 |
|---|---|---|
| **翻译** | DeepL Free API / LibreTranslate | 不经过主 LLM，专用翻译 API |
| **定时提醒**（时间明确）| 直接写 scheduler store | "下午三点开会"→ 解析后直接写，不经 LLM |
| **文件查找** | `glob_files` / `find_recent_files` | 文件系统操作，不需要 LLM |

### Tier 2：LLM + Streaming（首字 < 1.5s）

| 动作 | 方案 |
|---|---|
| QA / 解释 / 总结 | 直接发给 LLM，**流式返回**，边生成边显示 |
| 搜索 + 回答 | web_search_fetch → 结果流式传给 LLM 综合 |
| 文档生成 | LLM 生成提纲 → 流式显示 → 后台生成文件 |

## 关键修改

### 新建 `src/service/core/router/fast-path-router.mjs`

```js
/**
 * 在进入完整 intent-router 之前，先检查是否命中快速通道。
 *
 * 关键边界：
 *   - "打开微信"（仅此一件事）          → Tier 0，直接 launch_app，不调 LLM
 *   - "打开Outlook，帮我写请假邮件"      → 返回 null，走 tool_using + llmPlanner
 *                                          （launch_app 在工具循环内 Tier 0 执行，
 *                                            只有邮件生成那 1 次才调 LLM）
 *
 * 判断依据：命令里除"打开/启动"之外，是否还有需要 LLM 理解/生成的内容。
 */
export function tryFastPath(userCommand, contextPacket) {
  // 复合动作判断：有"打开X + 做Y"结构 → 必须走 llmPlanner，不走 Tier 0
  const COMPOUND_PATTERN = /(?:打开|启动|open|launch)\s*\S+\s*[，,]\s*(?:帮我|写|发|查|搜|做|生成)/i;
  if (COMPOUND_PATTERN.test(userCommand)) {
    return null; // → tool_using executor + llmPlanner（含 Tier 0 工具调用）
  }

  // Tier 0: 纯确定性单动作
  const url = extractUrl(userCommand);
  if (url) return { tier: 0, tool: "open_url", args: { url } };

  // "打开X"且 X 后面没有其他任务 → 纯 launch
  const appName = extractLaunchAppName(userCommand);
  const isOnlyLaunch = appName && !COMPOUND_PATTERN.test(userCommand)
    && userCommand.trim().replace(/打开|启动|open|launch/gi, "").trim().length < 20;
  if (isOnlyLaunch) return { tier: 0, tool: "launch_app", args: { app: appName } };

  if (isClipboardRequest(userCommand, contextPacket)) {
    return { tier: 0, tool: "copy_to_clipboard", args: { content: contextPacket.text } };
  }

  // Tier 1: 翻译（专用 API，不走主 LLM）
  if (isTranslationRequest(userCommand)) {
    return { tier: 1, executor: "translation_fast", text: contextPacket.text ?? userCommand };
  }

  // Tier 1: 时间明确的提醒（直接写 scheduler store，不走 LLM）
  const scheduleResult = tryParseSchedule(userCommand);
  if (scheduleResult) {
    return { tier: 1, executor: "scheduler_direct", ...scheduleResult };
  }

  return null; // 走正常路径（intent-router → executor）
}
```

### 工具循环内的 Tier 0 加速（`agent-loop.mjs`）

复合动作走 `tool_using + llmPlanner` 时，工具循环里的 `launch_app` / `open_url` /
`copy_to_clipboard` 等确定性工具**跳过 LLM 决策直接执行**：

```js
// 在 runToolAgentLoop 里，对 Tier 0 工具跳过 LLM planner，直接执行
const TIER0_TOOLS = new Set(["launch_app", "open_url", "copy_to_clipboard", "notify", "open_file"]);

// 第一轮：如果 transcript 为空 且命令包含明确的 Tier 0 动作，直接执行，不调 LLM
if (transcript.length === 0) {
  const tier0 = extractTier0Action(task.user_command);
  if (tier0) {
    // 立即执行，省去 1 次 LLM planner 调用（节省 2-5s）
    const result = await registry.call(tier0.tool, tier0.args, context);
    transcript.push({ type: "tool_result", tool: tier0.tool, ...result });
    // 后续轮次继续走 llmPlanner（此时 LLM 看到 launch 已完成，专注生成内容）
    continue;
  }
}
```

**效果**：
```
之前：LLM planner 调用 → 决定 launch_app → 执行（2-5s LLM + 200ms 执行）
之后：直接执行 launch_app（200ms）→ LLM 只负责后续内容生成（1次调用）
```

### `src/service/core/http-server.mjs`

```js
// /task endpoint 最前面加快速通道
const fastPath = tryFastPath(body.user_command, body.context_packet);
if (fastPath) {
  const result = await executeFastPath(fastPath, runtime);
  return res.json({ ok: true, fast_path: true, ...result });
}
// 否则走正常路径
```

### 翻译快速通道 — `src/service/executors/translation-fast.mjs`

```js
// 优先级：1) DeepL Free API  2) LibreTranslate  3) 降级到主 LLM
async function translateFast(text, targetLang = "ZH") {
  // DeepL Free（免费版 500k chars/月）
  if (process.env.DEEPL_API_KEY) {
    return await deeplTranslate(text, targetLang);
  }
  // LibreTranslate（可自部署，完全免费）
  if (process.env.LIBRETRANSLATE_URL) {
    return await libreTranslate(text, targetLang);
  }
  // 降级：用主 LLM 但用最短 prompt
  return await llmTranslate(text, targetLang);
}
```

### LLM 流式输出 — `src/service/core/http-server.mjs`

```js
// /task/stream endpoint（新增）：Server-Sent Events 流式返回
app.get("/task/stream/:taskId", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");

  const unsub = runtime.eventBus.subscribe((event) => {
    if (event.task_id !== req.params.taskId) return;
    if (event.event_type === "text_chunk") {
      res.write(`data: ${JSON.stringify({ chunk: event.chunk })}\n\n`);
    }
    if (event.event_type === "status_changed" && 
        ["success", "failed", "partial_success"].includes(event.payload?.status)) {
      res.write(`data: ${JSON.stringify({ done: true, status: event.payload.status })}\n\n`);
      res.end();
      unsub();
    }
  });
});
```

### `src/desktop/renderer/overlay.js`

- 订阅 `/task/stream/:taskId`，把 `text_chunk` 事件实时追加到对话气泡里
- 流式显示时气泡末尾显示光标动画（类似 ChatGPT 效果）

### Intent 分类缓存 — `src/service/core/router/intent-router.mjs`

```js
// 对相同/相似输入缓存分类结果（LRU，最多 50 条）
const intentCache = new Map();

export function routeIntent(userCommand) {
  const cacheKey = userCommand.trim().toLowerCase().slice(0, 100);
  if (intentCache.has(cacheKey)) {
    return intentCache.get(cacheKey);
  }
  const result = _routeIntentImpl(userCommand);
  if (intentCache.size >= 50) {
    intentCache.delete(intentCache.keys().next().value); // LRU evict
  }
  intentCache.set(cacheKey, result);
  return result;
}
```

## 性能目标对照表

| 场景 | 当前（估计）| 目标 | 路径 |
|---|---|---|---|
| 打开微信 | 3-5s（走 LLM）| **< 200ms** | Tier 0，跳过 LLM |
| 翻译选中文字 | 3-8s | **< 800ms** | DeepL/LibreTranslate |
| "下午三点开会"提醒 | 3-5s | **< 300ms** | 直接写 scheduler |
| **"打开Outlook起草邮件"** | **不稳定/失败** | **< 30s** | Tier 0 launch + 1次 LLM |
| "帮我解释这段代码" | 5-10s | 首字 < 1.5s | streaming |
| "搜索最新AI动态" | 8-15s | 首字 < 2s | streaming |

## 验证

- "打开微信" → 100ms 内响应，无 LLM 调用记录
- "翻译这段" → 800ms 内显示翻译结果
- "今天下午三点开会" → 200ms 内创建提醒
- 搜索请求 → 对话框内容逐字流式显示，不是等待后整体出现
- 关闭 DeepL API key → 翻译降级到 LibreTranslate → 再降级到主 LLM
