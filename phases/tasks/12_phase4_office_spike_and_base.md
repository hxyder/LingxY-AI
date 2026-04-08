# Task UCA-012 — Phase 4 Office Spike 与基础集成

## 1. 任务目标

先在 5 个工作日内给出 Office localhost HTTPS 结论，再至少交付“选区采集 → 发任务 → 控制台查看结果”的基础路径。

## 2. 前置依赖

- 上一个任务：UCA-009
- 必须已有的产物：Security Broker、基础 service API
- 不能同时修改的区域：PDF / OCR

## 3. 实施范围

- 负责模块：Office spike、Task Pane、Word/Excel/PPT 选区采集、基础提交路径
- 允许改动文件/目录：`office_addin/`, `src/service/https/`
- 明确不做：把回写能力作为本任务唯一验收前提

## 4. 交付产物

- HTTPS spike 结论
- Office Add-in 骨架
- 基础选区采集
- 基础任务提交链路

## 5. 验证方式

- 5 工作日 spike 报告
- Office Add-in Validator
- 手动验证 Word / Excel / PPT 各一条基础流程

## 6. Git 执行方式

- 分支名：`task/uca-012-phase4-office`
- Commit 格式：`UCA-012: deliver office spike and base integration`
- 合并条件：基础验收达成；增强验收可延期

## 7. 完成后必须更新本文件

- 写明 spike 选中的路径
- 写明企业环境限制
- 写明是否支持文档回写

## 8. 对下一个任务的交接

- 下一个任务：UCA-014
- 本任务新增了什么：Office 基础入口与 spike 结论
- 下一个任务直接可复用什么：office_selection ContextPacket、Add-in 通信链
- 还没解决的问题：若走降级路径，回写能力仍待后续优化

## 9. 执行记录

- 状态：todo
- 执行分支：
- 开始日期：
- 完成日期：
- 实际新增内容：
- 验证结果：
- 遗留问题：
- 交接给下一个任务：
