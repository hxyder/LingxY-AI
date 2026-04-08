# Task UCA-000 — 仓库与 Git 基线

## 1. 任务目标

把当前目录变成可执行的工程仓库，为后续所有任务提供统一 Git、CI、分支和验证基线。

## 2. 前置依赖

- 上一个任务：无
- 必须已有的产物：当前 `phases/` 正式文档
- 不能同时修改的区域：无

## 3. 实施范围

- 负责模块：仓库初始化、`.gitignore`、基础 README、CI 骨架
- 允许改动文件/目录：仓库根目录、`.github/`、`README.md`、`docs/`、`src/`
- 明确不做：业务代码实现

## 4. 交付产物

- Git 仓库初始化
- `.gitignore`
- 根 README 的开发约定
- 最小 CI 骨架（lint/test/build 占位）
- 文档归位到 `docs/planning/`
- AI provider / code CLI / MCP / skills 预留接口与目录

## 5. 验证方式

- `git status`
- `git branch`
- CI 配置文件通过语法检查
- README 能说明后续开发方式

## 6. Git 执行方式

- 分支名：`task/uca-000-repo-bootstrap`
- Commit 格式：`UCA-000: bootstrap repository workflow`
- 合并条件：仓库已初始化，CI 骨架可被识别

## 7. 完成后必须更新本文件

- 填写默认分支名
- 填写 CI 文件位置
- 写明初始化后仓库结构

## 8. 对下一个任务的交接

- 下一个任务：UCA-001
- 本任务新增了什么：Git 基线、CI 骨架、根目录约定
- 下一个任务直接可复用什么：分支工作流、任务文件回写机制
- 还没解决的问题：技术栈依赖版本仍未冻结

## 9. 执行记录

- 状态：done
- 执行分支：`task/uca-000-repo-bootstrap`
- 开始日期：2026-04-08
- 完成日期：2026-04-08
- 实际新增内容：
  - 初始化 Git 仓库，默认分支为 `main`
  - 新增根目录 `README.md`、`.gitignore`、`package.json`、`tsconfig.base.json`
  - 新增 `.github/workflows/repo-baseline.yml`
  - 将主方案与需求响应文档归位到 `docs/planning/`
  - 新增 `scripts/verify-structure.mjs`
  - 建立 `src/desktop`、`src/service`、`src/shared`、`browser_ext`、`office_addin`、`external`、`tests`、`tools` 等骨架目录
  - 预留 AI provider、code CLI、MCP、skills 的共享接口与目录结构
- 验证结果：
  - `node scripts/verify-structure.mjs` 通过
  - 目录结构检查通过
  - `git init -b main` 成功
  - `git checkout -b task/uca-000-repo-bootstrap` 成功
- 遗留问题：
  - 还没有远程仓库配置
  - 还没有实际业务代码与依赖安装流程
  - CI 目前只验证结构，不验证构建或测试
- 交接给下一个任务：
  - 从 `UCA-001` 开始冻结 PRD、总体架构图和进程拓扑
  - 新文档应优先放在 `docs/` 下，正式执行规范继续以 `phases/` 和 `phases/tasks/` 为主
  - 后续新增 AI / CLI / MCP / skills 适配器时，优先复用 `src/shared/contracts/` 下的接口
