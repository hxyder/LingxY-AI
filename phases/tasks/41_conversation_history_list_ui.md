# Task UCA-041 — 项目（Projects）、会话历史列表 UI 与多会话管理

## 1. 任务目标

把 UCA-038 的"单一持久化 conversationState"扩展为一套完整的 **项目 + 会话** 组织模型：用户可以创建 / 选择 / 切换项目（例如"读论文"、"写周报"、"邮件助手"），每个项目下有多条会话，每条会话下有多轮对话。Overlay 能列出当前项目下的会话，点击恢复；Console 能看所有项目与会话的树状总览。

## 2. 前置依赖

- 上一个任务：UCA-038（单会话记忆 + 新会话按钮 + 持久化）、UCA-030（overlay session timeline）、UCA-024（console workspace）
- 必须已有的产物：`conversationState` schema、`persistConversation`、`restoreConversation`
- 不能同时修改的区域：service 端任务执行模型；允许新增轻量 `/projects/store` 配置端点作为跨窗口共享源

## 3. 实施范围

- 负责模块：localStorage schema 升级到 v3（加入 projects 层）、Overlay 项目/会话切换 UI、Console Projects Tab、会话标题生成、恢复会话到 bubble 流
- 允许改动文件/目录：`src/desktop/renderer/overlay.html`、`src/desktop/renderer/overlay.js`、`src/desktop/renderer/console.html`、`src/desktop/renderer/console.js`、`src/service/core/http-server.mjs`、`src/service/core/service-bootstrap.mjs`、`scripts/verify-overlay-composer.mjs`、`scripts/verify-desktop-renderer.mjs`
- 明确不做：跨设备同步、云端备份、协作编辑

## 4. 交付产物

- **Projects store v3（projects + sessions）**：服务端通过 `/projects/store` 持久化到 runtime config；Overlay / Console 各自保留 localStorage 缓存作为离线兜底，但跨窗口同步以服务端 store 为准。
  ```json
  {
    "currentProjectId": "proj_default",
    "currentConversationId": "conv_xxx",
    "projects": [
      {
        "id": "proj_default",
        "name": "默认",
        "color": "#6366f1",
        "createdAt": 1700000000000,
        "metadata": { "description": "", "defaultSeedCommand": null }
      }
    ],
    "conversations": [
      {
        "id": "conv_xxx",
        "projectId": "proj_default",
        "title": "翻译 OpenAI 论文摘要",
        "seedCapture": { ... },
        "seedCommand": "...",
        "turns": [ ... ],
        "startedAt": ...,
        "updatedAt": ...
      }
    ]
  }
  ```
- **v1 / v2 → v3 迁移逻辑**：启动时检测旧 schema，自动把旧单会话塞到默认项目下
- **Overlay toolbar 新增 "项目" 下拉**：显示当前项目名 + 切换 + 新建项目；下拉内嵌"本项目最近会话"列表
- **Overlay toolbar 新增 "历史" 按钮**：列出当前项目的所有会话，按 `updatedAt` 倒序，可搜索、删除
- **Console Projects Tab**（新 tab）：左栏项目列表 + 右栏当前项目的会话列表 + 最下方会话详情预览；支持创建项目 / 重命名 / 删除项目（带确认）
- **会话标题自动生成策略**（三层候选）：
  1. LLM 生成 —— 用第一个 user turn 作为 prompt，让 fast executor 生成 ≤15 字标题
  2. seedCommand 前 30 字
  3. 第一个 user turn 前 30 字
- **点击会话** → 恢复到 bubble 流 + 切换 currentConversationId + `renderConversationFromState()` 重新绘制所有 turns 为气泡
- **关闭 overlay 再打开** → 默认回到 `currentConversationId` 对应的会话（修复 UCA-038 遗留缺陷：关闭后气泡不见了）
- **自动清理阈值**：每个项目最多保留 50 条会话，超出后按 `updatedAt` 淘汰最老的；单条会话压缩由 UCA-038 的 `compressIfNeeded` 负责

## 5. 验证方式

- `node scripts/verify-overlay-composer.mjs`（新断言：schema v3 / `renderConversationFromState` / `projectSelector`）
- `node scripts/verify-desktop-renderer.mjs`（新断言：Console Projects Tab 存在）
- 手动场景：
  - 新建项目 "论文阅读" → 聊两轮翻译 → 切到项目 "周报" → 再聊一轮 → 切回 "论文阅读" → 看到气泡完整恢复
  - 关闭 overlay → 重开 → 自动回到最后一次打开的项目 + 会话，气泡渲染出来
  - 删除项目 → 确认后项目消失 + 其下会话全部删掉
  - 会话 > 50 个时 → 旧的自动清理

## 6. Git 执行方式

- 分支名：`task/uca-041-projects-and-history`
- Commit 格式：`UCA-041: projects + multi-conversation history UI`
- 合并条件：
  - 用户能在 UI 里看到并切换项目与会话
  - schema v1/v2 自动升级到 v3
  - 关闭 overlay 不再丢气泡流
  - Console Projects Tab 可用

## 7. 完成后必须更新本文件

