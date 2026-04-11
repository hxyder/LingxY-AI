# Task UCA-039 — 智能应用启动 + 免费 Web 搜索（DuckDuckGo HTML）+ 时效性检测

## 1. 任务目标

让 AI 在用户让它"启动微信 / QQ / 钉钉"等非硬编码应用时能真的启动（不是硬拒绝），并给 LLM 加一个真实返回搜索结果文本的 `web_search_fetch` 工具，让追问"最新 XX"类问题时不再吐出过期信息。

## 2. 前置依赖

- 上一个任务：UCA-008（action tools 基础）、UCA-017（tool_using executor）
- 必须已有的产物：BUILTIN_ACTION_TOOLS 列表、risk matrix、tool_using 执行器
- 不能同时修改的区域：tool_using 执行器主干、risk matrix 结构

## 3. 实施范围

- 负责模块：LAUNCH_APP_TOOL 多策略启动解析、免费搜索客户端、web_search_fetch 工具、intent-router 路由扩展
- 允许改动文件/目录：`src/service/action_tools/tools/index.mjs`、`src/service/action_tools/schemas/index.mjs`、`src/service/search/`（新增）、`src/service/core/router/intent-router.mjs`、`scripts/verify-action-tools.mjs`
- 明确不做：付费搜索 API、内容抓取与正文提取、排名调优

## 4. 交付产物

- `src/service/search/free-search.mjs`：DuckDuckGo HTML 客户端（无 key）
- `normalizeSearchRecency / inferSearchRecency` 时效性解析
- `ACTION_TOOL_SCHEMAS.web_search_fetch` + `WEB_SEARCH_FETCH_TOOL`
- `web_search` 工具同步加入 recency 支持（映射到 Google `tbs=qdr:`）
- `LAUNCH_APP_TOOL` 三步启动解析（Start-Process / Get-StartApps / 友好错误）
- `KNOWN_APPS` 扩展 wechat/QQ/dingtalk/wemeet/cloudmusic/spotify/notion/slack/telegram/discord
- `intent-router` 追加 `启动 / 运行 / launch / start / run` 关键词路由到 `tool_using`

## 5. 验证方式

- `node scripts/verify-action-tools.mjs`（count 17 → 18，新断言 `web_search_fetch` / `normalizeSearchRecency` / `searchWeb` 的 recency 参数透传 / fake launch_app 路由）
- `node scripts/verify-service-core.mjs`（count 17 → 18）
- `node scripts/verify-translation.mjs`
- 手动：让 AI "启动微信" → 通过 Get-StartApps 找到 AppsFolder AppId → `explorer shell:AppsFolder\...` 启动
- 手动：问"最新 AI 新闻" → recency 自动 normalize 到 `m` → DuckDuckGo `df=m` 参数 → 更近的结果

## 6. Git 执行方式

- 分支名：`task/uca-039-smart-launch-and-search`
- Commit 格式：`UCA-039: smart launch_app + free web_search_fetch with recency`
- 合并条件：非硬编码应用能启动；搜索工具返回真实文本；recency 自动从"最新/本周/今年"等短语推断

## 7. 完成后必须更新本文件

- 列出 Get-StartApps 支持的启动方式与已知失败边界
- 列出搜索返回的文本格式与引用策略
- 列出已知的 DuckDuckGo HTML 解析脆弱点

## 8. 对下一个任务的交接

- 下一个任务：让 LLM 在 tool_using 路径下主动调用 web_search_fetch 做 RAG 式追问
- 本任务新增了什么：真实可用的搜索返回 + 智能启动 + 时效性检测
- 下一个任务直接可复用什么：`searchWeb({query, limit, recency})` API、WEB_SEARCH_FETCH_TOOL 工具
- 还没解决的问题：长网页正文抓取、结果权威性评估

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：把"最新/搜索/启动应用"纳入统一 tool transcript 事实约束。LLM 的最终回复必须来自真实工具 observation：搜索类问题必须先有 `web_search_fetch` 成功记录；启动类任务只有 `launch_app.success === true` 才能说已启动；失败时返回工具错误和下一步建议，不允许语言层自行宣称完成。
- 当前代码对齐点：`src/service/search/free-search.mjs`、`src/service/action_tools/tools/index.mjs`、`src/service/executors/tool_using/agent-loop.mjs` 已有搜索工具和部分强制搜索逻辑；仍要检查工具结果是否进入下一轮 prompt，以及 `launch_app` 的 `success:false` 是否被最终回复严格引用。UCA-049 会把这条约束提升到 provider 无关的 agentic planner，避免只修 tool_using 一条路径。
- 可能需要生成的文件：不需要新增业务模块；需要扩展 `scripts/verify-action-tools.mjs` 或新增 `scripts/verify-agentic-truthfulness.mjs`，覆盖 `web_search_fetch` 被调用、tool observation 注入、`launch_app` 失败不报成功。

