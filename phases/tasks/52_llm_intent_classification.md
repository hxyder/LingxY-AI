# UCA-052 — LLM-based Intent Classification

**Status**: done  
**Priority**: P1  
**Depends on**: UCA-051  
**Branch**: `task/uca-052-intent-classification`

## 目标

替换 intent-router.mjs 中的 substring 关键词匹配（`text.includes("file")`），改为词边界 regex + fast LLM 零样本分类，消除因 substring 匹配导致的误路由（如 "profile" 触发 file intent）。

## 问题根因

```js
// 当前代码：fragile substring matching
const matched = RULES.find((rule) =>
  rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))
);
// "profile" 包含 "file" → 错误触发 file intent
// "lifestyle" 包含 "file" → 错误触发 file intent
```

## 分类 Goal Families

```
qa                   — 纯问答，无工具
search_and_answer    — 需要最新信息，先搜索再回答
analyze_and_report   — 分析内容，生成文件
generate_document    — 创建 PPT/Word/Excel/PDF
open_or_reveal_file  — 定位并打开文件
transform_existing_file — 修改/转换已有文件
launch_and_act       — 启动应用 + 操作
schedule_or_notify   — 后台定时任务
translate            — 语言转换
multimodal_analyze   — 视觉/图像分析
```

## 实现方案

### 两级分类策略

**Level 1 — 词边界规则（快速，< 1ms）**：
```js
const GOAL_RULES = [
  { goal: "translate",      patterns: [/\b(翻译|translate)\b/i] },
  { goal: "launch_and_act", patterns: [/\b(启动|打开|运行|launch|open|run)\b.*\b(应用|app|程序)\b/i] },
  { goal: "generate_document", patterns: [/\b(生成|创建|制作|写)\b.*\b(pptx?|docx?|xlsx?|pdf|报告|报表|文档|演示文稿)\b/i] },
  { goal: "schedule_or_notify", patterns: [/\b(定时|每天|每周|提醒|cron)\b/i] },
  { goal: "translate",      patterns: [/\b(translate|翻译)\b/i] },
  // ...
];
```

**Level 2 — fast LLM call（当 Level 1 无匹配时）**：
- 用 fast executor 调用 LLM，system prompt 包含 goal family 列表和示例
- 返回 JSON `{"goal": "qa", "confidence": 0.9, "reasoning": "..."}`
- 超时（500ms）或失败时 fallback 到 `qa`

### 关键修改文件

`src/service/core/router/intent-router.mjs`：
- 替换 `RULES.find()` 逻辑，改为 `classifyGoal(text)` 函数
- `classifyGoal()` 先走 Level 1 规则，再走 Level 2 LLM
- 输出 `TaskSpec.goal`（传给 UCA-051 的 TaskSpec 编译器）
- 冲突关键词通过 context 消歧（"打开" + "应用名" → launch_and_act，"打开" + 文件名 → open_or_reveal_file）

## 验证

`verify-service-core.mjs` 新增边界 case：
- "分析我的 profile 文件" → `analyze_and_report`（不是 file_action）
- "lifestyle 建议" → `qa`（不是 file_action）
- "翻译这段文字" → `translate`
- "帮我打开微信" → `launch_and_act`
- "打开刚才生成的 PPT" → `open_or_reveal_file`
- "分析 AI 趋势生成 PPT" → `generate_document`