- 列出 schema v3 详细格式
- 列出自动清理阈值（每项目最大会话数 / 全局最大总大小）
- 列出标题生成策略
- 列出项目颜色与 UCA-046 schedule 颜色共享的调色板

## 8. 对下一个任务的交接

- 下一个任务：Console 全局搜索（跨项目 / 会话 / artifact 的统一搜索）
- 本任务新增了什么：项目 + 多会话 UI 与切换
- 下一个任务直接可复用什么：v3 schema、`renderConversationFromState()`、项目树渲染组件
- 还没解决的问题：跨窗口同步、项目合并 / 拆分、分享 / 导出、多人协作

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：把 UCA-038 的单一 `conversationState` 升级为唯一的 projects/sessions 存储模型；Overlay 和 Console 都读写同一 v3 schema，迁移逻辑只在启动时执行一次，历史恢复统一调用 `renderConversationFromState()`。2026-04-11 修正为服务端 `/projects/store` 做共享源，renderer localStorage 只做缓存，避免 Console 与 Overlay 不同 origin 导致项目不同步。
- 当前代码对齐点：`src/desktop/renderer/overlay.js` 当前持久化 key 是 `uca.overlay.conversation.v1`，Console 已有 tab 布局和 Files/Schedules 等模式；需要新增 Projects tab，而不是把项目 UI 嵌进已有 History 搜索。项目颜色要与 UCA-046 的 schedule category palette 共用。
- 可能需要生成的文件：不新增 service 文件；需要扩展 `src/desktop/renderer/overlay.html`、`src/desktop/renderer/overlay.js`、`src/desktop/renderer/console.html`、`src/desktop/renderer/console.js`，并更新 `scripts/verify-overlay-composer.mjs`、`scripts/verify-desktop-renderer.mjs`。

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-11
- 完成日期：2026-04-11
- 实际新增内容：
  - overlay.js — 完整 v3 storage schema（`uca.overlay.projects.v3`）：`{currentProjectId, currentConversationId, projects[], conversations[]}`
  - v1→v3 自动迁移（`migrateV1ToV3`）：读取旧 key、包进默认项目、删旧 key
  - `loadProjectStore / saveProjectStore / ensureDefaultProject` — 初始化 + 持久化 + 默认项目保障
  - `switchConversation / switchProject / createProject / deleteProject / deleteConversation / listConversationsForCurrentProject` — 多项目多会话管理 API
  - `generateConversationTitle` — 从第一个 user turn 截前 30 字自动生成
  - `MAX_CONVERSATIONS_PER_PROJECT = 50` — 超出按 updatedAt 淘汰最老
  - overlay.html — `#projectPanel`（项目下拉 + 新项目按钮 + 历史会话列表）、`#projectSelectorBtn` 工具栏按钮
  - overlay.js — `renderProjectPanel`（项目下拉 + 历史列表 + 删除按钮 + 点击切换）
  - console.html / console.js — 新增 Projects Tab：读取同一 projects store，显示项目列表、当前项目会话列表与会话预览，并支持创建项目
  - service/http-server.mjs — 新增 `GET/POST /projects/store`，把 `{currentProjectId,currentConversationId,projects[],conversations[]}` 持久化到 runtime config 的 `ui.projectStore`
  - overlay.js / console.js — 增加 `syncProjectStoreFromService` / `syncConsoleProjectStoreFromService`，窗口启动、聚焦、切到 Projects tab、创建/选择项目时同步到服务端；Console 选择项目会更新 store 的 `currentProjectId`，Overlay 后续提交的会话会落到该项目下
  - UCA-038 bug fix：`refreshActiveTask` 任务终态后重置 `conversationPhase = "idle"`（修复新会话后用户气泡不显示）
- 验证结果：`verify-overlay-composer` 覆盖 v3/project panel/`renderConversationFromState` + `/projects/store` 同步；`verify-desktop-renderer` 覆盖 Console Projects Tab + 服务端同步；额外 HTTP smoke 验证 `GET/POST /projects/store`
- schema v3 格式已列出（§4）
- 自动清理阈值：每项目最多 50 条会话
- 标题生成：第一个 user turn 前 30 字 → seedCommand 前 30 字 → "新会话"
- 2026-04-11 追加修复：
  - 用户反馈："控制台创建了一个新项目，但是在对话框里看不到"。根因是 Console 与 Overlay renderer 的 localStorage 不是可靠共享源；已改为服务端 `/projects/store` + 本地缓存。
  - 用户反馈："确保我如果选择了项目，相关的会话能生成在项目下"。Overlay 的 `ensureConversation` 继续以 `projectStore.currentProjectId` 建会话；Console/Overlay 项目选择现在会同步 `currentProjectId`。
- 遗留问题（开工前已识别）：
  - 用户反馈（2026-04-11）：关闭 overlay 后看不到之前的对话（UCA-038 的 `restoreConversation()` 只恢复 state，不重新渲染气泡）—— 本任务的 `renderConversationFromState()` 负责修复
  - 用户需求（2026-04-11）："对话框还需要加项目，以及历史会话" —— 原 UCA-041 只覆盖历史，本次扩展加入项目层
  - 项目颜色应该和 UCA-046 的 schedule 类别颜色共享一套调色板，避免视觉冲突
- 交接给下一个任务：
