# UCA 任务索引

> 状态枚举：`todo` / `in_progress` / `done` / `blocked`

| 顺序 | Task ID | 文件 | 对应 Phase | 依赖 | 建议分支 | 状态 |
|---|---|---|---|---|---|---|
| 0 | UCA-000 | [00_repo_bootstrap.md](00_repo_bootstrap.md) | 基础流程 | - | `task/uca-000-repo-bootstrap` | done |
| 1 | UCA-001 | [01_phase0_prd_architecture.md](01_phase0_prd_architecture.md) | Phase 0 | UCA-000 | `task/uca-001-phase0-prd-architecture` | done |
| 2 | UCA-002 | [02_phase0_protocols_and_risks.md](02_phase0_protocols_and_risks.md) | Phase 0 | UCA-001 | `task/uca-002-phase0-protocols-risks` | done |
| 3 | UCA-003 | [03_phase1a_desktop_shell.md](03_phase1a_desktop_shell.md) | Phase 1a | UCA-002 | `task/uca-003-phase1a-desktop-shell` | done |
| 4 | UCA-004 | [04_phase1a_service_core.md](04_phase1a_service_core.md) | Phase 1a | UCA-003 | `task/uca-004-phase1a-service-core` | done |
| 5 | UCA-005 | [05_phase1b_file_entry_and_kimi.md](05_phase1b_file_entry_and_kimi.md) | Phase 1b | UCA-004 | `task/uca-005-phase1b-file-kimi` | done |
| 6 | UCA-006 | [06_phase1c_browser_extension.md](06_phase1c_browser_extension.md) | Phase 1c | UCA-004 | `task/uca-006-phase1c-browser-extension` | done |
| 7 | UCA-007 | [07_phase2_status_retry_metrics.md](07_phase2_status_retry_metrics.md) | Phase 2 | UCA-005,UCA-006 | `task/uca-007-phase2-status-metrics` | done |
| 8 | UCA-008 | [08_phase_action_tools.md](08_phase_action_tools.md) | Action Tools | UCA-007 | `task/uca-008-action-tools` | done |
| 9 | UCA-009 | [09_phase2_5_security_privacy.md](09_phase2_5_security_privacy.md) | Phase 2.5 | UCA-007,UCA-008 | `task/uca-009-phase2-5-security` | done |
| 10 | UCA-010 | [10_phase_scheduler_pending_approval.md](10_phase_scheduler_pending_approval.md) | Scheduler | UCA-008,UCA-009 | `task/uca-010-scheduler-pending-approval` | done |
| 11 | UCA-011 | [11_phase3_browser_overlay_polish.md](11_phase3_browser_overlay_polish.md) | Phase 3 | UCA-006,UCA-009 | `task/uca-011-phase3-browser-overlay` | done |
| 12 | UCA-012 | [12_phase4_office_spike_and_base.md](12_phase4_office_spike_and_base.md) | Phase 4 | UCA-009 | `task/uca-012-phase4-office` | done |
| 13 | UCA-013 | [13_phase5_pdf_ocr.md](13_phase5_pdf_ocr.md) | Phase 5 | UCA-009,UCA-005 | `task/uca-013-phase5-pdf-ocr` | done |
| 14 | UCA-014 | [14_phase6_platform_foundation.md](14_phase6_platform_foundation.md) | Phase 6 | UCA-010,UCA-012,UCA-013 | `task/uca-014-phase6-platform-foundation` | done |
| 15 | UCA-015 | [15_runtime_wiring_and_persistence.md](15_runtime_wiring_and_persistence.md) | Runtime | UCA-014 | `task/uca-015-runtime-wiring` | done |
| 16 | UCA-016 | [16_native_integrations.md](16_native_integrations.md) | Native Integrations | UCA-015 | `task/uca-016-native-integrations` | done |
| 17 | UCA-017 | [17_real_ai_and_multimodal.md](17_real_ai_and_multimodal.md) | AI Runtime | UCA-015,UCA-016 | `task/uca-017-real-ai` | done |
| 18 | UCA-018 | [18_console_and_operator_ui.md](18_console_and_operator_ui.md) | UI | UCA-015,UCA-016 | `task/uca-018-console-ui` | done |
| 19 | UCA-019 | [19_template_persistence_and_dag_resume.md](19_template_persistence_and_dag_resume.md) | Platform Hardening | UCA-015,UCA-017,UCA-018 | `task/uca-019-template-dag` | done |
| 20 | UCA-020 | [20_e2e_validation_and_packaging.md](20_e2e_validation_and_packaging.md) | Release Readiness | UCA-016,UCA-017,UCA-018,UCA-019 | `task/uca-020-e2e-packaging` | done |
| 21 | UCA-021 | [21_desktop_renderer_foundation.md](21_desktop_renderer_foundation.md) | Desktop UI | UCA-018,UCA-020 | `task/uca-021-desktop-renderer` | done |
| 22 | UCA-022 | [22_overlay_composer_and_quick_actions.md](22_overlay_composer_and_quick_actions.md) | Overlay UI | UCA-021 | `task/uca-022-overlay-composer` | done |
| 23 | UCA-023 | [23_context_handoff_and_file_prompt_ui.md](23_context_handoff_and_file_prompt_ui.md) | Context Handoff UI | UCA-021,UCA-022,UCA-016 | `task/uca-023-context-handoff-ui` | done |
| 24 | UCA-024 | [24_console_rendered_workspace.md](24_console_rendered_workspace.md) | Console Workspace | UCA-021,UCA-019 | `task/uca-024-console-workspace` | done |
| 25 | UCA-025 | [25_electron_windows_bootstrap_blocker.md](25_electron_windows_bootstrap_blocker.md) | Desktop Runtime Blocker | UCA-021,UCA-022,UCA-023 | `task/uca-025-electron-windows-bootstrap` | done |
| 26 | UCA-026 | [26_external_trial_validation.md](26_external_trial_validation.md) | External Trial Validation | UCA-020 | `task/uca-026-external-trial-validation` | blocked |
| 27 | UCA-027 | [27_desktop_dock_and_notifications.md](27_desktop_dock_and_notifications.md) | Desktop Dock UX | UCA-023,UCA-024,UCA-026 | `task/uca-027-desktop-dock` | done |
| 28 | UCA-028 | [28_output_format_and_background_delivery.md](28_output_format_and_background_delivery.md) | Output Delivery | UCA-027 | `task/uca-028-output-format` | done |
| 29 | UCA-029 | [29_unified_capture_entrypoints.md](29_unified_capture_entrypoints.md) | Unified Capture UX | UCA-027,UCA-028 | `task/uca-029-unified-capture` | done |
| 30 | UCA-030 | [30_overlay_session_timeline_and_followup.md](30_overlay_session_timeline_and_followup.md) | Overlay Session UX | UCA-028,UCA-029 | `task/uca-030-overlay-session` | done |
| 31 | UCA-031 | [31_artifact_center_and_multiformat_results.md](31_artifact_center_and_multiformat_results.md) | Artifact Center | UCA-028,UCA-030 | `task/uca-031-artifact-center` | done |
| 32 | UCA-032 | [32_live_task_progress_and_event_streaming.md](32_live_task_progress_and_event_streaming.md) | Live Task Progress | UCA-030,UCA-031 | `task/uca-032-live-task-progress` | done |
| 33 | UCA-033 | [33_ui_redesign_glass_bubble.md](33_ui_redesign_glass_bubble.md) | UI Redesign: Glass & Bubble | UCA-027~032 | `task/uca-033-ui-redesign` | done |
| 34 | UCA-034 | [34_free_translation_package.md](34_free_translation_package.md) | Free Translation | UCA-017,UCA-029 | `task/uca-034-free-translation` | done |
| 35 | UCA-035 | [35_voice_input_and_mic_permission.md](35_voice_input_and_mic_permission.md) | Voice Input | UCA-025,UCA-033 | `task/uca-035-voice-input` | done |
| 36 | UCA-036 | [36_apple_overlay_rework.md](36_apple_overlay_rework.md) | Apple Overlay Rework | UCA-033,UCA-035 | `task/uca-036-apple-overlay-rework` | done |
| 37 | UCA-037 | [37_browser_inline_result_frame.md](37_browser_inline_result_frame.md) | Browser Inline Result | UCA-011,UCA-029,UCA-034,UCA-036 | `task/uca-037-browser-inline-result` | in_progress |
| 38 | UCA-038 | [38_conversation_memory_and_new_session.md](38_conversation_memory_and_new_session.md) | Conversation Memory | UCA-030,UCA-036,UCA-037 | `task/uca-038-conversation-memory` | in_progress |
| 39 | UCA-039 | [39_smart_launch_and_free_search.md](39_smart_launch_and_free_search.md) | Smart Launch + Free Search | UCA-008,UCA-017 | `task/uca-039-smart-launch-and-search` | in_progress |
| 40 | UCA-040 | [40_misc_reliability_fixes.md](40_misc_reliability_fixes.md) | Misc Reliability Fixes | UCA-013,UCA-023 | `task/uca-040-misc-reliability-fixes` | done |
| 41 | UCA-041 | [41_conversation_history_list_ui.md](41_conversation_history_list_ui.md) | Projects + History Sessions | UCA-038 | `task/uca-041-projects-and-history` | todo |
| 42 | UCA-042 | [42_multi_intent_decomposition.md](42_multi_intent_decomposition.md) | Multi-Intent Decomposition | UCA-007,UCA-017,UCA-039,UCA-046,UCA-049 | `task/uca-042-multi-intent-decomposition` | done |
| 43 | UCA-043 | [43_multi_task_viewer_ui.md](43_multi_task_viewer_ui.md) | Multi-Task Viewer UI | UCA-032,UCA-031,UCA-042 | `task/uca-043-multi-task-viewer` | done |
| 44 | UCA-044 | [44_email_monitoring_and_auto_schedule.md](44_email_monitoring_and_auto_schedule.md) | Email Monitoring + Auto-Schedule | UCA-010,UCA-017,UCA-027,UCA-046,UCA-049 | `task/uca-044-email-monitoring` | done |
| 45 | UCA-045 | [45_morning_email_digest.md](45_morning_email_digest.md) | Morning Email Digest | UCA-044,UCA-027,UCA-049 | `task/uca-045-morning-digest` | done |
| 46 | UCA-046 | [46_advanced_scheduler_ux.md](46_advanced_scheduler_ux.md) | Advanced Scheduler UX | UCA-010,UCA-036,UCA-024 | `task/uca-046-advanced-scheduler-ux` | done |
| 47 | UCA-047 | [47_active_window_deep_context.md](47_active_window_deep_context.md) | Active Window Deep Context | UCA-029,UCA-023,UCA-040,UCA-049 | `task/uca-047-active-window-context` | done |
| 48 | UCA-048 | [48_settings_v2_output_path_and_feature_toggles.md](48_settings_v2_output_path_and_feature_toggles.md) | Settings v2 (output path + feature toggles) | UCA-018,UCA-036,UCA-034~047 | `task/uca-048-settings-v2` | done |
| 49 | UCA-049 | [49_provider_agnostic_agentic_runtime.md](49_provider_agnostic_agentic_runtime.md) | Provider-agnostic Agentic Runtime + Universal Tool Belt | UCA-008,UCA-017,UCA-028,UCA-039 | `task/uca-049-agentic-runtime` | done |

