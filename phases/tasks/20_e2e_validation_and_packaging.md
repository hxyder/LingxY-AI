# Task UCA-020 — 端到端验证、安装打包与发布准备

## 1. 任务目标

把当前仓库从“开发态可运行”推进到“可交付给真实用户试用”的安装包、验证矩阵和发布准备状态。

## 2. 前置依赖

- 上一个任务：UCA-016、UCA-017、UCA-018、UCA-019
- 必须已有的产物：真实入口、真实运行时、真实 UI、真实模板与 AI runtime
- 不能同时修改的区域：产品范围和协议主干

## 3. 实施范围

- 负责模块：安装包、签名/证书策略、版本号、迁移脚本、E2E 验证矩阵、已知问题列表、试用发布清单
- 允许改动文件/目录：`scripts/`, `docs/`, `tools/`, 打包配置目录
- 明确不做：GA 后的团队协作功能、插件市场

## 4. 交付产物

- 本地安装包 / sideload 包
- 版本化发布说明
- E2E 验证矩阵
- 已知问题与回滚方案

## 5. 验证方式

- `npm run check`
- 端到端人工回归
- 至少一轮新机器安装验证
- 发布前 checklist 全部通过

## 6. Git 执行方式

- 分支名：`task/uca-020-e2e-packaging`
- Commit 格式：`UCA-020: prepare packaging and e2e validation`
- 合并条件：试用发布包、E2E 矩阵与回滚方案齐备

## 7. 完成后必须更新本文件

- 写明打包产物与版本号
- 写明验证矩阵与通过结果
- 记录已知问题、风险接受项和回滚步骤

## 8. 对下一个任务的交接

- 下一个任务：试用发布后的反馈回路
- 本任务新增了什么：可交付发布基线
- 下一个任务直接可复用什么：安装包、验证矩阵、已知问题列表、发布说明
- 还没解决的问题：试用期反馈、GA 前产品裁剪与长期运维

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-020-e2e-packaging`
- 开始日期：2026-04-08
- 完成日期：2026-04-09
- 实际新增内容：新增 `docs/release/` 发布文档区，包含 trial release notes、E2E 验证矩阵、已知问题与回滚方案；新增 `tools/release/release-config.json` 作为试用发布配置；新增 `scripts/build-trial-package.mjs` 生成版本化 trial bundle、release manifest、checksums 和安装说明；新增 `scripts/verify-release-readiness.mjs` 验证发布文档、trial bundle、桌面启动烟测与 readiness report；仓库入口文档和结构校验已同步接入 release 目录；trial bundle 现在额外生成 `Check UCA Desktop Trial.cmd`、`Setup UCA Desktop Trial.cmd`、`Launch UCA Desktop Trial.cmd` / `Stop UCA Desktop Trial.cmd`；新增 `scripts/setup-trial.ps1` 作为桌面优先的试用准备脚本，默认准备 Explorer 右键入口并启动桌面壳；新增 `scripts/check-trial-prereqs.ps1` 作为试用前检查脚本，用于确认 Node、依赖、Electron CLI 和 Kimi CLI 状态；新增 `scripts/generate-trial-readiness-report.mjs`，将当前机器的预检、bundle 信息和剩余人工验证项固化为 `TRIAL_READINESS_REPORT.md` / `.json`；新增 `scripts/verify-trial-launch.mjs` 与 `scripts/verify-trial-launch.ps1`，把 `start-trial.ps1` / `stop-trial.ps1` 的桌面壳拉起与回收纳入自动验证；`build-trial-package` 也补了 Windows 下删除旧 bundle 的重试逻辑，避免 trial 包重建时偶发失败。
- 验证结果：`build:trial-package`、`verify-trial-launch`、`generate-trial-readiness-report`、`verify-release-readiness`、`npm run check`、`powershell -ExecutionPolicy Bypass -File .\scripts\setup-trial.ps1 -DryRun`、`powershell -ExecutionPolicy Bypass -File .\scripts\check-trial-prereqs.ps1` 均已通过；本地已生成 `dist/trial/0.1.0-trial.1/` 版本化试用包目录、一键入口和 readiness report。
- 遗留问题：当前产物仍是 repo-local trial sideload bundle，不是可脱离仓库独立运行的签名安装程序；新机器人工安装验证和 SmartScreen 反馈仍需线下执行。
- 交接给下一个任务：`UCA-026` 可直接复用 `npm run build:trial-package` 产出的 bundle、release manifest、E2E 矩阵、桌面启动器、readiness report 和 rollback 文档，继续完成外部试用验证。
