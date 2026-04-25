# Task 84 — Overlay / Console / Notes / Preview Upgrade

Status: `in_progress`
Owner: assistant (auto mode)
Created: 2026-04-25
Branch: current workspace

## 1. 背景

用户集中反馈 overlay、console、note、预览、输出策略之间的交互不连贯：浮窗控件遮挡、任务运行态不可见、邮件摘要卡片缺少详情入口、console 与 note 的继续追问/引用/预览不够顺手，以及 AI 在用户没有明确要求时过度生成文档。

本任务按 phase 处理，避免继续用局部补丁堆积 UI 逻辑。每个 phase 都要求有可验证的进度记录、改动范围与回归点。

## 2. Phase 划分

| Phase | 范围 | 用户问题 | 状态 |
|---|---|---:|---|
| 84.1 | Overlay shell ergonomics | 1, 2, 4, 5, 6, 7, 16 | `in_progress` |
| 84.2 | Notification/action contract | 3, 5 | `in_progress` |
| 84.3 | Output intent + follow-up flow | 8, 9, 10 | `planned` |
| 84.4 | File actions + live preview pipeline | 11, 14, 16 | `planned` |
| 84.5 | Notes editor 2.0 | 12, 13 | `planned` |
| 84.6 | Settings UX audit | 15 | `planned` |

## 3. 设计原则

- Overlay 只负责轻量交互；任务、通知、产物、note 元数据必须通过明确 payload 契约传递，不再靠按钮文案猜测。
- 自动任务、邮件摘要、手动任务使用统一 task visibility 规则：后台无人值守可静默，但有用户可感知结果或正在运行的任务必须能在 dock/对话入口看到。
- 默认输出优先返回在对话中；只有用户明确要求文件、导出、附件、文档格式，或 AI 判断必须持久化且先给用户选择时，才生成文件。
- Note 不只是富文本框：新增内容要带来源标题、任务链接/会话链接；链接和图片必须可点击；分享/邮件发送应复用统一导出契约。
- 预览 pipeline 要先统一能力检测和 fallback，再做 UI 美化，避免“看起来能预览但点不开”。

## 4. 执行记录

### 84.1 / 84.2 — 2026-04-25

- [x] 调整 overlay 拖动条、resize grip、任务 dock 布局，避免右下角控件重叠。
- [x] 将 quick toolbar 的“项目”改为“对话”，面板标题改为“对话与历史”。
- [x] 让 scheduler/email 等自动任务进入 overlay 任务列表与 dock 运行态。
- [x] 给任务 dock 和发送按钮增加运行中动画，体现任务正在执行。
- [x] 修复邮件摘要卡片只有“好”的问题，传递 artifactPath/inlinePreview 并显示预览、打开文件夹等动作。
- [x] 修复 console task artifact 的 Reveal/Open folder 调用不存在的 `revealInFolder` API。
- [x] Overlay assistant bubble 支持 Markdown 图片 `![alt](url)` 渲染，并复用可点击链接打开逻辑。
- [x] 修复 overlay 只能贴底横移：移动时按“至少保留 96px 可见区域”约束，而不是把整个透明窗口强制塞进屏幕。
- [x] 修复 notify 工具丢弃 action payload：保留 `taskId/artifactPath/inlinePreview/openWindow/allowLongBody/dedupeKey`。
- [x] 定时任务完成通知改为同 taskId 合并、长内容可滚动查看，并可打开 overlay 对话。
- [x] 自动任务完成后回灌到 overlay 对话历史；dock orb 不再过滤 scheduler/email 运行态。
- [x] Agentic planner 在 `artifact_required:false` 时不再暴露 `write_file/generate_document/edit_file`，从工具层阻止无明确要求时乱生成文件。
- [x] Overlay 支持本地图片路径预览，避免“不能直接以图片形式发送到聊天对话框”的错误回复继续出现。
- [x] 修复 overlay Markdown 链接渲染顺序，避免裸 URL 识别把已生成的 `<a>` / `<img>` 属性再次改坏。
- [x] 自动任务结果不再写入当前会话：schedule 归档到“定时任务”项目，email digest 归档到“邮件摘要”项目。
- [x] 自动任务按 schedule/email source 复用独立会话，后续运行追加到对应会话，并在未读时给项目/会话加红点。
- [x] 顶部卡片对 `allowLongBody + inlinePreview` 直接显示正文预览，不再只展示 md 文件入口。
- [x] 后端 fallback artifact 增加 `task_spec.artifact.required === true` 硬门槛，避免格式探测误判导致无明确要求时写文件。
- [x] 修复 RAG 记忆污染：跨任务语义记忆不再注入历史 artifact 路径/“已生成 PDF”等完成状态，并在 agentic prompt 中明确禁止把历史产物当成本次结果。
- [x] 邮件摘要默认改为 inline 交付，不再自动写 `email-digest-*.md`；如需恢复落文件可设置 `LINGXY_EMAIL_DIGEST_WRITE_FILE=1` 或 `runtime.settings.emailDigest.writeFile=true`。
- [x] 顶部卡片增加轻量 Markdown 渲染、选择复制、可滚动长预览，长正文上限从 80 行提高到 240 行。
- [x] 修复 schedule 触发但 source 仍为 console 的任务无法进入“定时任务”对话：识别 `selection_metadata.source_id=sched_*`，卡片“打开对话框”会直接归档并切换到对应自动任务会话。
- [x] Morning digest 的 feature 开关与 digest 设置开关联动；手动运行无账户/无邮件/功能关闭时也会给可见反馈卡片。