## 当前执行规则

- 已完成 UCA-000 ~ UCA-014 的骨架与规范收口
- UCA-015 ~ UCA-033 是"真实运行时、真实集成、真实 UI、发布验证"四类收尾任务；截至 2026-04-11 代码审计，UCA-027 ~ UCA-032 对应的 dock、输出格式、统一 capture、会话时间线、结果中心与事件流代码均已落地并有验证脚本覆盖，状态收口为 `done`
- UCA-026 需要另一台新机器的外部试用证据，本机代码和文档准备已完成但验收条件不可在当前工作区内闭环，因此标为 `blocked`
- UCA-034 ~ UCA-041 是 2026-04-11 会话里新加入的增量能力：免费翻译、语音输入、Apple UI 重做、浏览器内联结果、对话记忆、智能启动、杂项可靠性修复、项目+历史 UI（预留）；其中 UCA-037 ~ UCA-039 保持 `in_progress`，因为仍有用户反馈缺陷需要按全局方案修正
- UCA-042 ~ UCA-048 是 2026-04-11 晚些加入的产品层能力：多意图分解、多任务查看 UI、邮箱监测、早晨 digest、高级 scheduler UX、活动窗口深度上下文、设置 v2 —— UCA-042/UCA-043/UCA-044/UCA-045 已完成，其余按依赖链推进
- UCA-049 已完成（2026-04-11，三个 commit 全部落地）：provider 无关的 agentic 运行时 + 通用工具带（write_file / run_script / generate_document）+ 修复 "切到 DeepSeek 后还在跑 Kimi CLI" 的真实 bug —— 是 UCA-042 的前置，完成后让 intent 分解器直接复用同一套 planner。
  - **Commit 1**：provider-resolver 的 `resolveCodeCliRuntimeForTask` + `describeResolvedProvider` + 所有提交路径的 per-task 动态解析 + `provider_resolved` 事件 + `/ai/active-provider-for-task` 端点 + `scripts/verify-provider-routing.mjs`；bug #7 根治
  - **Commit 2**：universal tool belt（write_file / run_script / generate_document）+ agentic prompt-builder（动态从 registry 渲染）+ agentic planner（8 步 tool-use 循环 + truthfulness guard）+ agentic executor 注册 + router intent_tags 多标签升级 + pptx 输出格式 + create-ooxml-fixture.ps1 的 pptx 分支 + `scripts/verify-agentic-planner.mjs`；UCA-039 bug #5（AI 撒谎）+ bug #6（ppt 退化 report.md）根治
  - **Commit 3**：code_cli JSON planning mode bridge（`code-cli-bridge.mjs` —— 把 messages 序列化为 prompt + 解析 JSON tool_call 块 + spawn 子进程） → Kimi CLI / Claude Code CLI / 任何 user-installed CLI 都能驱动 agentic planner；Console 任务详情面板新增 `Provider: <name> · <model> · <transport>` 行 + 琥珀色 "AI claim downgraded" 警告框；Overlay 气泡新增同样的 system bubble + ⚠ 警告；`tests/fixtures/mock-agentic-code-cli.mjs` 模拟 Kimi 风格 stream-json + tool_call JSON block；`verify-agentic-planner.mjs` case 5 端到端跑 Node 子进程的 mock CLI 验证完整 2 轮循环。全部 27 个 verify 脚本通过
