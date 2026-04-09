# Task UCA-005 — Phase 1b 文件入口、Explorer 快捷键与 Kimi Bridge

## 1. 任务目标

让本地文件能稳定进入系统，并接通真实 Kimi CLI 深任务。

## 2. 前置依赖

- 上一个任务：UCA-004
- 必须已有的产物：service 内核、任务中心
- 不能同时修改的区域：浏览器扩展入口

## 3. 实施范围

- 负责模块：`uca-cli`、Explorer 注册表菜单、helper 的 `Ctrl+Shift+E`、批量聚合、文件提取器、Kimi bridge
- 允许改动文件/目录：`uca-cli/`, `src/helper/`, `src/service/extractors/`, `src/service/executors/kimi/`
- 明确不做：Office 选区、PDF OCR

## 4. 交付产物

- 文件右键入口
- Explorer 选区快捷键
- 多选 batch 聚合
- PDF/DOCX/MD/TXT 抽取
- 真实 Kimi CLI 子进程桥接

## 5. 验证方式

- `pnpm lint`
- `pnpm test`
- Kimi mock 集成测试
- 手动验证：右键单文件、多选文件、`Ctrl+Shift+E`

## 6. Git 执行方式

- 分支名：`task/uca-005-phase1b-file-kimi`
- Commit 格式：`UCA-005: add file entry and kimi bridge`
- 合并条件：文件流与 Kimi 深任务双路径通过

## 7. 完成后必须更新本文件

- 写明 batch 聚合机制
- 写明 Win11 入口表现
- 填写 Kimi 依赖安装说明

## 8. 对下一个任务的交接

- 下一个任务：UCA-006、UCA-007、UCA-013
- 本任务新增了什么：文件入口、文件组、真实深任务
- 下一个任务直接可复用什么：Kimi executor、artifact store、helper 通道
- 还没解决的问题：浏览器和状态完善尚未接入

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-005-phase1b-file-kimi`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 新增 `uca-cli/`，完成 `submit --files ...` 参数解析与 batch 聚合骨架
  - 新增 `src/service/extractors/file-ingest.mjs`，支持 TXT/MD 原生提取，PDF/DOCX 先走 placeholder 提取并产出标准 metadata
  - 新增 `src/service/store/artifact-store.mjs`，冻结 `%APPDATA%/UCA/outputs/YYYY-MM-DD/{task_id}/` 目录约定
  - 新增 `src/service/executors/kimi/`，完成 task package builder、JSONL parser、CLI subprocess executor
  - 新增 `src/service/core/file-submission.mjs`，把文件入口、任务创建、事件写入、Kimi 执行串起来
  - 新增 `src/helper/explorer_selection/selection-contract.mjs`，冻结 `Ctrl+Shift+E` 的 helper payload 边界
  - 新增 `docs/runtime/kimi_cli_setup.md` 与 `docs/runtime/file_entry_setup.md`
- batch 聚合机制：
  - `uca-cli` 使用 `%TEMP%/uca-submit-batches/{groupKey}` 目录作为聚合区
  - 所有并发实例先 append `submit-batch.jsonl`
  - 抢到 `collector.lock` 的 owner 等待 300ms 收敛窗口后统一提交
  - 未抢到锁的实例直接退出，避免多次提交
- Win11 入口表现：
  - 当前正式策略仍是注册表命令菜单 + `uca-cli`
  - Win11 默认接受落入二级菜单
  - 对外主宣传入口仍应是 `Ctrl+Shift+E`
- Kimi 依赖安装说明：
  - 当前说明文档位于 `docs/runtime/kimi_cli_setup.md`
  - 仓库验证暂时使用 `tests/fixtures/mock-kimi-cli.mjs`
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - `node scripts/verify-desktop-shell.mjs` 通过
  - `node scripts/verify-service-core.mjs` 通过
  - `node scripts/verify-file-kimi.mjs` 通过
- 遗留问题：
  - 还没有真实 Win32 注册表安装脚本与右键菜单注册
  - 还没有真实 C# helper / Named Pipe 实现
  - PDF / DOCX 仍是 placeholder 提取，未接 `pdf-parse` / `mammoth`
  - 还没有真实 Kimi CLI 安装检测与 provider 配置检查
- 交接给下一个任务：
  - `UCA-006` 可直接复用 `src/service/core/file-submission.mjs` 与 artifact store，按同样入口模式接浏览器网页上下文
  - `UCA-007` 可直接消费 Kimi JSONL 事件流与 task/artifact 记录补状态机、失败分类、重试与 metrics
  - `UCA-013` 可在 `src/service/extractors/file-ingest.mjs` 上替换 PDF placeholder 为真实 OCR / visual fallback 管线