## 9. 执行记录

- 状态：in_progress
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：
- 实际新增内容：
  - **`src/service/search/free-search.mjs`**：
    - DuckDuckGo HTML endpoint `https://html.duckduckgo.com/html/`，POST form
    - `parseDuckDuckGoHtml()` 解析 `<div class="result">` 块，提取 title/url/snippet，自动解码 `?uddg=` 重定向参数
    - `formatResultsAsText()` 渲染为 "1. title\n   url\n   snippet" 文本块
    - `inferSearchRecency(query)` 启发式：`今天/今日/24小时/today/breaking` → `d`，`本周/近7天/week` → `w`，`本月/近30天/month` → `m`，`今年/近12个月/year` → `y`，`最新/最近/新闻/latest/current/news` → `m`
    - `normalizeSearchRecency(recency, query)` 显式 recency > 隐式推断
    - `searchWeb({query, limit, recency, fetchImpl})` 把 recency 注入 `df` 查询参数
  - **`ACTION_TOOL_SCHEMAS.web_search_fetch`**：`{query, limit, recency}`
  - **`WEB_SEARCH_FETCH_TOOL`**（[tools/index.mjs](../../src/service/action_tools/tools/index.mjs)）：调 `searchWeb` + 拼 observation 文本 + metadata 含 results 数组
  - **`WEB_SEARCH_TOOL` 同步支持 recency**：映射到 Google `&tbs=qdr:{d/w/m/y}`
  - **`ACTION_TOOL_SCHEMAS.web_search`** 新增 `recency` 字段
  - **`LAUNCH_APP_TOOL` 三步启动解析**：
    1. `Start-Process {command}` —— 解析硬编码 KNOWN_APPS
    2. 失败时 `resolveAppViaStartMenu(appName)` —— PowerShell `Get-StartApps | Where-Object Name -like '*{name}*'`，拿到 AppID 后 `explorer.exe shell:AppsFolder\{AppId}`
    3. 都失败时返回友好的 "未能启动 {app}...可以告诉我完整路径或让我用 web_search 帮你搜官方下载页" metadata
  - **`KNOWN_APPS` 扩展**：`wechat/微信 → WeChat.exe`，`qq → QQ.exe`，`钉钉/dingtalk → DingTalk.exe`，`腾讯会议/wemeet → WeMeetApp.exe`，`网易云音乐/cloudmusic → cloudmusic.exe`，以及 spotify/notion/slack/telegram/discord
  - **`intent-router`**：`邮件/email/搜索/search/打开/open/启动/运行/launch/start/run/复制/clipboard/通知/notify/定时/schedule/每天/每周/提醒` 都路由到 `tool_using` 执行器
  - **`BUILTIN_ACTION_TOOLS`** count 17 → 18
  - **验证脚本扩展**：
    - `verify-action-tools.mjs` 新增 `normalizeSearchRecency(null, "最新 AI 新闻")` → `"m"`、mocked fetch + 断言 `df=m` 参数被注入、fake launch_app registry + `submitActionToolTask` 端到端
- 验证结果：
  - `node scripts/verify-action-tools.mjs` 通过
  - `node scripts/verify-service-core.mjs` 通过（count 18）
  - `node scripts/verify-translation.mjs` 通过
  - DuckDuckGo HTML mocked 解析 2 条结果，uddg 解码成功
- 遗留问题：
  - **[已知缺陷]** 用户反馈：追问需要搜索的问题时，返回仍然是"老旧内容" —— recency 已经注入 `df` 参数，但 DuckDuckGo HTML 端点对该参数的生效程度依赖于后端索引。需要验证：
    - LLM 在 tool_using 路径下是否真的调用了 `web_search_fetch`（可能只是直接回答，没走工具）
    - 工具返回的结果是否被注入回 LLM 的下一步 prompt
  - **[已知缺陷]** 用户反馈：让 AI 启动应用，它说"已启动"但实际没启动。疑似 LLM 在 tool_using 路径里把 tool 返回的 success/failure 当成"决定性"判断，但 LAUNCH_APP_TOOL 在所有启动策略失败时返回 `success: false` + friendly message；LLM 应该基于 success 字段决定措辞，目前可能错读为 success。需要在 tool_using executor 把 tool 返回的 success/error 明确透传到 LLM
  - DuckDuckGo HTML 解析基于 CSS class 名，他们改版后需要重写 parseDuckDuckGoHtml
- 交接给下一个任务：
  - 下一个任务可以在 LLM 系统提示里强化"只有 tool 返回 success:true 才能说执行成功"
  - 可以把 `web_search_fetch` 注入到 fast executor 的 system prompt 作为"你可以调用这个工具"提示
