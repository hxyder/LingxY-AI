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

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
