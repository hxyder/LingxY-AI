# Task UCA-031 — 结果中心与多格式资产管理

## 1. 任务目标

把结果文件、预览、下载 / 打开、格式切换收敛成统一资产中心，减少“结果在哪里”“打开哪个文件”的不确定性。

## 2. 前置依赖

- 上一个任务：UCA-028、UCA-030
- 必须已有的产物：多格式 artifact、Overlay 结果摘要、控制台历史能力
- 不能同时修改的区域：artifact 存储主干与 runtime persistence 基线

## 3. 实施范围

- 负责模块：artifact 策略、预览优先级、结果中心 UI、格式切换与打开逻辑
- 允许改动文件/目录：`src/service/store/`, `src/desktop/renderer/`, `src/desktop/console/`, `phases/tasks/`
- 明确不做：云端文件同步、版本管理

## 4. 交付产物

- 结果中心入口
- artifact 预览优先级策略
- 多格式结果打开 / 复制 / 继续处理能力
- 对应验证脚本更新

## 5. 验证方式

- 单任务多 artifact 预览 smoke test
- 控制台历史结果打开 smoke test
- `npm run check`

## 6. Git 执行方式

- 分支名：`task/uca-031-artifact-center`
- Commit 格式：`UCA-031: add artifact center`
- 合并条件：用户能在 UI 中明确知道当前任务产出的结果文件与推荐打开方式

## 7. 完成后必须更新本文件

- 写明结果中心入口
- 写明多格式结果的优先级策略
- 写明仍需补充的格式或预览限制

## 8. 对下一个任务的交接

- 下一个任务：试用收口与跨媒介体验打磨
- 本任务新增了什么：统一结果资产管理
- 下一个任务直接可复用什么：artifact 策略、结果中心 UI
- 还没解决的问题：更复杂预览器、外部编辑协作

## 9. 执行记录

- 状态：done
- 执行分支：`main`
- 开始日期：2026-04-10
- 完成日期：2026-04-11
- 实际新增内容：
  - Overlay 新增结果中心、artifact 列表、多格式结果预览切换、复制结果路径、把当前结果作为上下文继续处理
  - Console 任务详情新增结果资产面板，历史搜索结果可跳回对应任务并打开结果
  - **新增 Console `Files` Tab（跨任务全局文件管理器）**：在 Console 顶栏加入新标签，两栏布局 —— 左栏列出最近 30 个已完成任务产出的全部 artifact（带过滤 / 刷新按钮 / 按时间倒序），右栏是预览 + Open / Show in Folder / Copy Path 按钮
  - `isPreviewableArtifactPath` 扩展支持 19 种代码文件扩展名（.js/.ts/.py/.rs/.go/.java/.cpp/.cs/.php/.sh/.ps1/.yaml/.toml/...），代码文件也能在 Console Files Tab 内联预览
  - Overlay 气泡内的 artifact 通知新增 `打开文件 / 预览 / 复制路径` 三个内联按钮
  - 移除旧的"任务完成自动打开文件"行为 —— 改为用户显式点击才打开，避免抢焦点
- 验证结果：`node scripts/verify-overlay-composer.mjs`、`node scripts/verify-desktop-renderer.mjs`、`npm run check` 通过
- 遗留问题：
  - docx 等非文本格式当前仍以路径 / 外部打开为主，复杂富媒体预览器暂未内建
  - 文件"版本历史"、"标签分类"尚未实现 —— 当前只有按任务分组和按时间排序
- 交接给下一个任务：可直接复用 artifact 列表、预览优先级和 Files Tab 布局，继续扩展成更完整的资产管理体验
