# IA Phase 2 实施计划

> 用户拍板：会话进 Chat tab，Project 单独保留，因为它们代表不同的事。

---

## 用户原话拆解

> "看看怎么整合一下 conversation 直接到 chat 里，project 单独存放 project。
> 感觉还是得把会话和 project 分开。project 和会话代表的事情不一样。"

读出来的意图：

- **Conversation = 一段对话** → 应该在 **Chat** tab 里直接能浏览/切换
- **Project = 工作空间容器** → 单独保留 Projects tab，承载项目级管理（创建、命名、绑定 schedule / routing / memory 等）
- **不要把两者揉在同一个 tab 里**

跟我之前 Phase 2 设计里的"Chat 加项目侧栏，Projects tab 退役"不一致。**改方案**：

---

## 新方案

### Chat tab 加入对话侧栏（左 280px）

```
┌──────────────────────────────────────────────────┐
│  Chat 对话                       [+ New chat]   │
├──────────────────────────────────────────────────┤
│ ┌──────────────┬─────────────────────────────┐ │
│ │ 搜索…         │  消息流（现有 chat-shell）  │ │
│ │              │                              │ │
│ │ • 红酒历史   │                              │ │
│ │ • 翻译英文   │                              │ │
│ │ • 总结合同   │   [输入框]    [Send]         │ │
│ │ • 帮我写邮件 │                              │ │
│ │   …          │                              │ │
│ └──────────────┴─────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

侧栏：
- 顶部：搜索输入框 + "+ New chat" 按钮
- 列表：所有 conversations（按 updated_at 倒序）
- 每条：title + 消息数 + 相对时间
- 点击 → 加载到右边 chat-shell（复用 `loadConsoleConversationFromBackend`）
- 当前 active 高亮
- **不**按 project 分组——project 的视图在 Projects tab 里

### Projects tab 保持，但精简

- 退役 "Preview" 第三列（Chat tab 现在承担会话预览）
- 中列保留 "本项目下的对话"，每行带 ↗ Resume 按钮（已经有）
- 加 "拖拽 / 移动到项目" 是后续 polish，不是这次必做

### Conversations tab

继续保持隐藏（`hidden` attribute）。

---

## 实施步骤

### Step 1 — DOM 改造 `#panel-chat`

把现有的：
```html
<section id="panel-chat" class="tab-panel">
  <header class="page-head">…</header>
  <section class="panel console-chat-panel">
    <div class="console-chat-shell">…</div>
  </section>
</section>
```

改成：
```html
<section id="panel-chat" class="tab-panel">
  <header class="page-head">…</header>
  <div class="chat-layout">
    <aside class="chat-sidebar panel">
      <header class="chat-sidebar-head">
        <strong>Conversations</strong>
        <button id="chatNewBtn">+ New</button>
      </header>
      <div class="chat-sidebar-search">
        <input id="chatSidebarSearch" placeholder="搜索对话…" />
      </div>
      <div id="chatSidebarList" class="chat-sidebar-list"></div>
    </aside>
    <section class="panel console-chat-panel">
      <div class="console-chat-shell">…现有结构不动…</div>
    </section>
  </div>
</section>
```

### Step 2 — CSS

```css
.chat-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  height: 100%;
  min-height: 0;
}

.chat-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.chat-sidebar-head { display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border-bottom:1px solid var(--line); }
.chat-sidebar-search { padding:8px 12px; border-bottom:1px solid var(--line); }
.chat-sidebar-search input { width:100%; ... }
.chat-sidebar-list { flex:1; min-height:0; overflow-y:auto; padding:6px; }
.chat-sidebar-item { ... 行 layout，hover/active 样式 ... }
```

### Step 3 — JS

新增：
- `renderChatSidebar()` —— 拉 `/conversations`，渲染列表
- 搜索输入 → debounce 过滤
- "+ New" → 调 `clearConsoleActiveConversation()` + 清空 messages 容器
- 每条点击 → `loadConsoleConversationFromBackend(id)`
- 当前 active 用 `consoleActiveConversation?.conversation_id` 高亮
- 切到 chat tab 时自动 `renderChatSidebar()`

### Step 4 — Projects tab Preview 列退役

把 `<section class="projects-col panel">` 第三列（`#projectConversationPreview`）删掉。中列继续。

### Step 5 — 验证

跑 13 个 verify 脚本。给 `verify:ui-extras` 加几条断言：
- `#chatSidebarList` 存在
- `#chatNewBtn` 存在
- `renderChatSidebar` 函数存在

---

## 不在本次范围

- 拖拽对话到项目（Project tab 的"移动到项目"动作）
- 项目级 settings（routing / memory / schedules 绑定）
- Tasks tab 内的 Recent Conversations 面板继续保留（Chat 侧栏是更主要入口，但 Tasks 空状态那个还是有用）

---

## 风险

| 风险 | 缓解 |
|---|---|
| `.console-chat-shell` 改动后高度链断 | 现有 `#panel-chat.active { height: calc(100vh - var(--topbar-height)) }` 不变；新增的 `.chat-layout { height: 100% }` 顺着继承下去 |
| 旧的 Chat tab 没有侧栏，用户重启后侧栏空白让人困惑 | 加搜索框 placeholder + "+ New" 按钮高亮，列表为空时显示 "还没有对话，点 + New 开始" |
| 同一个 conversation 被同时在 overlay 和 console 编辑 | Phase 4 设计里专门讲过——本次先不动，已存在的 race-guard 继续用 |

---

## 计划完成后的体验

- 用户打开 Chat：左边一眼看见所有过往对话，右边是当前会话
- 想搜旧的："翻译" → 输入框过滤
- 想新开一段：点 "+ New"
- 想看哪些是属于"红酒研究"项目的：去 Projects tab → 点 "红酒研究" → 中列展示该项目的对话
- 想按运行状态查任务：Tasks tab（不变）

三个 tab 的职责终于不重了：
- **Chat** = 当下在聊什么 + 历史浏览
- **Projects** = 把对话装进项目桶里管理
- **Tasks** = 任务运行状态监控
