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
| 26 | UCA-026 | [26_external_trial_validation.md](26_external_trial_validation.md) | External Trial Validation (手动 QA 检查单，非 blocking) | UCA-020 | `task/uca-026-external-trial-validation` | blocked |
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
| 37 | UCA-037 | [37_browser_inline_result_frame.md](37_browser_inline_result_frame.md) | Browser Inline Result | UCA-011,UCA-029,UCA-034,UCA-036 | `task/uca-037-browser-inline-result` | done |
| 38 | UCA-038 | [38_conversation_memory_and_new_session.md](38_conversation_memory_and_new_session.md) | Conversation Memory | UCA-030,UCA-036,UCA-037 | `task/uca-038-conversation-memory` | done |
| 39 | UCA-039 | [39_smart_launch_and_free_search.md](39_smart_launch_and_free_search.md) | Smart Launch + Free Search | UCA-008,UCA-017 | `task/uca-039-smart-launch-and-search` | done |
| 40 | UCA-040 | [40_misc_reliability_fixes.md](40_misc_reliability_fixes.md) | Misc Reliability Fixes | UCA-013,UCA-023 | `task/uca-040-misc-reliability-fixes` | done |
| 41 | UCA-041 | [41_conversation_history_list_ui.md](41_conversation_history_list_ui.md) | Projects + History Sessions | UCA-038 | `task/uca-041-projects-and-history` | done |
| 42 | UCA-042 | [42_multi_intent_decomposition.md](42_multi_intent_decomposition.md) | Multi-Intent Decomposition | UCA-007,UCA-017,UCA-039,UCA-046,UCA-049 | `task/uca-042-multi-intent-decomposition` | done |
| 43 | UCA-043 | [43_multi_task_viewer_ui.md](43_multi_task_viewer_ui.md) | Multi-Task Viewer UI | UCA-032,UCA-031,UCA-042 | `task/uca-043-multi-task-viewer` | done |
| 44 | UCA-044 | [44_email_monitoring_and_auto_schedule.md](44_email_monitoring_and_auto_schedule.md) | Email Monitoring + Auto-Schedule | UCA-010,UCA-017,UCA-027,UCA-046,UCA-049 | `task/uca-044-email-monitoring` | done |
| 45 | UCA-045 | [45_morning_email_digest.md](45_morning_email_digest.md) | Morning Email Digest | UCA-044,UCA-027,UCA-049 | `task/uca-045-morning-digest` | done |
| 46 | UCA-046 | [46_advanced_scheduler_ux.md](46_advanced_scheduler_ux.md) | Advanced Scheduler UX | UCA-010,UCA-036,UCA-024 | `task/uca-046-advanced-scheduler-ux` | done |
| 47 | UCA-047 | [47_active_window_deep_context.md](47_active_window_deep_context.md) | Active Window Deep Context | UCA-029,UCA-023,UCA-040,UCA-049 | `task/uca-047-active-window-context` | done |
| 48 | UCA-048 | [48_settings_v2_output_path_and_feature_toggles.md](48_settings_v2_output_path_and_feature_toggles.md) | Settings v2 (output path + feature toggles) | UCA-018,UCA-036,UCA-034~047 | `task/uca-048-settings-v2` | done |
| 49 | UCA-049 | [49_provider_agnostic_agentic_runtime.md](49_provider_agnostic_agentic_runtime.md) | Provider-agnostic Agentic Runtime + Universal Tool Belt | UCA-008,UCA-017,UCA-028,UCA-039 | `task/uca-049-agentic-runtime` | done |
| 50 | UCA-050 | [50_electron_startup_reliability.md](50_electron_startup_reliability.md) | Electron 启动可靠性修复（race condition + silent 失败）| UCA-025 | `task/uca-050-electron-startup` | done |
| 51 | UCA-051 | [51_task_spec_compiler.md](51_task_spec_compiler.md) | TaskSpec 编译层（单一信息源）| UCA-049,UCA-050 | `task/uca-051-task-spec` | done |
| 52 | UCA-052 | [52_llm_intent_classification.md](52_llm_intent_classification.md) | LLM-based Intent Classification（替换 substring 匹配）| UCA-051 | `task/uca-052-intent-classification` | done |
| 53 | UCA-053 | [53_file_discovery_tools.md](53_file_discovery_tools.md) | File Discovery & Artifact Verification 工具集 | UCA-051 | `task/uca-053-file-discovery` | done |
| 54 | UCA-054 | [54_react_observation_injection.md](54_react_observation_injection.md) | ReAct Tool Observation Injection（修复 AI 调不了工具）| UCA-051,UCA-049 | `task/uca-054-react-observation` | done |
| 55 | UCA-055 | [55_production_docgen.md](55_production_docgen.md) | 生产级文档生成（PptxGenJS / docx / ExcelJS）| UCA-053,UCA-054 | `task/uca-055-docgen` | todo |
| 56 | UCA-056 | [56_decomposer_state_guards.md](56_decomposer_state_guards.md) | Decomposer 硬化 + State Machine Guards | UCA-051,UCA-052 | `task/uca-056-decomposer-guards` | done |
| 57 | UCA-057 | [57_close_037_039.md](57_close_037_039.md) | 关闭 UCA-037 + UCA-039 遗留 Bug | UCA-054,UCA-056 | `task/uca-057-close-bugs` | done |
| 58 | UCA-058 | [58_decomposition_threshold_guard.md](58_decomposition_threshold_guard.md) | 分解阈值守卫（禁止 QA/翻译/单意图被拆分）| UCA-056,UCA-051 | `task/uca-058-decomposition-guard` | todo |
| 59 | UCA-059 | [59_clarification_dialog.md](59_clarification_dialog.md) | 歧义检测 + 对话追问（Clarify-Before-Act）| UCA-058,UCA-051 | `task/uca-059-clarification-dialog` | todo |
| 60 | UCA-060 | [60_context_instruction_separation.md](60_context_instruction_separation.md) | 上下文与指令分离（快捷键空输入防误发）| UCA-047,UCA-051 | `task/uca-060-context-instruction-separation` | todo |
| 61 | UCA-061 | [61_execution_transparency.md](61_execution_transparency.md) | 执行过程透明化（对话框显示操作步骤）| UCA-054,UCA-032 | `task/uca-061-execution-transparency` | todo |
| 62 | UCA-062 | [62_scheduler_time_awareness.md](62_scheduler_time_awareness.md) | Scheduler 时间感知修复（相对时间解析+确认消息）| UCA-046,UCA-010 | `task/uca-062-scheduler-time-awareness` | todo |
| 63 | UCA-063 | [63_tool_call_fallback_guard.md](63_tool_call_fallback_guard.md) | 工具调用兜底守卫（消除"我无法操作电脑"拒绝）| UCA-054,UCA-058 | `task/uca-063-tool-call-fallback-guard` | todo |
| 64 | UCA-064 | [64_subtask_history_aggregation.md](64_subtask_history_aggregation.md) | 子任务历史聚合 + 详情页导航返回 | UCA-041,UCA-056 | `task/uca-064-subtask-history` | todo |
| 65 | UCA-065 | [65_sequential_compound_action.md](65_sequential_compound_action.md) | 复合动作顺序执行（sequential compound mode）| UCA-058,UCA-063 | `task/uca-065-sequential-compound` | todo |
| 66 | UCA-066 | [66_performance_fast_path.md](66_performance_fast_path.md) | 性能快速通道（Tier0确定性动作/翻译轻量API/LLM流式输出）| UCA-052,UCA-058 | `task/uca-066-performance-fast-path` | todo |
| 77 | UCA-077 | [77_connector_registry_capability_foundation.md](77_connector_registry_capability_foundation.md) | Unified Account Connectors | UCA-048,UCA-049 | `task/uca-077-connector-foundation` | done |
| 78 | UCA-078 | [78_multi_account_oauth_connectors_ui.md](78_multi_account_oauth_connectors_ui.md) | Unified Account Connectors | UCA-077 | `task/uca-078-multi-account-oauth-ui` | done |
| 79 | UCA-079 | [79_account_router_unified_read_tools.md](79_account_router_unified_read_tools.md) | Unified Account Connectors | UCA-077,UCA-078 | `task/uca-079-account-router-read-tools` | done |
| 80 | UCA-080 | [80_connector_write_tools_confirmation.md](80_connector_write_tools_confirmation.md) | Unified Account Connectors | UCA-079 | `task/uca-080-connector-write-tools` | done |
| 81 | UCA-081 | [81_connector_reauth_resume_audit.md](81_connector_reauth_resume_audit.md) | Unified Account Connectors | UCA-080 | `task/uca-081-connector-reauth-audit` | todo |
| 82 | UCA-082 | [82_email_monitoring_connector_migration.md](82_email_monitoring_connector_migration.md) | Unified Account Connectors | UCA-044,UCA-045,UCA-081 | `task/uca-082-email-connector-migration` | todo |
| 83 | UCA-083 | [83_polish_launcher_cards_notifications.md](83_polish_launcher_cards_notifications.md) | Desktop UX Polish | UCA-027,UCA-041,UCA-049 | `task/uca-083-polish-launcher-cards-notifications` | done |
| 84 | UCA-084 | [84_overlay_console_notes_preview_upgrade.md](84_overlay_console_notes_preview_upgrade.md) | Overlay / Console / Notes / Preview | UCA-041,UCA-049,UCA-083 | `task/uca-084-overlay-console-notes-preview` | in_progress |
| 85 | UCA-085 | [85_runtime_search_popup_autotask_stability.md](85_runtime_search_popup_autotask_stability.md) | Runtime Search / Popup / Auto Task Stability | UCA-041,UCA-049,UCA-084 | `task/uca-085-runtime-search-popup-autotask` | done |

