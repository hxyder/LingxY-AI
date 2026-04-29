# IA / 存储重构思考

> 用户反馈：Tasks / Conversations / Projects 三个 tab 内容重复，存储是不是该重新整理一下。

---

## 现状盘点

### 实际数据模型（已经是合理的层级）

```
Project (用户自定义的 bucket，可选)
  └── Conversation (一段对话)
        ├── Message[] (user/assistant/system)
        └── Task[]    (每条 assistant 回复对应一次 agent 运行)
              ├── Event[]    (step_started, tool_call_*, ...)
              └── Artifact[]
```

后端 sqlite 已经按这个层级建表（`projects` / `conversations` / `conversation_messages` / `message_task_links` / `tasks` / `task_events` / `task_artifacts`）。**底层模型不重复**。

### UI 三个 tab 的实际作用

| Tab | 真正展示的东西 | 问题 |
|---|---|---|
| **Tasks** | 所有 task 按时间倒序（每条 prompt 都是一个 task） | 把"每次发问"暴露成顶层导航；新用户看到 60 条同质化任务行不知道哪条是哪次对话 |
| **Conversations** (已隐藏) | 后端 conversations 表的只读浏览 | 跟 Projects 的中间列重复 |
| **Projects** | 项目桶 → 项目内对话 → 对话预览（三列） | 又是一种对话浏览的姿势；跟 Conversations 数据相同，只是多了一层项目分组 |

**用户的"重复"体感来源**：Conversations 和 Projects 中间那列**展示的是同一个 SQL 表**，UI 给了两条路径打开它。Tasks 又把内部细节（每个 task）当导航主菜单。

### 真正的冗余在 *存储* 层

#### 冗余 1：前端 `projectStore` 缓存了对话 turns 的整副本

后端 SQL 已经是 source of truth，但前端 `projectStore`（localStorage + `/projects/store` 同步）里每个 conversation 还带一个 `turns[]` 数组：

```js
// 前端 cache
{
  id: "conv_xxx",
  projectId: "...",
  turns: [{ role: "user", content: "..." }, ...],  // ← 整副本
  updatedAt: "...",
}
```

带来的问题：
- 跨窗口可能漂移（overlay 写一条，console 没刷新就也写一条）
- Cache 成本随对话长度线性增长
- `reconcileConversationFromBackend` 那段 race-guard 代码就是为了治这个漂移

#### 冗余 2：`conv_auto_*` 合成对话

scheduler-sourced 的任务（每天的邮件摘要、定时任务）在前端**合成**一个 `conv_auto_<taskId>` 的对话本地塞进 projectStore。后端 SQL 里**没有这条 conversation**。

带来的问题：
- 切到这个"对话"时 backend 回 404，前端要绕过去用本地 turns
- 后端永远不知道这些 task 属于哪段"会话"，分析不到
- 列表里同一段时间内出现 5 个 `conv_auto_*` 看起来很乱

#### 冗余 3：`task.conversation_id` vs `message_task_links` 双轨

任务带 `conversation_id` 字段（直连 conversation），同时还有 `message_task_links` 表（链接 message → task）。在多数路径里两者一致，但 `message_task_links` 才是更细粒度的单源（一条 message 可能触发多个 task，比如澄清后重发）。

---

## 提议的整改（分阶段）

### Phase 1（已做）

✓ 隐藏顶层 Conversations rail（保留 panel 用于 deep link / debug）
✓ 在 Tasks tab 空状态里填 Recent conversations
✓ 在 Projects tab 给每个对话行加 ↗ Resume 按钮
✓ 自动起对话标题

### Phase 2 — Chat 成为主导航（UI 层）

把 Chat tab 改造成像 Claude Desktop / ChatGPT 桌面那样：

```
┌──────────────────────────────────────────────────┐
│  ← Sidebar (collapsible)        Chat thread     │
│                                                  │
│  ▾ 红酒研究 (project)            [输入框 + 发送]  │
│    • 红酒历史的几个时期           [对话内容]      │
│    • 法国 vs 意大利产区差异                       │
│  ▾ 默认 (no project)                             │
│    • 帮我总结这份合同                             │
│    • 翻译这段英文                                 │
│  ─────────────────                               │
│  [+ New chat]                                    │
│                                                  │
└──────────────────────────────────────────────────┘
```

- Sidebar 左侧分组按 project 折叠展开
- 每个 project 可以拖拽对话进出
- 拖到 "默认" / 删除 project 等操作就地完成
- **Projects tab 可以彻底退役**（功能并入 Chat 侧栏 + 一个 "Manage projects" modal 处理重命名/删除/批量整理）

### Phase 3 — Tasks tab 改名 "Activity"，定位调整

Tasks tab 不再当主导航，改成**操作监控视图**：
- 主要给"哪些任务在跑/失败/排队"用
- 高级用户用来 debug / retry / cancel 单个 task
- 对普通用户来说，95% 时间不需要打开它（点 chat 答案上的"重新生成"已经够用）

### Phase 4 — 存储简化

#### 4a. 前端 projectStore 卸载 turns

只保留 conversation **元信息**（id、projectId、title、updatedAt、taskCount、messageCount）。turns 永远从后端取，不缓存。代价：每次切换对话有一次 HTTP，收益：cache 漂移问题彻底消失，前端代码大幅瘦身（`reconcileConversationFromBackend` 的 race-guard 一半可以删）。

#### 4b. 退役 `conv_auto_*` 前端合成

scheduler-sourced 任务直接走后端 conversations 表。SQL 加 `conversations.metadata.scheduler_sourced = true` 字段，前端列表渲染时按这个字段在 sidebar 里分一组（"自动 / 定时"）。

迁移成本：要给历史的 `conv_auto_*` 数据写迁移脚本（或留着旧的本地数据自然过期）。

#### 4c. `task.conversation_id` 字段考虑收紧

不删（写入路径多，删了麻烦），但**所有读路径**优先走 `message_task_links` 表，`task.conversation_id` 仅作为冗余校验。

---

## 风险与依赖

| 风险 | 缓解 |
|---|---|
| Phase 2 sidebar 改造会触动 Chat tab 大量代码 | 可以增量做：先在现有 Chat tab 顶部加一个 "Recent / All" 切换，第二步引入 sidebar，第三步退役 Projects tab |
| 退役 `conv_auto_*` 会让现有用户的本地数据丢标识 | 加一个一次性迁移逻辑：检测到 `conv_auto_*` id 时尝试从后端 task 反查 conversation；查不到的留在本地兼容模式 |
| 卸 projectStore.turns 后 overlay 离线体验受影响 | 离线场景本来就有限（后端不可用时也没法发任务）；用 service-worker 或 IndexedDB 做更精细的离线缓存比目前的 turns 内存副本更合理 |

---

## 立即可做 vs 需要评审

**立即可做（不需要架构评审）**：
- 把 Chat tab 的输入区上方加一行 "继续 / 新对话" 切换 + 当前对话标题（让用户随时能看到自己在哪段对话里）
- Projects tab 三列改成两列（去掉只读的 "Preview" 列；点击 conversation 直接跳 Chat tab + 加载）

**需要先讨论**（影响数据迁移）：
- Phase 4 的存储简化（projectStore 瘦身、退役 `conv_auto_*`）

---

## 一句话结论

**底层模型本来就 OK，UI 把同一份数据切成了三个 tab 来看。** 把 Chat 做成主导航 + 把 Tasks 降级为 Activity，三个 tab 自然合并成一个。存储层的具体冗余只在前端 projectStore 那里，可以瘦身但不紧急。
