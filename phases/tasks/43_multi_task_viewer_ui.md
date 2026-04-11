# Task UCA-043 — Overlay / Console 多任务输出查看 UI（数字 badge + 右下角 todo list 图标）

## 1. 任务目标

给 Overlay 加一个一眼能看到"当前有几个任务在跑、分别到了哪一步、结果分别是什么"的 UI：
- 对话框内的气泡上出现数字 1/2/3... 快捷 badge，点击切到对应子任务的结果
- 右下角有一个固定的 📋 todo list 图标，展开后是一个可滚动的任务清单面板（类似 macOS 通知中心）
- Console 侧同步支持切换子任务详情

## 2. 前置依赖

- 上一个任务：UCA-032（live task progress）、UCA-031（artifact center）、UCA-042（multi-intent decomposition）
- 必须已有的产物：parent/child task schema、task-event-stream.js、artifact 气泡
- 不能同时修改的区域：task 事件主干

## 3. 实施范围

- 负责模块：Overlay 多任务 badge + 面板、右下角 todo list 浮标、子任务结果路由
- 允许改动文件/目录：`src/desktop/renderer/overlay.html`、`src/desktop/renderer/overlay.js`、`src/desktop/renderer/console.js`、`scripts/verify-overlay-composer.mjs`
- 明确不做：改 parent/child 数据模型（UCA-042 负责）、多窗口编排

## 4. 交付产物

- **Overlay 数字 badge**：parent task 的气泡头部显示 `[1][2][3]` 小 badge，对应每个 child task。点击 badge → 切换 bubble area 显示对应 child 的进度和结果
- **右下角 todo list 图标**（#taskListDock）：
  - 固定在 overlay 右下角 26×26 小图标
  - 显示"未完成任务"数量徽章
  - 点击展开一个面板：列出最近 10 个 parent / 独立任务，每行显示：标题 / 进度圈 / 状态 chip / 跳转按钮
  - Panel 有过滤："全部 / 进行中 / 已完成"
- **Overlay 子任务切换**：
  - 切换 active view 时保留 parent view（顶部面包屑："📦 复合任务 > #2 翻译"）
  - 每个子任务的 inline_result 单独渲染一列，右边还有 mini artifact 面板
- **Console 侧扩展**：任务列表对复合任务显示 tree 图标，展开后缩进显示子任务行；点击子任务直接切到子任务详情

## 5. 验证方式

- `node scripts/verify-overlay-composer.mjs`（新断言：`taskListDock` / `childBadgeRow` / `renderCompositeBreadcrumb`）
- `node scripts/verify-desktop-renderer.mjs`
- 手动：
  - 提交复合任务 → 看到 [1][2][3] badge → 点击切换 → 每个子任务都有独立 bubble
  - 右下角 📋 图标有红点 → 点击看清单 → 滚动 → 点某项跳转

## 6. Git 执行方式

- 分支名：`task/uca-043-multi-task-viewer`
- Commit 格式：`UCA-043: multi-task badge row + todo list dock`
- 合并条件：复合任务可视化清晰；数字 badge 和 todo list 图标都可点击切换

## 7. 完成后必须更新本文件

- 列出 badge 配色（和 UCA-041 project color、UCA-046 schedule color 共享调色板）
- 列出 todo list dock 面板的最大展示条数与分页策略

## 8. 对下一个任务的交接

- 下一个任务：Console 全局任务板 / Kanban view
- 本任务新增了什么：对话框 / Console 的多任务导航
- 下一个任务直接可复用什么：`renderCompositeBreadcrumb`、child badge 组件
- 还没解决的问题：跨窗口任务状态同步（Overlay 和 Console 不同时打开时）

## 8.1 实现对齐（2026-04-11）

- 实施方式（全局方案）：基于 UCA-042 的 parent/child schema 和 UCA-032 的 `task-event-stream.js` 渲染多任务导航；Overlay、Console 都从同一 task graph 读状态，数字 badge、todo list dock、Console tree row 只是同一数据的不同视图。
- 当前代码对齐点：`src/desktop/renderer/task-event-stream.js` 已提供事件摘要，UCA-031 的 artifact center 已能按任务展示结果；需要新增 child task active view 和 breadcrumb，不要复制 artifact 预览逻辑。
- 可能需要生成的文件：不新增 service 文件；扩展 `src/desktop/renderer/overlay.html`、`src/desktop/renderer/overlay.js`、`src/desktop/renderer/console.js`，更新 `scripts/verify-overlay-composer.mjs` 和 `scripts/verify-desktop-renderer.mjs`。

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题（开工前已识别）：
  - 用户需求（2026-04-11）："然后聊天框，不是对话框可以点击数字1234..或者是右下角一个todo 的list的图标，然后可以查看查看不同任务的产出"
  - 数字 badge 的位置、样式需要和 UCA-033/UCA-036 的 Apple 风格保持一致
- 交接给下一个任务：
