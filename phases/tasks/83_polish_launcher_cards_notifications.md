# Task 83 — Prose-trap fix + App launcher + Card system + Notification merge

Status: `in_progress`
Owner: assistant (auto mode)
Created: 2026-04-25
Branch: `task/uca-077-connector-foundation` (current)

## 1. 任务目标

一次性把五条用户反馈落地：

1. **A — 散文陷阱修复**：agent-loop 在 LLM 纯文本回复无 `tool_calls` 时直接 `type:"final"` 退出，导致"我帮你发邮件"等承诺从不执行。改成：把 prose 作为 user 角色回灌给 LLM 一次（"你刚才说要做 X 但没发 tool_call，请调用工具"），再 plan 一轮；仍然不调则真正 final。
2. **B — 应用启动器（Python 侧车）**：在现有 `launch_app` 的 KNOWN_APPS + Get-StartApps 两级之后新增 Python 模块化启动链：索引 → 别名 → 匹配 → 裁决 → 窗口状态感知 → 学习反馈。解决"微信 vs 微信开发者工具"、"应用已在托盘/最小化"、"启动已在运行的应用导致开第二个窗口"等现象。
3. **C — 卡片系统重做**：按统一设计语言重做 tool_call 卡片（用户明确点丑）；支持 11 种卡片类型的框架；折叠展开；配套暗色主题。
4. **D — 思考过程卡片（模板级）**：可折叠 🧠 思考过程，不针对单个模型写死，走通用的 `reasoning_content` 通道。与 C 同套 CSS。
5. **E — 搜索结果 / 链接预览 / 引用卡片**：丰富 assistant-style 输出。
6. **F — 通知弹窗合并**：右上角一次提交有时弹 4 个通知。合并为一个带 1/2/3/4 分页的合集卡，点击切换/执行动作。顺便"精简卡片弹窗"。

## 2. 用户确认的决策

- Python **可用**，目标 3.10+。
- 依赖**由我定**：**rapidfuzz + pywin32**（前者用于模糊候选打分，后者是 Windows API 刚需，两个都是主流成熟库）。
- 裁决 UI 歧义消解：**overlay 里走 overlay 的确认卡，console 里走 console 自己的对话框**（不共享一套 UI 控件）。
- 计划文件落地后按顺序执行，每完成一步更新状态。

## 3. 工程顺序（commit 粒度）

| # | 任务 | 预估改动 | 风险 | 状态 |
|---|---|---|---|---|
| **83.1** | A — prose-trap 回灌（agent-loop） | ~50 行 + 1 处 verify 测试 | 低 | pending |
| **83.2** | F — 通知合并（service 层队列 + 渲染器分页卡）| ~200 行 2-3 文件 | 中（影响 UX 一致性）| pending |
| **83.3** | C — 卡片基础 CSS + tool_call 重做 | `shared.css` + overlay/console 渲染函数 | 中（影响三个面）| pending |
| **83.4** | D — thinking 卡片 + `reasoning_content` 端到端通道 | agent-loop 发射 + 三个面接收 | 中 | pending |
| **83.5** | E — web_search_result + link_preview + citation 卡片 | markdown renderer 扩展 | 中 | pending |
| **83.6** | B-PR1 — 应用索引器 dry-run（indexer + aliases） | 新建 `scripts/app_launcher/` 5 文件 | 低（不真启动）| pending |
| **83.7** | B-PR2 — arbiter + window_control + learner + 真启动 | 新建 4 文件 + 依赖安装 | 高（Win32 激活栈）| pending |
| **83.8** | B-PR3 — Node 集成：launch_app → python launcher | `action_tools/tools/index.mjs` 扩展 | 中 | pending |

## 4. 模块与接口规范

### 4.1 A — prose-trap 回灌

