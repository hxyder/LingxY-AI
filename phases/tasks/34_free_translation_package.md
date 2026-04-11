# Task UCA-034 — 免费翻译包与 translate 执行器

## 1. 任务目标

为 UCA 加一条不依赖任何付费 API / API key 的翻译能力：只要联网，用户就能在 Overlay、浮动 chip、或 tool_using 工具调用中触发翻译，并获得真实译文。

## 2. 前置依赖

- 上一个任务：UCA-017（真实 AI 运行时）、UCA-029（统一 capture 入口）
- 必须已有的产物：执行器注册表、action tool 注册表、intent-router
- 不能同时修改的区域：现有 fast / multi_modal / tool_using / kimi 执行器主干

## 3. 实施范围

- 负责模块：免费翻译客户端、translate 执行器、translate_text action tool
- 允许改动文件/目录：`src/service/translation/`（新增）、`src/service/executors/translate/`（新增）、`src/service/action_tools/`、`src/service/core/router/`、`src/service/core/service-bootstrap.mjs`、`src/service/core/browser-submission.mjs`、`src/service/core/context-submission.mjs`、`scripts/verify-translation.mjs`（新增）
- 明确不做：自建翻译模型、付费翻译 API 集成

## 4. 交付产物

- `src/service/translation/free-translator.mjs`：双路免费翻译客户端
- `src/service/executors/translate/translate-executor.mjs`：独立 translate 执行器
- `ACTION_TOOL_SCHEMAS.translate_text` + `TRANSLATE_TEXT_TOOL`
- intent-router 把"翻译/translate"路由到新的 `translate` 执行器
- `scripts/verify-translation.mjs`：端到端 mocked-fetch 验证

## 5. 验证方式

- `node scripts/verify-translation.mjs`
- `node scripts/verify-action-tools.mjs`
- `node scripts/verify-service-core.mjs`
- 真实网络 smoke：EN→中文、中文→EN、长文本自动分块

## 6. Git 执行方式

- 分支名：`task/uca-034-free-translation`
- Commit 格式：`UCA-034: add free translation module`
- 合并条件：不配置任何 AI provider 也能翻译；现有测试全部通过；action tool 数量断言更新到 17

## 7. 完成后必须更新本文件

- 列出最终采用的翻译来源及限额
- 列出长度/分块策略
- 列出已知的语种覆盖与边界

## 8. 对下一个任务的交接

- 下一个任务：浏览器内联结果框（UCA-037）直接用 translate 执行器做"翻译选区"一键路径
- 本任务新增了什么：免费翻译客户端 + translate 执行器 + translate_text 工具
- 下一个任务直接可复用什么：`translateText({text, target})`、无 AI key 执行路径
- 还没解决的问题：翻译历史、术语表、语气/风格参数

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - `src/service/translation/free-translator.mjs`：
    - 主路 MyMemory HTML API（5000 字/日/IP 免费额度，无 key）
    - 备路 Google Web `translate_a/single`（无 key）
    - 自动语种检测（中/英/日/韩/俄/阿）
    - 长文本按句号/问号/感叹号/换行自动分块，每段 ≤ 480 字符
    - 同源目标语种短路返回（不做无效 API 调用）
    - 支持注入 `fetchImpl` 便于测试
  - `src/service/executors/translate/translate-executor.mjs`：
    - 新 executor ID `translate`，`supportsStreaming: true`
    - 从 `task.context_packet.text` 或 `file_metadata.text` 提取源文本
    - 从 `user_command` 推断目标语（"translate to English"、"翻译成日文"等）
    - 直接调用 `translateText`，yield `inline_result` + `success` 事件
    - 兼容 signal abort
  - `ACTION_TOOL_SCHEMAS.translate_text` + `TRANSLATE_TEXT_TOOL`：供 tool_using 执行器按需调用
  - `intent-router`: `翻译/translate` 关键词从 `fast` 改为 `translate` executor
  - `service-bootstrap.mjs` 注册新 executor
  - `browser-submission.mjs` / `context-submission.mjs` 的 `shouldUseKimi` 判定豁免 `translate` executor（即使配置了 code-cli provider 也走免费翻译）
  - `scripts/verify-translation.mjs`: 单元测试（detectSourceLanguage / splitIntoChunks / normalizeLanguageCode / inferTargetLanguageFromCommand）+ mocked-fetch 端到端（MyMemory 主路 + Google 备路 + 同语短路 + 长文本分块）+ 执行器 stub 测试 + 完整 service bootstrap 测试
- 验证结果：
  - `node scripts/verify-translation.mjs` 通过
  - `node scripts/verify-action-tools.mjs` 通过（count 16 → 17）
  - `node scripts/verify-service-core.mjs` 通过
  - 真实网络 smoke：EN→ZH `Hello world. This is a test of the free translator.` → `你好世界。这是对免费翻译器的测试。`（google_web）；ZH→EN 正确；长文本 2 chunks 自动拼接
- 遗留问题：
  - MyMemory 每日限额可能在高频使用时耗尽 —— 实测时自动降级到 Google web
  - 没有术语表 / 风格参数
  - **[已知缺陷]** 用户反馈：对同一段文字连续触发翻译时，第二次返回的还是上一次的译文（见 UCA-029 遗留问题）—— 部分原因在 service-core dedupe，已通过 UCA-040 修复；但换新段落仍重现，需要继续定位浏览器扩展侧的 selection state 缓存
- 交接给下一个任务：
  - 下一任务可直接 `import { translateText } from "./translation/free-translator.mjs"` 使用
  - `translate` executor 可以被 tool_using 或 Overlay 的 quick action 重用
