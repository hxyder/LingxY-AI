# UCA-033: UI 重设计 — 玻璃风格 & 气泡交互

> **状态**：`done`
> **依赖**：UCA-027, UCA-028, UCA-029, UCA-030, UCA-031, UCA-032
> **分支**：`task/uca-033-ui-redesign`

## 背景

当前 UI 存在以下核心问题：
- **配色丑陋**：暖橙/棕色系（`#d96b33`, `#8e2f14`），过时且视觉压迫
- **Dock 图标过大**：132×152px 大圆球 + 呼吸/光环动画，视觉占用过多
- **Overlay 过于复杂**：Hero + 气泡流 + 三组选择面板 + 双列网格 + 结果预览 + Artifact中心 + 时间线，一个浮窗塞了整个应用
- **Console 结构混乱**：10 个功能区平铺在一个长滚动页面，信息层级不清
- **交互模式不对**：当前是"填表单提交"式，不是对话式

## 设计目标

1. **Dock** → 36×36px 迷你悬浮球，单击打开输入条，双击打开控制台
2. **Overlay** → 屏幕底部居中的玻璃输入条，上方按需展开气泡对话区
3. **对话引导** → 所有选项（格式、动作等）通过气泡问答按需出现，不预设面板
4. **任务通知** → 完成后弹出角落气泡，点击展开结果
5. **Console** → Tab 导航（任务/历史/设置），一次一个视图，结构清晰

## 修改范围

### Phase A：设计系统重写
- **文件**：`src/desktop/renderer/shared.css`
- **变更**：
  - 颜色系统：从橙棕暖色 → 中性冷灰 + 蓝紫accent
  - 玻璃效果：`backdrop-filter: blur(20px)` + 半透明白色背景
  - 阴影：从棕色阴影 → 中性灰柔和投影
  - 圆角：统一 16px，气泡 12px
  - 按钮：从橙色渐变 → 蓝紫渐变 primary + 玻璃 secondary
  - 去掉 body::before 网格纹理

### Phase B：Dock + Overlay 重做
- **文件**：
  - `src/desktop/renderer/dock.html` — 缩小为 36×36 迷你球
  - `src/desktop/renderer/overlay.html` — 重写为底部气泡输入条
  - `src/desktop/renderer/overlay.js` — 改为对话流引导逻辑
- **变更**：
  - Dock：去掉呼吸动画、光环旋转、LIVE DOCK 标签，简化为迷你图标
  - Overlay：砍掉 Hero 区、三组选择面板、双列上下文网格、Artifact中心、Session时间线
  - 新增：底部输入条 + 上方气泡对话区，选项以气泡内按钮形式出现
  - 保留：核心提交逻辑、shell handoff、event stream、artifact/result 处理

### Phase C：Console 重构
- **文件**：
  - `src/desktop/renderer/console.html` — Tab 导航替代滚动堆叠
  - `src/desktop/renderer/console.js` — 分区切换逻辑
- **变更**：
  - Sidebar：砍掉品牌大球、10个导航按钮 → 简洁图标 Tab
  - 内容区：一次只显示一个 Tab，不再堆叠 10 个 section
  - 核心 Tab：任务、历史、设置
  - 高级功能（DAG、模板、预算）折叠到设置子页

## 验收标准

- [x] shared.css 配色为冷灰玻璃风格
- [x] Dock 为 40px 迷你球，单击/双击区分
- [x] Overlay 为底部居中输入条 + 气泡对话
- [x] Console 为 Tab 切换式布局 (Tasks / History / Schedules / Advanced / Settings)
- [x] 所有现有功能逻辑不丢失（提交、handoff、event stream 等）

## 实际修改的文件

| 文件 | 变更类型 |
|------|----------|
| `src/desktop/renderer/shared.css` | 全量重写 — 新色系、新玻璃效果、新按钮样式 |
| `src/desktop/renderer/dock.html` | 全量重写 — 从 152px 大球改为 40px 迷你浮球 |
| `src/desktop/renderer/dock.js` | 小改 — 新增双击打开 console 逻辑 |
| `src/desktop/renderer/overlay.html` | 全量重写 — 底部气泡输入条 + 右下角通知 toast |
| `src/desktop/renderer/overlay.js` | 全量重写 — 对话流引导，保留所有核心 submit/handoff/event-stream 逻辑 |
| `src/desktop/renderer/console.html` | 全量重写 — 顶栏 + Tab 导航 (5 tabs)，不再平铺滚动 |
| `src/desktop/renderer/console.js` | 全量重写 — 新增 tab 切换，保留所有 workspace/render 逻辑 |
| `src/desktop/shared/manifest.mjs` | overlay 窗口改为 600x520；dock 缩小为 56x56；新增 moveWindowBy IPC 通道 |
| `src/desktop/tray/electron-main.mjs` | overlay 改为 frameless+transparent；showWindow 时定位到屏幕底部居中；新增 moveWindowBy IPC handler |
| `src/desktop/renderer/preload.cjs` | 新增 moveWindowBy API |
| `src/service/core/browser-submission.mjs` | 新增 Kimi CLI 直接执行支持（browser 提交路径） |
| `src/service/core/context-submission.mjs` | 新增 Kimi CLI 直接执行支持（context 提交路径） |
| `src/service/executors/kimi/output-format.mjs` | 新增 conversational 输出格式检测，默认对话式回复 |
| `src/service/executors/kimi/task-package-builder.mjs` | conversational 模式下 save_required=false |
| `src/service/executors/kimi/print-mode-prompt.mjs` | conversational 模式使用简洁对话式 prompt |
| `src/service/executors/kimi/kimi-cli-executor.mjs` | conversational 模式发 inline_result 事件而非写文件 |
| `src/desktop/renderer/task-event-stream.js` | 新增 inline_result 事件摘要 |
| `phases/tasks/TASK_INDEX.md` | 新增 UCA-033 行 |
| `phases/tasks/33_ui_redesign_glass_bubble.md` | 本文件 |