## 当前执行规则

- 已完成 UCA-000 ~ UCA-014 的骨架与规范收口
- UCA-015 ~ UCA-033 是"真实运行时、真实集成、真实 UI、发布验证"四类收尾任务；截至 2026-04-11 代码审计，UCA-027 ~ UCA-032 对应的 dock、输出格式、统一 capture、会话时间线、结果中心与事件流代码均已落地并有验证脚本覆盖，状态收口为 `done`
- UCA-026 需要另一台新机器的外部试用证据，本机代码和文档准备已完成但验收条件不可在当前工作区内闭环，因此标为 `blocked`
- UCA-034 ~ UCA-041 是 2026-04-11 会话里新加入的增量能力：免费翻译、语音输入、Apple UI 重做、浏览器内联结果、对话记忆、智能启动、杂项可靠性修复、项目+历史 UI；UCA-037 遗留 bug（连续翻译不同段落显示上次内容）已通过 UCA-057 selection snapshot model 修复收口为 `done`；UCA-039 遗留 bug（追问网络搜索返回旧内容）已通过 UCA-057 search enforcement 修复收口为 `done`
- UCA-042 ~ UCA-048 是 2026-04-11 晚些加入的产品层能力：多意图分解、多任务查看 UI、邮箱监测、早晨 digest、高级 scheduler UX、活动窗口深度上下文、设置 v2 —— UCA-042/UCA-043/UCA-044/UCA-045/UCA-046/UCA-047/UCA-048 均已完成
- UCA-049 已完成（2026-04-11，三个 commit 全部落地）：provider 无关的 agentic 运行时 + 通用工具带（write_file / run_script / generate_document）+ 修复 "切到 DeepSeek 后还在跑 Kimi CLI" 的真实 bug —— 是 UCA-042 的前置，完成后让 intent 分解器直接复用同一套 planner。
  - **Commit 1**：provider-resolver 的 `resolveCodeCliRuntimeForTask` + `describeResolvedProvider` + 所有提交路径的 per-task 动态解析 + `provider_resolved` 事件 + `/ai/active-provider-for-task` 端点 + `scripts/verify-provider-routing.mjs`；bug #7 根治
  - **Commit 2**：universal tool belt（write_file / run_script / generate_document）+ agentic prompt-builder（动态从 registry 渲染）+ agentic planner（8 步 tool-use 循环 + truthfulness guard）+ agentic executor 注册 + router intent_tags 多标签升级 + pptx 输出格式 + create-ooxml-fixture.ps1 的 pptx 分支 + `scripts/verify-agentic-planner.mjs`；UCA-039 bug #5（AI 撒谎）+ bug #6（ppt 退化 report.md）根治
  - **Commit 3**：code_cli JSON planning mode bridge（`code-cli-bridge.mjs` —— 把 messages 序列化为 prompt + 解析 JSON tool_call 块 + spawn 子进程） → Kimi CLI / Claude Code CLI / 任何 user-installed CLI 都能驱动 agentic planner；Console 任务详情面板新增 `Provider: <name> · <model> · <transport>` 行 + 琥珀色 "AI claim downgraded" 警告框；Overlay 气泡新增同样的 system bubble + ⚠ 警告；`tests/fixtures/mock-agentic-code-cli.mjs` 模拟 Kimi 风格 stream-json + tool_call JSON block；`verify-agentic-planner.mjs` case 5 端到端跑 Node 子进程的 mock CLI 验证完整 2 轮循环。全部 27 个 verify 脚本通过
