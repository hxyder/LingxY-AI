# Universal Context Agent — Phase 拆解索引

本目录是《[docs/planning/universal_context_agent_detailed_plan.md](../docs/planning/universal_context_agent_detailed_plan.md)》方案的工程化拆解，按 Phase 维度展开。每个 Phase 文件包含统一的六个部分：

1. **目标 (Goal)** — 这一阶段要解决的核心问题
2. **范围 (Scope)** — 做什么、不做什么
3. **架构 (Architecture)** — 涉及的层与组件、关键技术决策
4. **流程设计 (Flow Design)** — 端到端流程图与时序
5. **验收标准 (Acceptance)** — 可量化的退出条件
6. **风险与缓解 (Risks)** — 本阶段特有的风险与应对

---

## Phase 总览

| Phase | 名称 | 周期(估) | 状态 | 核心交付 |
|---|---|---|---|---|
| [Phase 0](phase_0_definition.md) | 定义与协议定稿 | W1–W2 | 待启动 | PRD、架构图、ContextPacket/Task/Event 协议、Kimi 任务包规范 |
| [Phase 1a](phase_1a_minimal_loop.md) | 最小闭环 | W3–W8 | 待启动 | 托盘 + 固定窗 + 剪贴板 + Kimi Bridge + 单动作贯通 |
| [Phase 1b](phase_1b_file_capability.md) | 文件能力 | W9–W12 | 待启动 | 文件右键菜单 + 拖拽 + 全局快捷键读 Explorer 选区 + ContextPacket + 任务中心 |
| [Phase 1c](phase_1c_browser_extension.md) | 浏览器扩展 | W13–W15 | 待启动 | MV3 扩展 + Native Messaging Host + 网页选区/链接 |
| [Phase 2](phase_2_status_completeness.md) | 状态与执行显示 | W16–W19 | 待启动 | 流式步骤/失败分类/重试取消/任务详情页 |
| ⭐ [Phase Action Tools](phase_action_tools.md) | **系统动作工具层（新增）** | W18–W21 | 待启动 | mailto / 搜索 / 文件操作 / 通知 / 截屏 等 12 类工具 + Tool-Using Agent loop |
| ⭐ [Phase Unified Account Connectors](phase_unified_account_connectors.md) | **统一账户连接器（新增）** | 3–4 周 | 待启动 | 多账户 OAuth、能力映射、账户路由、云端邮件/文件/日历工具 |
| [Phase 2.5](phase_2_5_privacy_security.md) | 隐私与权限 | W20–W22 | 待启动 | 白/黑名单 + 脱敏 + Kill Switch + 审计 |
| ⭐ [Phase Scheduler](phase_scheduler.md) | **定时与触发任务（新增）** | W22–W24 | 待启动 | cron + 文件监听 + LLM 自主创建定时任务 |
| [Phase 3](phase_3_overlay_followcursor.md) | 跟随浮标（限定范围） | W?? | 评估中 | **仅在浏览器扩展内**实现，跨应用不做 |
| [Phase 4](phase_4_office_integration.md) | Office 深度集成 | W23–W26 | 待启动 | Word/Excel/PPT 选区 → ContextPacket |
| [Phase 5](phase_5_pdf_visual_fallback.md) | PDF 与按需 OCR | W27–W30 | 待启动 | PDF 文件级处理 + 用户主动截图 OCR |
| [Phase 6](phase_6_advanced_orchestration.md) | 平台化与扩展 | W31+ | 待启动 | 自定义动作模板 + 多执行器 + 动作链 + 成本配额 |

> **说明 1**：Phase 3 的"跨应用跟随浮标"被建议**降级**——仅在浏览器扩展内提供 Grammarly 风格浮标，不投入精力做 Win32 全局选区跟随，原因详见《主方案 §22.4》。
>
> **说明 2**：⭐ 标记的两个 Phase 是回应用户「发邮件/搜索/定时任务」需求新增的，原方案没有。它们与 Phase 2 / 2.5 时间上重叠，可以并行开发，详见《[需求响应](../docs/planning/requirements_response.md)》。
>
> **说明 3**：Phase Unified Account Connectors 是 2026-04-19 追加的账户连接器升级阶段，依赖 UCA-048 Settings v2、UCA-049 provider-agnostic agentic runtime、现有 Connectors Tab，以及 UCA-044/045 的 Email Monitoring/Digest 基础。它把当前 Google/Microsoft OAuth demo 收口为多账户、capability、account router 与统一云账户 Action Tools。

---

## 阅读顺序建议

- **PM / 设计师**：Phase 0 → 各 Phase 的"目标 / 范围 / 流程设计 / 验收"
- **后端 / 桌面工程师**：Phase 0 → 各 Phase 的"架构 / 风险" → [架构横切文档](architecture_cross_cutting.md)（如有）
- **新加入成员**：先读 [主方案](../docs/planning/universal_context_agent_detailed_plan.md) §1–§4 + §22，再按 Phase 顺序读
- **执行负责人**：先读本目录 phase 文件，再读 [tasks/README.md](tasks/README.md) 和 [tasks/TASK_INDEX.md](tasks/TASK_INDEX.md)

---

## 执行前统一约束

在进入开发前，以下 4 个点必须已经写成正式方案、ADR 或 spike 结论：

1. **Explorer 入口实现**：Phase 1b 以注册表命令菜单 + `uca-cli.exe` 为默认交付，Win11 现代菜单适配不阻塞主路径。
2. **Scheduler 无人值守授权**：所有定时/触发任务必须明确 `unattended_safe` 或 `approval_required`，不能依赖交互式确认框兜底。
3. **脱敏映射崩溃语义**：redaction map 只驻留内存；service 重启后按 fail-closed 处理，禁止假设可以自动恢复原文。
4. **Office localhost HTTPS**：`https://localhost:9413` 必须经过 time-boxed spike 决策，再决定是否作为正式路径。

这些约束已分别体现在：
- [Phase 1b](phase_1b_file_capability.md)
- [Phase Scheduler](phase_scheduler.md)
- [Phase 2.5](phase_2_5_privacy_security.md)
- [Phase 4](phase_4_office_integration.md)

---

## 修改原则

1. 每个 Phase 文件**只描述本阶段**的工作，不描述未来阶段
2. 跨阶段的横切关注点（安全/可观测性/i18n）放在专属文档
3. Phase 内任何"做出来才知道"的决策，写在风险章节并标注 `TBD`
4. 完成 Phase 后，把"验收"小节改为"已完成"并附 commit / PR 链接
