# UI 升级计划

合并两份评审（Codex 真实 DOM/CSS bug + 跨应用习惯走查）。按修复成本与用户感知排优先级。

## 走查结论

- **Console 主控台**：信息架构（左 rail + 顶部命令面板 + 主题/快捷键弹层）符合桌面管理台习惯，方向正确。最大不适感集中在 Tasks 长文本溢出 + 几处 a11y/验证脚本漂移。
- **Overlay 浮窗**：作为唤起式输入，缺关键的"消失契约"——Esc 不关、点击外部不关、任务执行无法停。事件流卡片设计本身克制可读，但缺时间戳/阶段标签/复制按钮。
- **Dock 球**：状态语言（recording / echo / completed burst）做得完整，无需改动。

---

## P0 — 真实 Bug（必须修，影响功能或可访问性）

### 1. Tasks 列表长标题横向溢出
**现象**：超长 `user_command` / URL 撑出页面横向滚动条。
**位置**：[src/desktop/renderer/console.js:2711](src/desktop/renderer/console.js#L2711) 渲染 `<h4>`；[src/desktop/renderer/shared.css:1265](src/desktop/renderer/shared.css#L1265) 的 `.task-item h4` 没有截断。
**修复**：给 `.task-item h4` 加 `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;`，并保证父 `.row` 是 `min-width: 0` 的 flex 容器。`.task-row-title` 已有正确样式但未被引用——可直接复用而不是新写一份。

### 2. Command Palette 同元素双 id 导致 aria-labelledby 失效
**现象**：[src/desktop/renderer/console.html:711](src/desktop/renderer/console.html#L711) 同一个 `<div>` 写了 `id="paletteGreeting"` 与 `id="paletteTitle"`。浏览器只保留第一个，[console.html:709](src/desktop/renderer/console.html#L709) 上的 `aria-labelledby="paletteTitle"` 永远找不到目标，屏幕阅读器读不到对话框标题。
**修复**：把第二个 id 删除，改成 `id="paletteTitle"` 单一 id（`paletteGreeting` 没有被 JS 引用，可以直接换）。或拆成独立的 `<h2 id="paletteTitle" class="visually-hidden">Quick action palette</h2>`。

### 3. Chat panel 引用了不存在的 consoleChatTitle
**位置**：[src/desktop/renderer/console.html:1020](src/desktop/renderer/console.html#L1020) `aria-labelledby="consoleChatTitle"`，全文无此 id。
**修复**：要么在 `.console-chat-panel` 内补一个 `<h2 id="consoleChatTitle" class="visually-hidden">Console chat</h2>`，要么直接移除 `aria-labelledby` 改用 `aria-label="Console chat"`。

### 4. 折叠侧边栏底部细横向滚动条
**位置**：[src/desktop/renderer/console.html:39](src/desktop/renderer/console.html#L39) `.app-rail` 只有 `overflow-y: auto`。
**修复**：补 `overflow-x: hidden`。

### 5. 验证脚本漂移
- `verify:palette` 还在断言 `source_app: "console.palette"`（snake_case），实际代码已是 `sourceApp: "console.palette"`（[console.js:4922](src/desktop/renderer/console.js#L4922)）。
- `verify:tasks-page` 没覆盖 `stat-strip--idle` 折叠态（[console.js:1552](src/desktop/renderer/console.js#L1552)）。
**修复**：[scripts/verify-palette.mjs:96](scripts/verify-palette.mjs#L96) 改为 `sourceApp:\s*"console\.palette"`；[scripts/verify-tasks-page.mjs](scripts/verify-tasks-page.mjs) 增加 idle 分支断言。这些是脚本跟不上重构，不是 UI 问题，但会卡 CI。

---

## P0 — UX 关键缺陷（违反跨软件通用习惯）

### 6. Overlay Esc 键只在语音模式下能关
**位置**：[src/desktop/renderer/overlay.js:5192-5194](src/desktop/renderer/overlay.js#L5192-L5194)
**期望**：任意状态按 Esc → `window.ucaShell.hideWindow("overlay")`，与 Raycast / Spotlight / 系统弹窗统一。
**注意**：执行中按 Esc 应是"停止任务"而非关窗（参考 Cursor）；空闲态才关窗。

### 7. Overlay 不支持点击外部关闭
**位置**：[src/desktop/renderer/overlay.js:234-242](src/desktop/renderer/overlay.js#L234-L242) 只挂了 drag handler。
**期望**：监听 window blur 或 mousedown 落在浮窗外，调用 `hideWindow("overlay")`。Raycast / Alfred / macOS 通用行为。
**注意**：要给"音频/录屏中"留例外，避免用户切窗导致录制中断。

### 8. 任务执行中没有"停止"按钮
**位置**：Console 与 Overlay 都没有。
**期望**：任务运行时把 Send 图标替换为 Stop（红色方块），点击调用 `task/cancel`。ChatGPT、Claude、Cursor 全部如此。
**实现**：复用 [overlay.js:1184-1241](src/desktop/renderer/overlay.js#L1184-L1241) 的 timeline 状态——其结束态判断已存在，扩展为渲染按钮。

### 9. 流式输出无视觉反馈
**位置**：`appendConsoleChatTextDelta` 直接追加文本。
**期望**：流式期间在最新 assistant bubble 末尾追加打字光标 `▍`（CSS 闪烁），生成结束移除。或在头像位置显示"正在输入…"指示。

### 10. 消息无时间戳
**期望**：每条消息悬停时显示完整时间，连续消息（< 5 分钟）共享一个时间戳头。WeChat / Telegram / ChatGPT / Claude 都是这个模式。

---

## P1 — 体验提升（聊天功能补齐）

### 11. 重新生成 / 编辑 / 删除消息
- 当前只有 Copy / + Note（[console.js:600-655](src/desktop/renderer/console.js#L600-L655)）
- 至少补**重新生成**（assistant 消息悬停按钮）和**编辑用户消息**（最后一条 user 消息可改后重发）

### 12. 滚回底部按钮
- 当用户向上滚动 > 一屏时，右下角出现"⬇ 回到最新"按钮
- 收到新消息时若用户已离开底部，不要强制 scrollTop——只闪烁按钮上的红点

### 13. 失败步骤补 retry，结果补 copy
**位置**：[src/desktop/renderer/overlay.html:405-499](src/desktop/renderer/overlay.html#L405-L499) 的 `.bubble.step`
- 红色 fail 边的 step 加 retry 按钮
- 展开后的工具结果右上角加 Copy 按钮

### 14. 拖拽到聊天区缺视觉反馈
- 当前只有 voice card 内有 drop highlight
- 主 chat / overlay input 拖入文件时无任何 dashed-border 提示
- 配合 [drop-guard.js](src/desktop/renderer/drop-guard.js) 增加全局 dropzone 蒙层

---

## P1 — 事件流（控制台排版）

### 15. 思考卡片默认折叠改为执行期间默认展开
**位置**：[overlay.js:1426](src/desktop/renderer/overlay.js#L1426) `closeActiveThinkingCard`
- 当前：流式时短暂展开，结束后立即折叠
- 期望：执行期间保持展开（用户能看到 AI 在想什么）；任务结束 + 用户已滚到底部时再自动折叠
- Claude / Cursor 都是这个节奏

### 16. 进度信息缺分母
**位置**：[task-event-stream.js:96](src/desktop/renderer/task-event-stream.js#L96) 显示 `· 45%` 但没有 `第 3/7 步`
- 修改 `formatTaskEventSummary` 接受总步数，输出 `步骤 3/7 · 45%`

### 17. 加阶段标签
- 把零散的 `tool_call_started` / `tool_call_completed` 聚合为语义阶段：**Planning → Executing → Finalizing**
- Timeline 头部显示当前阶段而不是 `执行中…`

### 18. 步骤摘要 80 字符硬截断没有展开按钮
**位置**：[overlay.html:405-499](src/desktop/renderer/overlay.html#L405-L499)
- 截断处加 `…查看全部`，点击展开完整 args/result

### 19. 嵌套滚动疲劳
**位置**：[overlay.js:1219](src/desktop/renderer/overlay.js#L1219) timeline body `max-height: 160px` 独立滚动
- 改为：折叠时高度 0；展开时不限高，由外层 bubbleArea 统一滚

### 20. 事件流缺时间戳
- 每个 step 卡片右上角小字显示 `12:34:56` 或相对时间 `+2.3s`
- 用户能看出哪一步耗时最长

---

## P2 — 长尾打磨

- **历史会话快速切换**：Conversations tab 现在是只读浏览，加"继续这条对话"按钮直接续聊
- **消息反馈**：assistant 消息加 👍 / 👎，feed 进 telemetry
- **右键上下文菜单**：消息右键 → Copy / Quote / Regenerate / Report
- **输入框 @ 与 / 命令**：@ 触发上下文选择（文件/对话），/ 触发 prompt 模板
- **附件 inline 预览**：图片缩略图 / PDF 首页 / CSV 前 5 行
- **Toast 通知系统**：当前依赖 `window.ucaShell?.notify`，console 内无原生 toast 容器，错误反馈不显眼

---

## 不在本计划范围

以下 Codex 与本次走查均确认通过、无需改动：

- 左 rail 信息架构（9 个 tab + 折叠 + aria-current）
- 命令面板的快速动作 + 最近列表（Ctrl+K）
- 快捷键 cheatsheet 的覆盖（Enter / Shift+Enter / Ctrl+K / Esc / Ctrl+Shift+V / Ctrl+/）
- 工具步骤的左侧色条状态语言（紫=待定 / 绿=成功 / 红=失败）
- Dock 球的 5 种状态动画
- 已通过的验证脚本：`verify:console-ui` `verify:desktop-renderer` `verify:console-rail` `verify:ui-polish` `verify:design-system` `verify:a11y` `verify:connectors-page` `verify:chat-composer` `verify:foldable-sections` `verify:external-surfaces`

---

## 建议的实施批次

| 批次 | 内容 | 预期工作量 |
|---|---|---|
| Batch 1 | P0 真实 bug（条 1-5） | 半天，纯定向修复 |
| Batch 2 | Esc + 点外部关 + 停止按钮（条 6-8） | 1 天 |
| Batch 3 | 流式光标 + 时间戳 + 滚回底部（条 9, 10, 12） | 1 天 |
| Batch 4 | 事件流四件套（条 15-18） | 1-2 天 |
| Batch 5 | P1 聊天功能补齐（条 11, 13, 14, 19, 20） | 2 天 |
| Batch 6 | P2 长尾 | 按需 |

每批完成后跑一遍现有 `verify:*` 脚本 + 修复后的 `verify:palette` `verify:tasks-page`，并补 1-2 个针对新行为的断言（如 Esc 关闭、停止按钮存在）。
