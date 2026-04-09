# Task UCA-019 — 模板持久化、DAG 恢复与平台增强

## 1. 任务目标

把 Phase 6 的平台化能力从“内置样例 + 一次性运行”升级成“可保存、可导入导出、可恢复、可搜索”的真实平台功能。

## 2. 前置依赖

- 上一个任务：UCA-015、UCA-017、UCA-018
- 必须已有的产物：真实运行时、真实 AI 执行器、真实 console UI
- 不能同时修改的区域：发布打包

## 3. 实施范围

- 负责模块：模板持久化、导入导出、模板校验器、DAG checkpoint / resume、历史向量库持久化、预算超限 UI 联动
- 允许改动文件/目录：`src/service/templates/`, `src/service/dag/`, `src/service/embeddings/`, `src/service/cost/`, `src/desktop/console/`
- 明确不做：插件市场、多人协作、云端常驻 agent

## 4. 交付产物

- 用户模板存储
- 模板导入 / 导出
- DAG 从失败节点恢复
- 持久化历史搜索

## 5. 验证方式

- `npm run check`
- 模板导入/导出回归
- DAG 失败恢复验证
- 历史搜索数据重启后仍可用

## 6. Git 执行方式

- 分支名：`task/uca-019-template-dag`
- Commit 格式：`UCA-019: persist templates and dag resume`
- 合并条件：模板、DAG、历史搜索三条平台增强路径都可真实操作

## 7. 完成后必须更新本文件

- 写明模板存储位置与 schema 升级策略
- 写明 DAG 恢复边界
- 记录历史搜索持久化后端

## 8. 对下一个任务的交接

- 下一个任务：UCA-020
- 本任务新增了什么：可保存的平台能力与恢复机制
- 下一个任务直接可复用什么：模板存储、DAG 恢复、持久化历史搜索、预算 UI 联动
- 还没解决的问题：安装包、签名、兼容矩阵和正式发布验证

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-019-template-dag`
- 开始日期：2026-04-08
- 完成日期：2026-04-09
- 实际新增内容：运行时目录补齐 `data/templates`、`data/history`、`data/dag/runs`、`data/budget.json` 等持久化位置；模板注册表升级为 builtin + user 双层存储，新增保存 / 导入 / 导出 / 删除接口；历史搜索存储升级为可持久化本地记录，并在任务完成后自动写入搜索索引；预算管理器支持本地持久化与限额更新；DAG 运行支持 checkpoint 保存、执行列表读取与失败后 resume；console runtime client 新增模板、预算与 DAG 相关接口，并把模板编辑器 / DAG 面板接入 workspace snapshot；Electron 控制台已补齐模板 JSON 导入、模板导出预览、DAG 定义校验、执行快照查看与失败后恢复入口。
- 验证结果：`verify-console-runtime-client`、`verify-template-dag-persistence`、`verify-platform-foundation`、`verify-console-rendered-workspace`、`verify-desktop-renderer`、`npm run check` 均已通过。
- 遗留问题：真实 DAG 节点执行器仍是平台占位实现，模板 schema 迁移策略与导入冲突处理后续仍可继续细化，但本任务范围内的持久化、导入导出和恢复能力已可真实操作。
- 交接给下一个任务：发布验证和试用反馈阶段可直接复用模板存储、JSON 导入导出、DAG 预览与恢复、持久化历史搜索和预算联动能力。