- 每完成一个任务，必须同步更新对应任务文件和本索引
- 若出现阻塞，先把任务状态改为 `blocked`，再由下一次计划会议决定是否拆新任务
- UCA-077 ~ UCA-082 是 2026-04-19 追加的统一账户连接器升级任务。编号从 UCA-077 开始，是为了避开代码注释中已出现但未正式入索引的 UCA-067 ~ UCA-076，后续整理这些编号时不要复用 077 ~ 082。

## 2026-04-11 状态清理与架构对齐追加

- UCA-041 追加服务端 `/projects/store`：Console / Overlay 不再依赖各自 renderer localStorage 直接共享；项目、当前项目、会话列表统一持久化到 runtime config，localStorage 只做缓存。
- UCA-042 追加 AI-first 分解：默认先走 agentic planner 理解意图，再决定是否拆成子任务；规则切分只保留为 `mode: "rules_only"` 测试模式，修复同一 PPT 产物请求被拆成 3 个不相干任务的问题。
- UCA-046 追加 notification navigate：定时提醒点击后能跳到 Console Schedules；同时清理了本机残留的 verify/smoke notification JSON，避免启动时继续弹旧提醒。
- 本机持久化库清理：删除明显 smoke/demo 任务（Smoke toast / codex one-shot due smoke / Morning Review），并把旧的 queued/running/cancelling 残留任务标记为 failed/stale cleanup；清理后非终态任务数为 0。