- 每完成一个任务，必须同步更新对应任务文件和本索引
- 若出现阻塞，先把任务状态改为 `blocked`，再由下一次计划会议决定是否拆新任务

## 2026-04-11 待跟进的用户反馈 bug（跨多任务）

以下缺陷来自 2026-04-11 的用户反馈，对应任务已在"遗留问题"里记录：

1. **连续翻译不同段落，第二次显示第一次的内容** —— UCA-029 / UCA-037（浏览器扩展 / service core dedupe）
2. **追问需要网络搜索时返回老旧内容** —— UCA-039（LLM 是否真的调用了 web_search_fetch + recency 生效情况）
3. **新建会话后发送的用户消息看不到气泡** —— UCA-038（`addBubble("user", ...)` 在新会话下被 conversationPhase 判定跳过？）
4. **关闭 overlay 后之前的气泡看不到** —— UCA-038（restoreConversation 只恢复 state 没渲染气泡）+ UCA-041 正式在列表 UI 里解决
5. **AI 说"已启动应用"但实际没启动** —— UCA-039（tool_using executor 可能错读 tool 返回 success 字段；需严格按 tool.success 决定措辞）+ **UCA-049 的 agentic planner 在架构层根治**（transcript 里无 `success:true` 时禁止 AI 说"已完成"）。**已由 UCA-049 commit 2 的 planner truthfulness guard 根治（2026-04-11）**：`COMPLETION_CLAIM_PATTERNS` 中英文匹配 + `anyToolSucceeded(transcript)` 检测 + 降级为 partial_success 并在 finalText 前加 `[UCA note] ... downgraded ...`。回归守护：`scripts/verify-agentic-planner.mjs` case 3 直接验证撒谎场景被降级
6. **"分析 AI 趋势并生成一份 ppt" 退化为 report.md 加免责声明** —— UCA-049（intent 只选单 executor、output-format 没 pptx 分支、system prompt 没告诉 LLM 它有写文件/跑代码的工具）。**已由 UCA-049 commit 2 根治（2026-04-11）**：（a）router 现在把 pptx 请求升级到 agentic executor；（b）output-format 有 pptx 分支，调 `create-ooxml-fixture.ps1 -Kind pptx` 产出真 `.pptx`；（c）generate_document 工具 + 动态 registry prompt 让 LLM 真正知道自己能生成 pptx/docx/xlsx/pdf。回归守护：`verify-action-tools.mjs` win32 真实生成 pptx（断言 ZIP magic `PK`）、`verify-service-core.mjs` 路由断言、`verify-agentic-planner.mjs` case 1 prompt 包含 pptx 指令
7. **切到 DeepSeek 之后仍然在跑 Kimi CLI** —— UCA-049（`runtime.kimiRuntime` 是启动时快照，`context-submission.mjs` 和 `browser-submission.mjs` 里的 `runKimiExecutor` 硬读这个快照，完全不看 `resolveProviderForTask` —— 只有 `fast` 执行器是每次动态解析）。**已由 UCA-049 commit 1 根治（2026-04-11）**：`resolveCodeCliRuntimeForTask` 每次读磁盘 config，用户选了非 code_cli provider 时直接返回 null（而不是退回 boot-time kimi 快照），所有提交路径同步走动态解析。回归守护：`scripts/verify-provider-routing.mjs` case 5 显式验证 hot-reload