### 84.3 — planned

- [ ] 复查 TaskSpec/output policy，在无明确文件格式要求时默认只返回对话结果。
- [ ] 设计“需要输出为文件吗？”的交互式选择卡，避免 AI 擅自生成多种文档。
- [ ] 在 console 对话与 task detail 中提供“继续追问历史任务”入口。
- [ ] 增加默认存储路径一致性验证，覆盖定时任务、邮件摘要、agentic 文档产物。

### 84.4 — planned

- [ ] 修复 File 顶部 open folder 无反应。
- [ ] 梳理 live-preview client registry，统一图片、链接、Markdown、PDF、Office fallback。
- [ ] Console 产物预览支持直接预览与明确 fallback。

### 84.5 — planned

- [ ] 优化“添加到 Note”选择器排版，默认附带任务标题、会话/任务链接。
- [ ] 修复 note 链接、图片点击、撤销/重做、字体大小。
- [ ] 增加标题、颜色、底色工具。
- [ ] 增加 note 发送邮件功能：正文发送或附件发送，附件格式可选。

### 84.6 — planned

- [ ] 审查 settings 信息架构、按钮分组、禁用态、引导文案与危险操作确认。

## 5. 验证清单

- `node --check src/desktop/renderer/overlay.js` — passed 2026-04-25 (rerun after image link support)
- `node --check src/desktop/renderer/popup-card.js` — passed 2026-04-25
- `node --check src/desktop/renderer/dock.js` — passed 2026-04-25
- `node --check src/desktop/renderer/console.js` — passed 2026-04-25
- `node --check src/desktop/tray/electron-main.mjs` — passed 2026-04-25
- `node --check src/service/core/context-submission.mjs` — passed 2026-04-25
- `node --check src/service/email/digest.mjs` — passed 2026-04-25
- `node --check src/service/action_tools/tools/index.mjs` — passed 2026-04-25
- `node --check src/service/scheduler/execute-action.mjs` — passed 2026-04-25
- `node --check src/service/executors/agentic/planner.mjs` — passed 2026-04-25
- `node --check src/service/executors/agentic/prompt-builder.mjs` — passed 2026-04-25
- `node --check src/service/core/http-server.mjs` — passed 2026-04-25
- 关键 UI 手测：overlay 拖动/调整大小、任务 dock、邮件摘要卡片、浅色模式 toolbar 点击、console 文件 reveal、note 链接/图片。
