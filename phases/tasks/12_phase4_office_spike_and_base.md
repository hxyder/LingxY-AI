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

- 状态：done
- 执行分支：`task/uca-012-phase4-office`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- spike 选中的路径：
  - 当前 Phase 4 基础交付选择 `C. protocol handler fallback`
  - `https://localhost:9413` 保留为后续增强路径，不阻塞当前 ship
- 企业环境限制：
  - 企业 GPO 可能禁止安装自签根证书
  - Office WebView 在部分加固环境中即使导入根证书也可能拒绝 `localhost TLS`
  - 因此当前基础版不把直连本地 HTTPS 当成必达前提
- 是否支持文档回写：
  - 当前基础版不把文档回写作为 ship 前提
  - manifest / endpoint / transport 预留了 writeback 落点，但未接真实 Office.js 回写执行
- 实际新增内容：
  - 新增 `office_addin/word|excel|ppt/manifest.xml` 与 `office_addin/shared/` Task Pane 骨架
  - 新增 `src/service/core/office-submission.mjs`，完成 `office_selection -> Security Broker -> task` 基础链路
  - 新增 `src/service/https/`，记录 localhost TLS spike 选项、9413 端口清单与回退策略
  - 新增运行文档：`office_addin_sideload.md`、`self_signed_cert_setup.md`、`office_https_spike_report.md`
  - 新增验证脚本 `scripts/verify-office-base.mjs`
- 验证结果：
  - `node scripts/verify-office-base.mjs`
  - `npm run check`
- 遗留问题：
  - 当前 Add-in 仍是骨架，没有真实 Office.js API 调用与真实 HTTPS server
  - Task Pane 目前用 bridge 占位，不包含真实流式结果渲染
  - 文档回写、Excel 写回和 PowerPoint 备注回写仍未实现
  - Office Add-in Validator 尚未在真实开发环境里执行
- 交接给下一个任务：
  - `UCA-014` 可直接复用 `office_selection` ContextPacket、Task Pane 骨架、9413 transport manifest 与 spike 结论
  - 后续若推进增强版，可从 `src/service/https/` 和 `office_addin/shared/office_bridge.js` 继续接真实 localhost HTTPS / 回写链