## 2026-04-11 待跟进的用户反馈 bug（跨多任务）

以下缺陷来自 2026-04-11 的用户反馈，对应任务已在"遗留问题"里记录：

1. **连续翻译不同段落，第二次显示第一次的内容** —— UCA-029 / UCA-037（浏览器扩展 / service core dedupe）
2. **追问需要网络搜索时返回老旧内容** —— UCA-039（LLM 是否真的调用了 web_search_fetch + recency 生效情况）
3. **新建会话后发送的用户消息看不到气泡** —— UCA-038（`addBubble("user", ...)` 在新会话下被 conversationPhase 判定跳过？）
4. **关闭 overlay 后之前的气泡看不到** —— UCA-038（restoreConversation 只恢复 state 没渲染气泡）+ UCA-041 正式在列表 UI 里解决
5. **AI 说"已启动应用"但实际没启动** —— UCA-039（tool_using executor 可能错读 tool 返回 success 字段；需严格按 tool.success 决定措辞）+ **UCA-049 的 agentic planner 在架构层根治**（transcript 里无 `success:true` 时禁止 AI 说"已完成"）。**已由 UCA-049 commit 2 的 planner truthfulness guard 根治（2026-04-11）**：`COMPLETION_CLAIM_PATTERNS` 中英文匹配 + `anyToolSucceeded(transcript)` 检测 + 降级为 partial_success 并在 finalText 前加 `[UCA note] ... downgraded ...`。回归守护：`scripts/verify-agentic-planner.mjs` case 3 直接验证撒谎场景被降级
6. **"分析 AI 趋势并生成一份 ppt" 退化为 report.md 加免责声明** —— UCA-049（intent 只选单 executor、output-format 没 pptx 分支、system prompt 没告诉 LLM 它有写文件/跑代码的工具）。**已由 UCA-049 commit 2 根治（2026-04-11）**：（a）router 现在把 pptx 请求升级到 agentic executor；（b）output-format 有 pptx 分支，调 `create-ooxml-fixture.ps1 -Kind pptx` 产出真 `.pptx`；（c）generate_document 工具 + 动态 registry prompt 让 LLM 真正知道自己能生成 pptx/docx/xlsx/pdf。回归守护：`verify-action-tools.mjs` win32 真实生成 pptx（断言 ZIP magic `PK`）、`verify-service-core.mjs` 路由断言、`verify-agentic-planner.mjs` case 1 prompt 包含 pptx 指令
7. **切到 DeepSeek 之后仍然在跑 Kimi CLI** —— UCA-049（`runtime.kimiRuntime` 是启动时快照，`context-submission.mjs` 和 `browser-submission.mjs` 里的 `runKimiExecutor` 硬读这个快照，完全不看 `resolveProviderForTask` —— 只有 `fast` 执行器是每次动态解析）。**已由 UCA-049 commit 1 根治（2026-04-11）**：`resolveCodeCliRuntimeForTask` 每次读磁盘 config，用户选了非 code_cli provider 时直接返回 null（而不是退回 boot-time kimi 快照），所有提交路径同步走动态解析。回归守护：`scripts/verify-provider-routing.mjs` case 5 显式验证 hot-reload
8. **Console 新建项目 Overlay 看不到 / 选中项目后会话没有落到项目下** —— UCA-041。**已修复（2026-04-11）**：新增 `GET/POST /projects/store` 服务端共享源；Overlay/Console 启动、聚焦、项目 tab、创建/选择项目时同步，`ensureConversation` 使用当前 `projectStore.currentProjectId` 建会话。
9. **定时提醒启动后反复弹，点击看不到详情** —— UCA-046。**已修复（2026-04-11）**：清理本机残留 notification JSON；reminder watcher 写入 `navigate.tabId="schedules"`，notification 点击调用 `navigateConsole`。
10. **相关请求被拆成多个不相干任务** —— UCA-042。**已修复（2026-04-11）**：decomposer 默认 AI-first，规则切分只在 `rules_only` 测试模式启用；`verify-service-core` 覆盖"AI 趋势 + PPT + 图表"保留为单个 agentic/pptx 子任务。

