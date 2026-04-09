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
| 17 | UCA-017 | [17_real_ai_and_multimodal.md](17_real_ai_and_multimodal.md) | AI Runtime | UCA-015,UCA-016 | `task/uca-017-real-ai` | in_progress |
| 18 | UCA-018 | [18_console_and_operator_ui.md](18_console_and_operator_ui.md) | UI | UCA-015,UCA-016 | `task/uca-018-console-ui` | in_progress |
| 19 | UCA-019 | [19_template_persistence_and_dag_resume.md](19_template_persistence_and_dag_resume.md) | Platform Hardening | UCA-015,UCA-017,UCA-018 | `task/uca-019-template-dag` | in_progress |
| 20 | UCA-020 | [20_e2e_validation_and_packaging.md](20_e2e_validation_and_packaging.md) | Release Readiness | UCA-016,UCA-017,UCA-018,UCA-019 | `task/uca-020-e2e-packaging` | in_progress |

## 当前执行规则

- 已完成 UCA-000 ~ UCA-014 的骨架与规范收口
- 下一阶段从 UCA-015 开始进入“真实运行时、真实集成、真实 UI、发布验证”四类收尾任务
- 每完成一个任务，必须同步更新对应任务文件和本索引
- 若出现阻塞，先把任务状态改为 `blocked`，再由下一次计划会议决定是否拆新任务