**改动点**：[src/service/executors/tool_using/agent-loop.mjs:782-807](src/service/executors/tool_using/agent-loop.mjs#L782-L807)

**逻辑**：

```
if (response.tool_calls.length > 0) { ...走老路... }
else if (proseTrapAttempts < 1 && shouldRetryProseTrap(response)) {
  // 回灌：把 prose 当 user 角色塞回 messages，提示 LLM 真调工具
  messages.push({ role: "assistant", content: prose });
  messages.push({
    role: "user",
    content: "你上面说要执行操作，但没有发出 tool_call。如果确实需要操作，请直接调用工具；如果只是解释/回答而无需操作，请重新只输出最终答复。"
  });
  proseTrapAttempts++;
  continue; // next iteration of tool loop
} else {
  return { type: "final", text: prose };
}
```

**决策**：`shouldRetryProseTrap` 判断条件：(a) 当前任务的 route.executor 是 `tool_using`（不是 `fast`），且 (b) 原 user_command 不是纯问答句式（不含 "什么/为什么/怎么样/?" 之类的问询词）。

### 4.2 F — 通知合并

**观察**：右上角通知由 notify/toast 系统触发。复合请求（比如一次"搜 3 个关键词再总结"）会产生 3-4 个 step_started / step_finished / tool_result 事件，每个都弹。

**改动点**：
- `src/service/events/event-bus.mjs` —— 加合并窗口（500ms）：同一 task_id 内多次 notify 合并成一个 `notification_batch`
- 桌面 toast 渲染器 / overlay 弹窗 / browser 通知 —— 接收 batch，渲染分页 "1/4"，左右箭头切换，点动作按钮走各自的 action
- 记忆：合并后**仅保留最近 3 个 batch**，老 batch 自动淡出

### 4.3 B — Python 应用启动器

```
scripts/app_launcher/
├── launcher.py          # 入口
├── indexer.py           # 扫描
├── aliases.py           # 用户配置
├── matcher.py           # 关键词匹配
├── arbiter.py           # 裁决链
├── window_control.py    # 窗口激活
├── learner.py           # 反馈学习
├── requirements.txt     # rapidfuzz + pywin32
└── store/               # 运行时数据（首次运行创建）
    ├── index.json
    ├── usage.json
    └── aliases.json
```

**CLI 约定**：
```bash
python launcher.py open --name "微信" --json        # 主路径
python launcher.py index --rescan --json             # 强制重扫
python launcher.py candidates --name "微信" --json   # dry-run，仅列候选
python launcher.py feedback --command "微信" --chose <appId> --correct   # 学习反馈
```

**返回结构（JSON）**：

```json
{
  "ok": true,
  "action": "launched" | "focused" | "restored" | "unhid" | "ambiguous",
  "appId": "e:/weixin/wechat.exe",
  "displayName": "微信",
  "hwnd": 132004,
  "elapsedMs": 840,
  "candidates": [...]   // 仅 action=="ambiguous" 时有
}
```

**Node 侧集成**（83.8）：在 [src/service/action_tools/tools/index.mjs:409](src/service/action_tools/tools/index.mjs#L409) 的第三级失败处，调用 `python scripts/app_launcher/launcher.py open --name <name> --json`，按返回决定继续（launched/focused）或把 `ambiguous` 冒泡给 agent-loop 让 LLM 出 clarification。

### 4.4 C / D / E — 卡片系统

**统一设计语言**：

```css
.lx-card {
  border: 1px solid color-mix(in srgb, var(--line) 65%, transparent);
  background: color-mix(in srgb, var(--bg-2) 80%, transparent);
  border-radius: 14px;
  padding: 10px 12px;
  margin: 4px 0;
  transition: border-color 160ms ease, box-shadow 160ms ease;
  word-break: keep-all;
  overflow-wrap: anywhere;
}
.lx-card:hover { box-shadow: var(--shadow-sm); }

.lx-card-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: var(--muted);
  cursor: pointer;
}
.lx-card-title { font-weight: 600; color: var(--ink); }
.lx-card-meta { margin-left: auto; font-size: 11px; }

.lx-card[data-kind="tool_call"]      { border-left: 2px solid #d97706; }
.lx-card[data-kind="thinking"]       { border-left: 2px solid #7c3aed; color: var(--ink-2); }
.lx-card[data-kind="web_search"]     { border-left: 2px solid #2563eb; }
.lx-card[data-kind="citation"]       { border-left: 2px solid #059669; }
.lx-card[data-kind="error"]          { border-left: 2px solid #dc2626; }
.lx-card[data-kind="file_artifact"]  { border-left: 2px solid #64748b; }

/* 折叠 */
.lx-card > details > summary::-webkit-details-marker { display: none; }
.lx-card > details > summary { list-style: none; }
.lx-card > details[open] > summary .chevron { transform: rotate(90deg); }
```

**部署位置**：
- Overlay → 加进 `overlay.html` 内嵌 style
- Console chat → 加进 `shared.css`
- Sidepanel → 加进 `sidepanel/styles.css`（三份复制，接受冗余换隔离）

**思考卡片（D）**：
```html
<div class="lx-card" data-kind="thinking">
  <details>
    <summary>
      <span class="chevron">▸</span>
      <span class="lx-card-title">🧠 思考过程</span>
      <span class="lx-card-meta">1.2s · 187 tokens</span>
    </summary>
    <div class="lx-card-body lx-thinking-body">
      {reasoning_content streaming here}
    </div>
  </details>
</div>
```

### 4.5 Agent-loop → thinking 通道（D 依赖）

目前 [provider-adapter.mjs:444-446](src/service/executors/agentic/provider-adapter.mjs#L444-L446) 累计 `fullReasoning` 但不 emit。需要加一个 `onReasoningDelta` callback（与 `onTextDelta` 并列），自上而下传到 runtime event bus，发出 `event_type: "reasoning_delta"` 事件。三个面的 renderer 订阅该事件 → 往当前 assistant bubble 追加 thinking 卡片 body。

浏览器 standalone-client 已经在之前的 Qwen 修复里收集了 `reasoning_content`；这里把它也通过 onChunk 的第三个参数或单独 callback 暴露给 sidepanel 渲染层。

## 5. 验证策略

每个子任务独立验证，不混：

| # | 验证方式 |
|---|---|
| 83.1 | 新建 `scripts/verify-prose-trap.mjs`：mock 一个只返回 prose-no-tool 的 LLM，期望第二轮 user message 是回灌提示；继续返回 prose 则真 final |
| 83.2 | 手动：触发"搜 3 个关键词"看是否 4 个通知合并成 1 个带分页 |
| 83.3 | 手动：overlay/console/sidepanel 各发一个会调工具的请求，确认卡片风格一致 |
| 83.4 | 手动：用 qwen3-plus（开思考）发请求，侧栏能看到折叠的 🧠 思考过程卡片，内容实时流入 |
| 83.5 | 手动：问一个需要 web_search 的问题，搜索结果以卡片列出，每条带来源链接 |
| 83.6 | `python scripts/app_launcher/launcher.py candidates --name 微信 --json` → 能列出所有候选 + 分数 + 是否 devtool |
| 83.7 | `python scripts/app_launcher/launcher.py open --name 微信` → 若未运行则启动，若最小化则恢复，若托盘则置前 |
| 83.8 | 浏览器或 console 发"打开微信"，当 KNOWN_APPS/Get-StartApps 都失败时回落到 Python 链路 |

## 6. 明确不做（这个 task 内）

- 不重写现有 markdown 渲染器（只扩展）
- 不加新的 LLM 提供商
- 不改现有 `launch_app` 的前两级（KNOWN_APPS / Get-StartApps）行为
- 不做 B-PR2 里的"模拟 Alt 键绕过 SetForegroundWindow"的全部兜底（先 AllowSetForegroundWindow + 普通 SetForegroundWindow，如果实测失败率高再加第二层）
- 不做通用"用户可选卡"UI 控件（每面各自实现）
- 不做 iOS/Mac/Linux 路径（B 全系 Windows-only）

## 7. 风险 & 回退

| 风险 | 缓解 |
|---|---|
| 散文回灌导致 LLM 死循环（一直返回散文）| 硬限 `proseTrapAttempts = 1`；超出真 final |
| Python 未安装 | 83.8 的 Node 集成先 `which python`；缺则跳过该级保留原行为 |
| pywin32 编译依赖 | 文档记录用 `pip install pywin32` 预编译 wheel；失败时启动器只做索引/裁决，不做窗口激活 |
| 通知合并丢失紧急 error | error 类型不进合并窗口，立即弹单独 toast |
| 卡片 CSS 破坏现有排版 | 每一步改完都跑 overlay/sidepanel/console 手测；如发现破坏则 .lx-card 容器加 `contain: layout` 隔离 |

## 8. 完成后必须做

- 回写每一行 status: done
- `git log` 有对应的子 commit
- 记录 qwen streaming 是否也受益（E 间接修）
- 更新 [docs/planning/universal_context_agent_detailed_plan.md](docs/planning/universal_context_agent_detailed_plan.md) 的 action_tools 章节若有新契约