## 2026-04-11 新需求 → 任务映射

| 用户需求 | 对应任务 | 状态 |
|---|---|---|
| 1. 对话框加项目 + 历史会话 | UCA-041（已扩展）| done |
| 2. 一次输入 → 多个 todo / 子任务卡片 | UCA-042 | done |
| 3. 聊天框数字 badge / 右下角 todo list 图标 | UCA-043 | done |
| 4. 邮箱监测 + 弹总结 + 自动 schedule + 回复追踪 | UCA-044 | done |
| 5. 早晨 5 分钟内邮件汇总 + 多账户 | UCA-045 | done |
| 6. Schedule 提前提醒 + 日历视图 + 分类颜色 | UCA-046（+ UCA-010/036 标注扩展）| done |
| 7. 活动主窗口深度上下文（文件路径 / 网页链接）| UCA-047（+ UCA-029 标注扩展）| done |
| 8. 默认文件输出路径 | UCA-048 | done |
| 9. 功能开关 + 被屏蔽功能时引导跳转设置 | UCA-048 | done |
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

## 2026-04-11 框架升级追加（UCA-050~057）

### 背景

用户反馈 4 个核心运行时问题：程序无法理解输入 / 错误拆分任务 / 打不开程序 / AI 调用不了工具。  
ChatGPT 提出了架构升级方案（TaskSpec 单一信息源），经代码审计 + DeerFlow 框架参考后制定以下升级任务。

### 新需求 → 任务映射

| 用户问题 | 对应任务 | 状态 |
|---|---|---|
| 打不开程序（Electron silent 启动失败）| UCA-050 | todo |
| 程序无法理解输入（substring 误匹配）| UCA-051 + UCA-052 | todo |
| 错误拆分任务（decomposer silent 失败）| UCA-056 | todo |
| AI 调用不了工具 / 不能主动搜索 | UCA-054 | todo |
| AI 说"完成"但文件不存在 | UCA-053 | todo |
| 文档生成是空壳 fixture | UCA-055 | todo |
| 关闭 UCA-037 连续翻译 bug | UCA-057 | todo |
| 关闭 UCA-039 搜索旧内容 bug | UCA-057 | todo |
| Overlay/Console/Note/Preview 交互升级 | UCA-084 | in_progress |
| 联网搜索变慢 / Dock 运行态 / Popup 消失 / 自动任务错归类 | UCA-085 | done |

### UCA-026 处理说明

UCA-026（External Trial Validation）需要第二台机器外部验证，本机无法闭环。  
已转换为**可选 QA 文档检查单**，不再作为任何新任务的 blocking 依赖。

### 跨任务依赖关系（UCA-050~057）

```
UCA-050 (启动修复) ──────────────────────────────────────> P0，先做
       ↓
UCA-051 (TaskSpec) ──> UCA-052 (Intent分类) ──> UCA-056 (Decomposer)
       ├──> UCA-053 (File Discovery) ──> UCA-055 (DocGen)
       └──> UCA-054 (ReAct) ──────────────────────────────> UCA-057 (关闭037/039)
```

### 实施关键路径（最快让程序可用）

`UCA-050 → UCA-051 → UCA-054 → UCA-057`