## 2026-04-11 新需求 → 任务映射

| 用户需求 | 对应任务 | 状态 |
|---|---|---|
| 1. 对话框加项目 + 历史会话 | UCA-041（已扩展）| todo |
| 2. 一次输入 → 多个 todo / 子任务卡片 | UCA-042 | done |
| 3. 聊天框数字 badge / 右下角 todo list 图标 | UCA-043 | done |
| 4. 邮箱监测 + 弹总结 + 自动 schedule + 回复追踪 | UCA-044 | done |
| 5. 早晨 5 分钟内邮件汇总 + 多账户 | UCA-045 | done |
| 6. Schedule 提前提醒 + 日历视图 + 分类颜色 | UCA-046（+ UCA-010/036 标注扩展）| todo |
| 7. 活动主窗口深度上下文（文件路径 / 网页链接）| UCA-047（+ UCA-029 标注扩展）| todo |
| 8. 默认文件输出路径 | UCA-048 | todo |
| 9. 功能开关 + 被屏蔽功能时引导跳转设置 | UCA-048 | todo |
| 10. AI 能自主搜索 + 写代码 + 生成真 pptx/docx/xlsx/pdf（不再死板） | UCA-049 | done |
| 11. 选中的 provider（DeepSeek/Claude/Ollama/任何 API 或 CLI）必须真的被调用 | UCA-049 | done |

## 跨任务依赖关系（2026-04-11 新任务）

```
UCA-049 (agentic runtime) ───────> UCA-042 (multi-intent)
                              └──> UCA-044/045 (email → generate_document)
                              └──> UCA-047 (active win → agentic context)

UCA-041 (projects+history) ────────┐
UCA-042 (multi-intent) ─────┬──> UCA-043 (multi-task UI)
UCA-046 (sched UX) ─────────┤
UCA-044 (email mon) ──> UCA-045 (morning digest)
                       └──> UCA-046 (email category)
UCA-047 (active win) ──────┐
UCA-034~047 (all features) ─┴──> UCA-048 (settings v2 / feature flags)
```
