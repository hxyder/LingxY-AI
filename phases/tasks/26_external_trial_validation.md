# Task UCA-026 — 外部试用验证与反馈闭环

## 1. 任务目标

把当前 repo-local desktop trial 从“本机验证通过”推进到“新机器可安装试用、风险已记录、反馈可回流”的外部试用状态。

## 2. 前置依赖

- 上一个任务：UCA-020
- 必须已有的产物：版本化 trial bundle、桌面启动烟测、readiness report、安装说明
- 不能同时修改的区域：协议主干与已冻结的 release baseline

## 3. 实施范围

- 负责模块：新机器安装验证、SmartScreen/Defender 观察、试用反馈收集、GA 前裁剪建议
- 允许改动文件/目录：`docs/release/`, `phases/tasks/`
- 明确不做：新的产品功能开发、云端协作能力

## 4. 交付产物

- 至少一轮新机器安装记录
- SmartScreen / Defender 反馈记录
- 试用反馈摘要
- GA 前保留项与裁剪建议

## 5. 验证方式

- 真实新机器按 `INSTALL.txt` 或 `Setup UCA Desktop Trial.cmd` 完成试用准备
- 至少完成一轮桌面启动、文件右键入口、Kimi 任务执行
- 回写已知问题、风险接受项和下一轮修复优先级

## 6. Git 执行方式

- 分支名：`task/uca-026-external-trial-validation`
- Commit 格式：`UCA-026: capture external trial validation`
- 合并条件：至少一轮外部试用记录已落文档

## 7. 完成后必须更新本文件

- 写明试用环境、安装结果与失败点
- 写明 SmartScreen / Defender / 权限提示情况
- 写明试用反馈、保留项和下一步建议

## 8. 对下一个任务的交接

- 下一个任务：GA 打包与签名准备
- 本任务新增了什么：真实外部试用证据与裁剪建议
- 下一个任务直接可复用什么：trial bundle、release 文档、反馈摘要
- 还没解决的问题：签名安装器、正式发布与长期运营

## 9. 执行记录

- 状态：in_progress
- 执行分支：`task/uca-026-external-trial-validation`
- 开始日期：2026-04-09
- 完成日期：
- 实际新增内容：新增 `docs/release/external_trial_checklist.md` 作为外部试用执行清单；新增 `docs/release/trial_feedback_template.md` 作为统一反馈模板；trial bundle 资产清单、release 文档入口和自动验证已同步接入这两份文档，方便直接随包发给测试者。
- 验证结果：`node scripts/verify-release-readiness.mjs`、`npm run check`
- 遗留问题：
- 交接给下一个任务：
