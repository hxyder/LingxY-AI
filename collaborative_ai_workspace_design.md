# 多人多模型共创工作区：合作模式设计方案

## 0. 核心定位

这个功能不应该只是“发送链接邀请别人加入项目”，而应该升级为一个 **多人 × 多 LLM × 多 Agent × 多工具 × 多项目上下文** 的协作系统。

它的核心定位是：

> 一个根据任务复杂度自动切换 UI 的多人多模型共创工作区。用户既可以独自调用多个 LLM 协作，也可以邀请别人加入项目，并允许别人带自己的 LLM、Agent 和工具共同完成任务。系统通过任务房间、上下文包、AI 角色、权限控制、审批 Inbox、交接卡、决策记录和项目记忆来优化分工、沟通、速度和信息传递。

可以命名为：

- Collaborative AI Workspace
- Co-creation Workspace
- Linxi Collaboration Mode
- 灵犀共创模式
- 多人多模型协作工作台

---

## 1. 核心目标

合作模式需要支持以下能力：

1. 用户可以发送邀请链接或复制链接，邀请别人加入项目。
2. 加入者可以根据权限查看、评论、编辑、执行任务。
3. 每个人可以绑定自己的 LLM API Key、CLI 工具或本地模型。
4. 一个项目中可以同时使用多个 LLM，例如 GPT、Claude、Gemini、DeepSeek、Kimi、Qwen、GLM、本地模型。
5. 不同 LLM 可以承担不同角色，例如 supervisor、planner、coder、reviewer、writer、researcher、repairman。
6. 每个成员的模型消耗、token、费用、执行记录都能追踪。
7. 项目拥有统一上下文、文件树、任务流、知识库和执行日志。
8. 协作过程可审计、可回滚、可复现。
9. 轻任务要快速启动，重项目要稳健管理。
10. AI 输出不能只停留在聊天里，要沉淀为任务、文档、决策、代码、报告、图表、PPT 等项目资产。

---

## 2. 基本协作关系

### 2.1 自己和多个 LLM 合作

这是个人多模型模式。

适合场景：

- 自己写报告
- 自己做研究
- 自己开发工具
- 自己做 PPT
- 自己完成一个复杂项目，但希望不同模型分工

示例：

```text
用户：
帮我做一个 AI 行业分析报告。

GPT Supervisor：
拆分任务、规划路线。

Gemini Researcher：
分析长文档和资料。

Claude Reviewer：
审查逻辑和表达。

Kimi Coder：
如果需要代码或自动化脚本，就执行。

Qwen Writer：
生成中文版本。

Local Model：
处理隐私内容。
```

这种模式下，UI 应该相对轻量，重点是：

- 模型选择
- 任务拆分
- 输出合并
- 快速对比
- 成本控制
- 上下文管理

---

### 2.2 自己和别人合作

这是普通多人协作模式。

适合场景：

- 和朋友做项目
- 和同事做产品方案
- 和导师/学生做研究
- 和客户做交付
- 和合伙人做创业项目

成员可以：

- 查看项目
- 编辑文档
- 评论任务
- 上传文件
- 提出需求
- 参与评审
- 确认交付物

重点是：

- 权限
- 沟通
- 任务分工
- 版本控制
- 决策记录
- 通知
- 交付物管理

---

### 2.3 自己、别人、别人的 LLM 一起合作

这是最有差异化的模式。

场景：

```text
Sophie 创建项目。
Sophie 带 GPT 和 Kimi。
Alex 加入项目，带 Claude。
Ming 加入项目，带 Gemini。
另一个成员带本地 Llama 或公司私有模型。
```

项目成员可以显示为：

```text
Human Members:
- Sophie / Owner
- Alex / Editor
- Ming / Reviewer

AI Members:
- Sophie 的 GPT Supervisor
- Sophie 的 Kimi Code Agent
- Alex 的 Claude Reviewer
- Ming 的 Gemini Researcher
- Company Private Model / Internal Knowledge Agent
```

这个模式的核心问题是：

- 谁提供了哪个模型？
- 谁可以调用哪个模型？
- 费用算谁的？
- 模型能看哪些文件？
- 模型能不能改文件？
- 模型输出由谁负责？
- 模型之间如何协作？
- 发生冲突谁来裁决？

---

## 3. 协作强度分层

不同项目的协作强度不一样，UI 必须分层。不能所有任务都进入复杂项目管理界面。

建议分成 4 个等级。

---

### Level 1：轻任务 Quick Task

适合：

- 写一封邮件
- 改一段文案
- 总结一篇文章
- 翻译一段内容
- 生成一个小方案
- 让两个模型比较一下观点
- 找一个资料
- 快速问同事一个问题

UI 应该像一个轻量弹窗或小工作区。

需要：

```text
1. 输入框
2. 选择协作者
3. 输出区
4. 一键操作按钮
5. 简单历史
```

示例：

```text
Task: 帮我优化这段产品介绍

Collaborators:
[GPT Writer] [Claude Reviewer]

Output:
- GPT 改写版本
- Claude 审查意见
- 综合版本

Actions:
[插入文档] [复制] [发给 Alex 审核] [保存为任务]
```

不需要：

- 完整看板
- 复杂权限
- 任务依赖图
- 成本分析大面板
- 审计日志默认展开

原则：

> 用户 10 秒内开始，30 秒内得到结果，复杂功能全部隐藏。

轻任务需要一个重要按钮：

```text
[Convert to Project Task]
```

当轻任务变复杂，用户可以一键升级为正式任务。

---

### Level 2：中等任务 Task Room

适合：

- 写一份报告
- 做一个小型调研
- 设计一个页面
- 修一个 bug
- 整理一次会议纪要
- 生成一个 PPT 初稿
- 和两三个人一起完成一个交付物

Task Room UI：

```text
左侧：任务上下文
中间：主要产物
右侧：AI 协作面板
底部：评论和执行日志
顶部：状态、负责人、截止时间、协作者
```

示意：

```text
┌────────────────────────────────────────────────────────────┐
│ Task: 生成 AI 行业分析报告                                 │
│ Status: In Progress  Owner: Sophie  Due: Friday             │
├───────────────┬───────────────────────────┬────────────────┤
│ Context       │ Main Artifact             │ AI Panel        │
│ - 目标         │ 报告正文 / PPT / 表格       │ @GPT 规划       │
│ - 资料         │                           │ @Claude 审查    │
│ - 限制         │                           │ @Gemini 研究    │
│ - 验收标准     │                           │                │
├───────────────┴───────────────────────────┴────────────────┤
│ Comments / Activity / Model Calls                           │
└────────────────────────────────────────────────────────────┘
```

核心功能：

- 任务目标
- 验收标准
- 参与者
- AI 角色
- 文件上下文
- 草稿区
- 评论区
- 版本记录
- 模型调用记录
- 一键提交审查

原则：

> 把“对话”变成“产物”，把“想法”变成“任务”，把“AI 回复”变成“可编辑结果”。

---

### Level 3：重项目 Project Workspace

适合：

- 开发一个产品
- 写一篇论文
- 做一个课程
- 完成一个商业计划
- 做一个客户交付项目
- 多人共创一个开源项目
- 设计并实现一个复杂系统

Project Workspace UI：

```text
顶部：项目状态、成员、AI、预算、邀请按钮
左侧：导航和文件树
中间：当前视图
右侧：AI / 上下文 / 审查面板
底部：运行日志、通知、审批队列
```

结构：

```text
Project: Linxi Agent Console

Top Bar:
[Invite] [Add LLM] [Members] [Budget] [Activity] [Share]

Left Nav:
- Overview
- Tasks
- Files
- Chat
- AI Collaborators
- Decisions
- Artifacts
- Knowledge
- Runs
- Settings

Center:
根据当前任务显示：
- 看板
- 文档
- 代码
- 表格
- 设计画布
- 数据分析
- 时间线
- 依赖图

Right Panel:
- AI 协作
- 当前上下文
- 审查意见
- 引用来源
- 风险提醒
- 下一步建议

Bottom:
- Agent runs
- Shell / tool logs
- Approval requests
- Notifications
```

原则：

> 让复杂协作可管理、可追踪、可回滚，而不是让聊天记录变成混乱的信息垃圾场。

---

### Level 4：长期组织空间 Organization / Team Space

适合：

- 公司
- 研究小组
- 创业团队
- 课程班级
- 开源社区
- AI studio
- 咨询团队

需要：

- 团队成员管理
- 组织知识库
- 共享 LLM 池
- 组织预算
- 全局权限
- 项目模板
- 跨项目搜索
- 标准工作流
- 审计和合规
- AI 使用统计

这个阶段可以晚一点做，但架构上要提前考虑。

---

## 4. 不同任务的工作区设计

系统不应该只有一种 UI。不同任务需要不同的主画布。

---

### 4.1 文档 / 写作工作区

适合：

- 报告
- 文章
- 邮件
- PRD
- 商业计划
- 论文
- 合同草稿
- 课程材料
- 演讲稿

UI 需要：

```text
中间：文档编辑器
左侧：大纲、资料、版本
右侧：AI 写作 / 审查 / 改写 / 引用
顶部：协作者、状态、分享
底部：评论、修改记录
```

AI 能力：

- 生成大纲
- 改写语气
- 检查逻辑
- 补充案例
- 提取摘要
- 生成不同版本
- 审查事实
- 生成引用
- 翻译
- 压缩长度

关键设计：

文档型任务最怕：

```text
AI 写了一堆东西，但不知道哪些能用。
多人改来改去，版本混乱。
评论散落在聊天里。
```

所以 UI 要有：

- AI 草稿区
- 正式正文区
- 建议接受 / 拒绝
- 逐段评论
- 版本对比
- 事实审查状态
- 引用来源状态

---

### 4.2 研究 / 资料分析工作区

适合：

- 行业研究
- 竞品分析
- 论文阅读
- 政策分析
- 市场调研
- 资料汇总
- 客户背景研究

UI 需要：

```text
中间：研究报告 / research board
左侧：来源库
右侧：AI Researcher
底部：证据表、引用、可信度
```

必备模块：

- Source Library：资料来源列表
- Evidence Cards：证据卡片
- Claim Table：关键结论表
- Citation Panel：引用面板
- Contradiction Detector：冲突观点检测
- Confidence Score：可信度评估
- Research Brief：研究简报

信息结构：

```text
结论：
AI coding agent 正在从聊天助手转向任务执行者。

证据：
- 某工具支持 agent 阅读仓库、制定计划、修改代码并创建 PR。
- 某项目管理工具支持把 issue 委托给 Agent。
- 企业 AI teammate 强调上下文、检查点和 guardrails。

风险：
- 不同工具对“责任归属”的处理不同。
- AI 自动执行必须有权限和审查机制。
```

研究型任务的信息传递原则：

```text
先结论
再证据
再来源
再不确定性
再下一步
```

---

### 4.3 代码 / 软件开发工作区

适合：

- 修 bug
- 开发功能
- 重构
- 写测试
- 生成脚本
- 部署
- 代码审查

UI 需要：

```text
左侧：文件树
中间：代码编辑器 / diff / PR
右侧：Coding Agent
底部：terminal / test logs / build logs
顶部：branch、task、review status
```

AI 能力：

- 阅读代码
- 生成实现计划
- 修改文件
- 运行测试
- 解释错误
- 提交 diff
- 生成 PR 描述
- 代码审查
- 安全检查
- 回滚修改

必备状态：

```text
Planning
Editing
Testing
Failed
Needs Human Input
Ready for Review
Approved
Merged
Rolled Back
```

代码任务流程：

```text
1. AI 先生成计划
2. 用户确认或自动进入低风险执行
3. AI 修改文件
4. 系统显示 diff
5. AI 运行测试
6. Reviewer LLM 审查
7. 人类批准合并
```

原则：

> 不要让 AI 直接“神秘地改完代码”。应该用“任务 → 分支 / 草稿 → 审查 → 合并”的结构。

---

### 4.4 设计 / 创意工作区

适合：

- UI 设计
- 品牌设计
- 海报
- 产品原型
- 视频脚本
- 游戏设定
- 故事板
- 营销素材

UI 需要：

```text
中间：画布
左侧：素材、组件、灵感板
右侧：AI Designer / AI Writer / AI Reviewer
底部：版本、评论、生成历史
```

AI 能力：

- 生成概念
- 生成多版方案
- 改风格
- 做竞品视觉分析
- 生成 UI 文案
- 检查一致性
- 生成设计说明
- 把需求转成页面结构

关键设计：

设计任务不适合线性聊天，适合“多分支画布”。

例如：

```text
方案 A：极简 SaaS 风格
方案 B：未来科技风格
方案 C：温暖社区风格

AI 可以分别继续迭代每个分支。
人类可以选择、合并、删除、评论。
```

UI 里要有：

- Variant Board：版本板
- Prompt History：生成历史
- Style Lock：风格锁定
- Human Notes：人工批注
- Compare Mode：多方案对比

---

### 4.5 数据 / 表格 / 分析工作区

适合：

- 销售数据分析
- 用户行为分析
- 财务模型
- 实验结果
- 问卷分析
- 运营报表
- 数据清洗

UI 需要：

```text
中间：表格 / 图表 / notebook
左侧：数据源
右侧：Data Analyst Agent
底部：代码、运行结果、错误日志
```

AI 能力：

- 解释数据
- 清洗数据
- 生成图表
- 发现异常
- 生成 SQL
- 跑 Python
- 写分析结论
- 生成 dashboard
- 比较不同指标

关键设计：

数据任务必须区分：

- 原始数据
- 清洗后数据
- 分析过程
- 图表
- 结论
- 假设
- 不确定性

不要让 AI 只给一句“销售增长了”，而要给：

- 指标变化
- 计算方式
- 数据范围
- 图表
- 异常点
- 可能原因
- 下一步验证

---

### 4.6 会议 / 沟通工作区

适合：

- 项目会议
- 客户会议
- 头脑风暴
- 站会
- 复盘
- 远程协作

UI 需要：

```text
中间：会议记录
左侧：议程、参与者、相关任务
右侧：AI Meeting Assistant
底部：action items、决策、问题
```

AI 能力：

- 生成议程
- 实时总结
- 提取 action items
- 识别决策
- 识别争议点
- 会后生成纪要
- 自动创建任务
- 提醒负责人

会议结束后，信息不能停留在 transcript 里。

应该自动拆成：

- Decisions：决定了什么
- Action Items：谁做什么，什么时候完成
- Open Questions：还有什么没定
- Risks：潜在风险
- Follow-ups：需要跟进谁

---

### 4.7 客户 / 外部合作工作区

适合：

- 咨询项目
- 外包项目
- 客户交付
- 投资人材料
- 合同沟通
- 外部评审

UI 需要：

- 内部视图
- 外部客户视图
- 共享文件区
- 审批区
- 交付物区
- 评论区

必须区分：

```text
Internal Only
团队内部可见

Client Visible
客户可见

AI Accessible
AI 可读取

Private Notes
私人笔记

Final Deliverables
正式交付物
```

客户不应该看到团队内部的所有讨论，AI 也不应该默认能读所有内部文件。

---

## 5. 统一项目 UI 架构

不管任务类型如何变化，底层应该有一套统一结构。

---

### 5.1 Top Bar 顶部栏

顶部栏负责项目级状态。

包括：

- 项目名称
- 当前模式：Solo / Team / Client / Public
- 在线成员
- 在线 AI
- 邀请按钮
- 添加 LLM
- 当前预算
- 全局搜索
- 通知
- 设置

示例：

```text
Linxi MVP Project

[Invite] [Add LLM] [Members: 5] [AI: 7] [Budget: $12.30 used] [Activity] [Settings]
```

AI 状态可以显示：

```text
GPT Supervisor: Planning
Claude Reviewer: Idle
Kimi Coder: Running tests
Gemini Researcher: Reading sources
```

---

### 5.2 Left Sidebar 左侧栏

左侧栏负责导航和上下文。

建议结构：

- Overview
- Inbox
- Tasks
- Files
- Chat
- Artifacts
- Decisions
- AI Collaborators
- Knowledge
- Runs
- Budget
- Settings

轻任务时只显示：

- Task
- Output
- History

重项目时显示完整导航。

---

### 5.3 Main Canvas 中央主画布

中央区域根据任务类型切换：

- 文档编辑器
- 代码编辑器
- 任务看板
- 设计画布
- 研究板
- 数据表格
- 图表 dashboard
- 会议纪要
- PR / diff
- 时间线
- 依赖图

原则：

> AI 的回复不应该永远在右侧聊天框里，重要输出必须进入中央画布。

---

### 5.4 Right AI Panel 右侧 AI 面板

右侧是 AI 协作层。

包括：

- 当前可用 AI
- @mention 输入框
- 上下文选择
- 模型选择
- 角色选择
- 工具权限
- 输出预览
- 审查建议
- 风险提醒
- 成本预估

示例：

```text
Ask:
[@GPT Supervisor] [@Claude Reviewer] [@Kimi Coder]

Context:
[x] 当前文件
[x] 当前任务
[x] 相关评论
[ ] 全项目文件
[ ] 外部知识库

Mode:
[Ask] [Draft] [Review] [Execute] [Compare] [Plan]
```

右侧 AI 面板最重要的是 **上下文选择**。

用户需要知道：

- AI 这次看到了什么？
- AI 没看到什么？
- AI 能不能修改？
- AI 会调用什么工具？
- 这次调用大概花多少钱？

---

### 5.5 Bottom Run Layer 底部运行层

底部用于显示执行过程。

特别是重任务、代码任务、数据任务，需要：

- Agent run logs
- Tool calls
- Terminal output
- Test results
- Errors
- Model calls
- Approvals
- Rollback points

轻任务中可以隐藏。

---

## 6. 协作角色体系

需要区分两类角色：

- 人类角色
- AI 角色

---

### 6.1 人类角色

```text
Owner
项目所有者，控制项目、预算、权限和最终交付。

Project Lead
项目负责人，负责拆分目标、协调进度、合并结果。

Contributor
贡献者，完成具体任务。

Reviewer
审查者，负责质量、事实、代码、设计或业务审查。

Client / Guest
外部参与者，只能查看或评论部分内容。

Operator
可以运行工具、调用 Agent、触发自动化。

Auditor
可以查看日志、成本、权限和历史记录。
```

---

### 6.2 AI 角色

```text
Supervisor Agent
理解目标、拆分任务、分配协作者、检查进度。

Researcher Agent
搜索、阅读、整理资料，生成证据卡和引用。

Writer Agent
写文档、邮件、报告、PPT 文案。

Coder Agent
阅读代码、修改文件、运行测试、生成 diff。

Reviewer Agent
审查代码、文档、事实、风险和逻辑。

Designer Agent
生成页面结构、视觉方向、交互建议。

Data Analyst Agent
处理数据、生成图表、解释指标。

Meeting Agent
整理会议、提取任务、生成纪要。

Coordinator Agent
追踪进度、提醒成员、生成 daily brief。

Safety / Policy Agent
检查权限、敏感信息、高风险操作。

Cost Optimizer Agent
选择便宜模型、控制 token、压缩上下文。

Repairman Agent
诊断失败任务、修复环境和流程问题。
```

---

## 7. 沟通形态设计

普通聊天不够。需要至少 5 种沟通形态。

---

### 7.1 Project Chat 项目总聊天

用于全局讨论。

```text
@Everyone 我们今天先定 MVP 范围。
@GPT 总结一下目前的争议点。
@Alex 你负责 API 设计可以吗？
```

适合：

- 开放讨论
- 项目公告
- 临时想法
- 快速沟通

---

### 7.2 Task Thread 任务线程

每个任务都有自己的讨论。

```text
TASK-102: 实现邀请链接权限

Thread:
Sophie: 这个任务需要支持过期时间。
Kimi: 我可以实现后端逻辑。
Claude: 我建议加 max_uses 字段。
Alex: 同意，前端也要显示剩余次数。
```

适合：

- 具体任务
- 决策记录
- 问题跟踪
- 上下文隔离

---

### 7.3 File Comment 文件评论

针对文档、代码、表格、设计的具体位置评论。

```text
第 3 段：
@Claude 这里逻辑是否有跳跃？

src/invite.ts 第 42 行：
@Kimi 这个 token 校验是否需要加 project_id？
```

适合：

- 精确反馈
- 局部修改
- 审查
- 批注

---

### 7.4 Decision Log 决策记录

很多项目失败不是因为没聊天，而是因为“做过的决定没人记得”。

决策记录格式：

```text
Decision:
邀请链接默认 7 天过期。

Reason:
降低泄露风险，同时不影响短期协作。

Decided by:
Sophie, Alex

AI Input:
GPT suggested 7 days.
Claude suggested configurable.

Date:
2026-04-30
```

适合：

- 产品选择
- 技术选择
- 范围取舍
- 预算决定
- 权限规则

---

### 7.5 Handoff Card 交接卡

当一个人或 AI 完成任务，需要把信息传给下一个人。

格式：

```text
Handoff: TASK-204

已完成：
- 实现 invite_links 表
- 添加 createInviteLink API
- 添加权限校验

未完成：
- 前端弹窗还没接入
- max_uses 还没测试

需要下一个人处理：
- @Alex 接前端
- @Claude 审查权限逻辑

风险：
- token 泄露后无法立即撤销，需要 revoke 功能
```

这个对速度非常重要。

---

## 8. 信息传递优化

系统最核心的能力之一应该是：

> 自动把聊天、AI 输出、文件修改、会议内容、任务进展整理成结构化项目状态。

建议设计一个 **Project Memory / Context Graph**。

---

### 8.1 项目图谱

项目里每个对象都是节点：

- User
- AI Agent
- Task
- File
- Artifact
- Comment
- Decision
- Source
- Model Call
- Run
- Budget
- Approval
- Risk
- Milestone

节点之间有关系：

- Task uses File
- Agent generated Artifact
- User approved Decision
- Comment mentions Task
- Model call modified File
- Source supports Claim
- Task depends on Task

这样 AI 才能真正理解项目，而不是每次从零开始。

---

### 8.2 Context Pack 上下文包

当用户把任务交给某个 AI，系统不应该把全项目内容一股脑塞进去。

应该生成一个上下文包。

示例：

```text
Context Pack for TASK-203

目标：
实现多人邀请链接。

相关文件：
- src/invite.ts
- src/project_members.ts
- docs/collaboration.md

相关决策：
- 邀请链接默认 7 天过期。
- Editor 不能邀请 Admin。

相关讨论：
- Alex 认为需要 max_uses。
- Sophie 要求支持复制链接。

验收标准：
- 能生成链接
- 能设置权限
- 能设置过期时间
- 能撤销链接
- 有日志记录

禁止访问：
- billing_secrets.env
- private_notes/
```

这样可以优化：

- 速度
- 成本
- 准确性
- 安全性

---

### 8.3 AI 输出结构化

不要让 AI 只返回长文本。

建议强制 AI 输出结构化结果：

```text
Summary
简要结论

Actions
建议行动

Changes
做了哪些修改

Questions
需要人类确认的问题

Risks
风险

Sources
来源

Next Step
下一步
```

示例：

```text
GPT Supervisor 输出：

Summary:
邀请模式需要拆成链接、权限、LLM 共享、审计四个模块。

Actions:
1. 后端先建 invite_links 表。
2. 前端做 Invite Dialog。
3. 加入项目时显示权限确认页。

Questions:
是否允许 Viewer 添加自己的 LLM？

Risks:
如果允许匿名链接加入，项目可能被外部访问。

Next Step:
让 Kimi 实现 invite_links API，让 Claude 审查权限。
```

---

## 9. 速度优化设计

速度不是只靠模型快，而是靠整个协作路径短。

---

### 9.1 启动速度

用户创建任务时，不要让他填一堆表单。

提供三种入口：

- 一句话开始
- 模板开始
- 从文件 / 聊天 / 会议自动生成任务

示例：

```text
“帮我做一个邀请协作功能的 PRD”
```

系统自动生成：

- 任务目标
- 相关文件
- 推荐 AI
- 推荐协作者
- 建议 deadline
- 验收标准

---

### 9.2 分工速度

Supervisor 自动判断：

```text
这是研究任务 → 分给 Researcher
这是代码任务 → 分给 Coder
这是审查任务 → 分给 Reviewer
这是设计任务 → 分给 Designer
这是项目协调 → 分给 Coordinator
```

UI 显示：

```text
Recommended Assignment:

TASK-001 需求整理 → GPT Supervisor
TASK-002 竞品参考 → Gemini Researcher
TASK-003 UI 草图 → Claude Designer
TASK-004 后端实现 → Kimi Coder
TASK-005 权限审查 → Claude Reviewer
```

用户可以一键接受：

```text
[Accept Plan] [Edit Assignments] [Run Only First Step]
```

---

### 9.3 执行速度

很多项目可以并行。

例如：

```text
Research Agent 查资料
Writer Agent 写大纲
Coder Agent 建表结构
Designer Agent 做 UI 草图
Reviewer Agent 等待结果
```

系统需要显示并行状态：

```text
Parallel Runs:

[Running] Gemini Researcher: researching competitors
[Running] GPT Supervisor: drafting architecture
[Running] Kimi Coder: implementing invite API
[Waiting] Claude Reviewer: waiting for code diff
```

---

### 9.4 传递速度

每次输出都生成 Handoff。

AI 或人完成一件事后，系统自动生成交接卡：

- What changed?
- Why?
- What is blocked?
- Who needs to act?
- What should be reviewed?

这比让下一个人读完整聊天快很多。

---

### 9.5 阅读速度

默认显示摘要，不默认显示全部日志。

分层：

```text
Level 1:
一句话状态

Level 2:
关键变化

Level 3:
详细日志

Level 4:
完整模型调用和工具记录
```

示例：

```text
TASK-203 Status:
Kimi completed backend invite API. Tests passed. Needs Claude review.
```

展开后才看到：

- 修改文件
- diff
- 测试日志
- token 消耗
- 错误重试

---

### 9.6 决策速度

把需要人类判断的东西集中到 Approval Inbox。

包括：

- 是否允许 AI 修改文件
- 是否允许调用别人提供的 LLM
- 是否接受某个修改
- 是否合并代码
- 是否公开交付物
- 是否提高预算
- 是否邀请新成员

UI 示例：

```text
Approval Inbox

1. Kimi wants to modify 4 files.
   Risk: Medium
   [Approve] [Reject] [View Diff]

2. Claude suggests changing project permission model.
   Impact: High
   [Accept] [Discuss] [Ignore]

3. Alex requests access to Gemini Researcher.
   Cost owner: Ming
   [Approve once] [Approve for project] [Deny]
```

---

## 10. 邀请机制设计

邀请链接不应该只有一个权限选项。应该有多个邀请模板。

---

### 10.1 快速邀请

适合朋友、临时协作者。

```text
Invite as:
[Viewer] [Commenter] [Editor]

Allow adding own LLM:
[No] [Private only]
```

---

### 10.2 团队邀请

适合真正项目成员。

```text
Invite as:
[Contributor] [Reviewer] [Operator] [Admin]

Allow adding own LLM:
[Private only]
[Project shared]
[Approval required]

Default access:
[All project docs]
[Only assigned tasks]
[Selected folders]
```

---

### 10.3 客户邀请

适合外部客户。

```text
Invite as:
[Client Viewer]
[Client Commenter]
[Client Approver]

Visible:
[x] Final deliverables
[x] Selected docs
[ ] Internal discussion
[ ] Model logs
[ ] Cost
[ ] Private files
```

---

### 10.4 AI 供应者邀请

有些人可能不是来亲自做事，而是带模型资源进来。

```text
Invite to contribute AI model:

Role:
[LLM Provider]
[Agent Builder]
[Tool Provider]

Allowed:
[x] Add API provider
[x] Create Agent
[x] Share with selected tasks
[ ] View all project files
[ ] Invite others
```

---

## 11. BYO-LLM 机制

BYO-LLM = Bring Your Own LLM。

别人添加自己的 LLM 时，系统必须明确 5 件事：

1. 这个 LLM 是谁的？
2. 谁可以用？
3. 能看什么？
4. 能做什么？
5. 费用谁出？

---

### 11.1 Add LLM Dialog

```text
Add AI Collaborator

Provider:
[OpenAI] [Anthropic] [Gemini] [DeepSeek] [Kimi] [Qwen] [Ollama] [Custom]

Display Name:
Alex-Claude-Reviewer

Model:
Claude Sonnet

Role:
[Reviewer] [Writer] [Researcher] [Coder] [Custom]

Sharing:
[Private - only me]
[Shared with project]
[Approval required]
[Task limited]

Allowed users:
[x] Sophie
[x] Alex
[ ] Ming
[ ] Everyone

Allowed tasks:
[x] Writing
[x] Review
[ ] Code execution
[ ] File modification
[ ] External API calls

Data access:
[x] Current task only
[x] Selected files
[ ] Whole project
[ ] Private folders

Budget:
Daily limit:
Task limit:
Monthly limit:

Approval:
[x] Require approval before others use this model
[x] Notify me when used
[x] Stop if cost exceeds limit
```

---

### 11.2 共享范围

建议支持四种共享模式：

```text
Private
只有绑定者本人可以用。

Project Shared
项目成员可以请求使用。

Approval Required
别人要用时，需要模型拥有者批准。

Task Limited
只能用于指定任务或指定角色。
```

示例：

```text
Alex 添加 Claude：
共享范围：Approval Required
预算上限：每天 $2
允许角色：Reviewer, Writer
禁止权限：执行代码、访问私人文件、发送邮件
```

---

### 11.3 API Key 安全

API Key 必须：

- 不能被项目 Owner 看到
- 不能被其他成员看到
- 保存在加密 vault 中
- 调用时通过 provider proxy 使用
- 可以随时撤销
- 可以限制项目和任务范围

---

## 12. 多 LLM 协作模式

多 LLM 合作不能只是“多个模型同时回答”。应该有几种模式。

---

### 12.1 Parallel Compare 并行比较

多个模型分别回答，用户比较。

适合：

- 头脑风暴
- 文案
- 方案选择
- 技术选型

UI：

```text
GPT:
建议 A

Claude:
建议 B

Gemini:
建议 C

System:
共同点
差异点
推荐方案
```

---

### 12.2 Role Chain 角色链

一个模型做完，交给下一个模型。

适合：

- 写作
- 代码
- 研究
- 报告

流程：

```text
GPT Planner → Gemini Researcher → Claude Writer → GPT Reviewer → Human Approver
```

---

### 12.3 Debate 辩论

多个模型从不同立场讨论。

适合：

- 重大决策
- 产品方向
- 架构方案
- 投资判断
- 论文观点

UI：

```text
Model A: 支持方案一
Model B: 反对方案一
Model C: 中立评审
Human: 最终决定
```

---

### 12.4 Supervisor Dispatch 总控分发

一个 Supervisor 拆任务，再分给不同模型。

适合：

- 复杂项目
- 多步骤任务
- 软件开发
- 研究报告

流程：

```text
用户目标
→ Supervisor 拆任务
→ Router 分配模型
→ Agent 执行
→ Reviewer 审查
→ Human 合并
```

---

### 12.5 Human-in-the-loop 审批模式

AI 只能做到某一步，关键节点必须人类批准。

适合：

- 高成本调用
- 修改代码
- 发送邮件
- 公开发布
- 访问敏感文件
- 删除内容
- 生成法律/财务/医疗建议

---

## 13. 权限设计

权限要同时管人和 AI。

---

### 13.1 人类权限

```text
Viewer
只能查看。

Commenter
可以评论。

Editor
可以编辑文档和任务。

Operator
可以运行 Agent 和工具。

Maintainer
可以合并结果、处理冲突。

Admin
可以邀请成员、管理模型和权限。

Owner
最高权限。
```

---

### 13.2 AI 权限

```text
Read
读取指定上下文。

Write Draft
生成草稿，但不能改正式文件。

Edit File
可以修改文件，但需要审查。

Run Tool
可以调用工具。

Run Command
可以执行命令，通常需要审批。

Access Web
可以联网。

Access Private Knowledge
可以访问指定知识库。

Invite / Message
一般不应该默认允许。

Publish
公开发布，必须人工审批。
```

---

### 13.3 文件权限

示例：

```text
public/
所有项目成员和 LLM 可读。

docs/
Editor 以上可写。

src/
Coder Agent 可写，但需要 review。

secrets/
只有 Owner 可读，LLM 默认禁止读取。

private/
只有文件所有者可读。
```

---

### 13.4 高风险操作审批

高风险操作必须进入 Approval Inbox：

- 删除文件
- 发送邮件
- 运行 shell command
- 调用外部 API
- 大额 token 消耗
- 访问敏感文件
- 导出整个项目
- 邀请新成员
- 修改权限
- 发布内容

---

## 14. 责任归属

多人 + 多 LLM 的项目里，每个任务必须明确“谁负责”。

每个任务都要有：

```text
Human Owner
最终负责的人。

AI Assignee
执行的 AI。

Reviewer
审查者。

Approver
批准者。
```

示例：

```text
TASK-302: 实现 Add LLM Dialog

Human Owner:
Alex

AI Assignee:
Kimi Coder

Reviewer:
Claude Reviewer

Approver:
Sophie
```

原则：

> AI 可以执行，但人类保留最终责任和审批权。

---

## 15. 任务状态设计

普通任务状态不够。需要 AI 原生状态。

```text
Draft
刚创建，还没确认。

Planned
已经拆分。

Assigned
分配给人或 AI。

Waiting for Context
缺少文件、权限或说明。

Running
AI 或人正在执行。

Needs Human Input
需要人类回答问题。

Needs Approval
需要审批。

Ready for Review
等待审查。

In Review
正在审查。

Revision Needed
需要修改。

Accepted
结果被接受。

Merged
已合并到正式产物。

Failed
执行失败。

Rolled Back
已回滚。

Archived
已归档。
```

---

## 16. 成本和预算设计

多人带自己的 LLM 后，费用会很敏感。

需要显示：

- 项目总消耗
- 每个模型消耗
- 每个成员贡献的模型消耗
- 每个任务成本
- 预算上限
- 剩余额度
- 超预算提醒

轻任务里只显示：

```text
Estimated cost: $0.03
```

重项目里提供完整 Budget 页：

```text
Budget

Total used:
$18.42 / $100

By provider:
- Sophie OpenAI: $8.20
- Alex Anthropic: $4.10
- Ming Gemini: $2.80
- Local models: $0

By task:
- Research: $5.20
- Coding: $7.80
- Review: $2.40
```

费用归属模式：

```text
Owner Pays
项目所有者支付所有模型调用。

Provider Owner Pays
谁提供模型，谁承担费用。

Task Budget Pays
项目有统一预算池，任务从预算池扣费。
```

超预算处理：

- 暂停该模型
- 切换到备用模型
- 请求模型提供者批准
- 降级到低成本模型
- 只生成摘要，不执行完整任务

---

## 17. 安全与隐私设计

多人 + 多 LLM 最大风险是数据边界不清楚。

关键原则：

1. API key 永远不暴露给项目其他成员。
2. 别人的 LLM 默认不能读取全项目。
3. AI 只能访问当前任务所需上下文。
4. 高风险操作必须审批。
5. 所有模型调用都记录。
6. 可以撤销成员、撤销链接、撤销模型访问。
7. 客户视图和内部视图必须隔离。
8. 私人文件默认不进入 AI 上下文。

---

## 18. AI 上下文透明度

UI 上要显示“AI 看到了什么”。

每次调用 AI 前后都可以显示：

```text
Context Used:
- Current task
- docs/collaboration-plan.md
- comments from Alex
- decision log #12

Not included:
- private_notes/
- billing/
- unrelated files

Permissions:
- Read only
- No file modification
- No web access

Estimated cost:
$0.08
```

这样用户知道 AI 的回答为什么可能完整或不完整。

---

## 19. 冲突解决 UI

多人、多 AI 一定会产生冲突。

例如：

```text
GPT 建议 A 架构。
Claude 建议 B 架构。
Alex 认为 A 更快。
Ming 认为 B 更稳。
```

需要一个 Conflict Resolver。

```text
Conflict:
邀请链接权限模型

Option A:
简单角色权限。
Pros:
快。
Cons:
不够细。

Option B:
人类权限 + AI 权限 + 文件权限。
Pros:
安全。
Cons:
开发复杂。

AI Recommendation:
MVP 用 A，但保留 B 的 schema 扩展。

Human Decision:
采用 A+ 部分 B。
```

---

## 20. 注意力系统 Inbox

项目越复杂，信息越多。用户不可能看完所有东西。

系统要帮用户判断：

- 什么需要我现在看？
- 什么只是更新？
- 什么可以明天看？
- 什么可以忽略？

设计一个 Inbox：

```text
My Inbox

Needs my approval:
- Kimi wants to modify invite.ts
- Claude requests permission to access docs/security.md

Needs my reply:
- Alex asked whether Viewer can add private LLM

Important updates:
- Gemini completed research summary
- GPT changed task plan

FYI:
- Ming joined the project
- Daily budget used: $3.20
```

通知分级：

```text
Critical
需要马上处理，例如安全风险、失败、预算超限。

Action Required
需要审批或回复。

Important
重要进展。

FYI
普通更新。

Muted
不通知，只进日志。
```

---

## 21. Project Overview 项目状态页

每个项目都应该有一个 Overview，让人 30 秒内知道发生了什么。

Overview 应该显示：

- 项目目标
- 当前阶段
- 本周重点
- 未完成任务
- 阻塞项
- 最近决策
- 等待审批
- AI 运行状态
- 成本
- 风险
- 下一步

示例：

```text
Project Overview

Goal:
实现多人多模型协作模式 MVP。

Current Stage:
Design → Prototype

Progress:
12 / 30 tasks completed

Blocked:
- BYO-LLM sharing policy not decided
- Need API key vault design

Waiting for Approval:
- Allow invited Editor to add private LLM?
- Should Claude Reviewer access all docs?

AI Status:
- GPT Supervisor idle
- Kimi Coder running TASK-021
- Claude Reviewer waiting for diff

Next Recommended Action:
Review permission model before implementing invite API.
```

---

## 22. 项目模板

为了速度，用户不应该每次从零开始。

建议提供模板：

- Quick Writing Task
- Research Report
- Software Feature
- Product PRD
- Design Sprint
- Data Analysis
- Meeting to Tasks
- Client Delivery
- Course / Learning Project
- Startup Project
- Open-source Collaboration

每个模板预设：

- 任务结构
- 默认 AI 角色
- 推荐 UI
- 权限
- 验收标准
- 输出格式

---

## 23. 数据库结构建议

### projects

```text
id
name
owner_id
description
created_at
settings
```

### project_members

```text
id
project_id
user_id
role
permission_level
joined_at
status
```

### invite_links

```text
id
project_id
created_by
token
default_role
allow_byo_llm
expires_at
max_uses
used_count
status
```

### ai_providers

```text
id
owner_user_id
provider_type
display_name
encrypted_api_key
base_url
created_at
status
```

### project_ai_collaborators

```text
id
project_id
provider_id
model_name
agent_role
shared_scope
permission_policy
budget_policy
created_by
status
```

### tasks

```text
id
project_id
title
goal
status
assigned_to_type
assigned_to_id
human_owner_id
reviewer_id
approver_id
created_by
created_at
```

### model_calls

```text
id
project_id
task_id
provider_id
model_name
called_by_user_id
agent_role
input_tokens
output_tokens
cost
started_at
ended_at
status
```

### audit_logs

```text
id
project_id
actor_type
actor_id
action
target_type
target_id
metadata
created_at
```

### decisions

```text
id
project_id
title
decision
reason
decided_by
affected_tasks
affected_files
created_at
```

### approvals

```text
id
project_id
requester_type
requester_id
action_type
risk_level
status
approved_by
created_at
resolved_at
```

---

## 24. 技术架构分层

系统可以分成这些层：

```text
1. Project Workspace Layer
管理项目、文件、任务、成员、上下文。

2. Collaboration Layer
管理邀请、权限、在线状态、评论、多人编辑。

3. AI Provider Layer
管理不同用户带来的 LLM、API Key、CLI、本地模型。

4. Agent Role Layer
把模型包装成 Supervisor、Coder、Reviewer 等角色。

5. Model Router Layer
根据任务选择合适模型和工具。

6. Tool Permission Layer
控制文件读写、命令执行、联网、邮件、外部 API。

7. Context Pack Layer
为每个任务生成最小必要上下文。

8. Task Orchestration Layer
拆任务、分配任务、并行执行、状态流转。

9. Review & Merge Layer
审查结果、处理冲突、合并文件变更。

10. Cost & Audit Layer
记录 token、费用、日志、责任归属。

11. Artifact Layer
生成并展示文档、PPT、PDF、网页、图表、代码结果。

12. Attention Layer
管理 Inbox、通知、审批、重要更新。
```

---

## 25. 典型完整场景

### 场景 A：一个人快速处理轻任务

```text
用户：
帮我把这段合作模式介绍改得更像产品文案。
```

系统：

```text
自动选择 GPT Writer。
右侧生成文案。
Claude Reviewer 给出语气审查。
用户一键选择“综合版本”。
```

UI 只需要：

- 输入
- 输出
- 模型选择
- 复制 / 保存

不需要项目看板。

---

### 场景 B：两个人和两个 AI 做一个 PRD

```text
Sophie 创建项目。
Alex 加入。
Sophie 添加 GPT。
Alex 添加 Claude。

任务：
完善多人多模型协作模式 PRD。
```

系统拆分：

```text
GPT:
生成 PRD 大纲。

Claude:
审查逻辑和遗漏。

Sophie:
定产品方向。

Alex:
补充技术可行性。
```

UI 需要：

- 文档编辑器
- 评论
- AI 审查
- 版本对比
- 任务线程
- 决策记录

---

### 场景 C：团队开发一个功能

```text
目标：
实现邀请链接 + 成员权限 + BYO-LLM。
```

系统拆分：

```text
TASK-001 数据库 schema
TASK-002 邀请链接 API
TASK-003 加入项目页面
TASK-004 Add LLM Dialog
TASK-005 权限审查
TASK-006 测试
```

分配：

```text
GPT Supervisor:
拆任务。

Kimi Coder:
实现 API。

Claude Reviewer:
审查权限漏洞。

Alex:
实现前端。

Sophie:
最终合并。
```

UI 需要：

- 任务看板
- 代码 diff
- 文件树
- 运行日志
- 权限审查
- 审批 inbox
- 成本记录

---

### 场景 D：多人研究项目

```text
目标：
研究 AI 协作工具趋势。
```

成员：

```text
Sophie
研究员 A
研究员 B
GPT
Gemini
Claude
```

系统：

```text
Gemini:
阅读长文档。

GPT:
整理趋势框架。

Claude:
审查结论是否过度推断。

人类研究员：
补充经验判断。
```

UI 需要：

- 来源库
- 证据卡
- 结论表
- 引用面板
- 冲突观点
- 研究报告
- 可信度评分

---

### 场景 E：客户交付项目

```text
目标：
给客户交付一套 AI 工作流方案。
```

内部成员：

- 咨询师
- 设计师
- 工程师
- AI agents

客户成员：

- 客户 PM
- 客户 CTO
- 客户业务负责人

UI 必须分成：

```text
Internal Workspace
内部讨论、草稿、成本、模型日志。

Client Portal
客户只看正式材料、问题、审批事项。
```

AI 需要：

- 总结客户反馈
- 生成交付文档
- 检查语气
- 生成会议纪要
- 追踪客户修改意见

---

## 26. MVP 分期建议

不要一开始做完整复杂系统。

---

### V1：轻量多人 + 多 LLM 工作区

目标：

> 让用户可以创建项目、邀请别人、添加多个自己的 LLM，并在项目里协作。

做这些：

- 项目空间
- 邀请链接
- 成员权限 Viewer / Editor / Admin
- 项目聊天
- 任务列表
- 文件区
- Owner 添加多个 LLM
- @mention AI
- AI 输出保存为 artifact
- 基础模型调用日志

暂时不做：

- 完整预算系统
- 复杂依赖图
- 多组织管理
- 高级 agent 自动调度

---

### V2：BYO-LLM 和任务房间

目标：

> 别人可以带自己的 LLM 加入项目，并且任务可以明确分配给人或 AI。

做这些：

- 成员添加自己的 LLM
- LLM 共享范围
- 任务房间 Task Room
- AI 角色设置
- Context Pack
- 审批 Inbox
- 模型调用归属
- 简单成本统计
- 文件权限

---

### V3：重项目协作系统

目标：

> 支持复杂多人多 AI 项目执行。

做这些：

- Supervisor 自动拆任务
- 多 Agent 并行执行
- 任务依赖图
- AI 审查链
- 冲突解决
- 版本对比
- 交付物管理
- 完整审计日志
- 预算系统
- 组织级工作区

---

## 27. 第一版最推荐的核心页面

第一版可以围绕 5 个核心页面设计。

---

### 27.1 Project Overview

看项目状态。

包含：

- 目标
- 进度
- 成员
- AI
- 阻塞
- 下一步
- 审批
- 成本

---

### 27.2 Task Room

真正做事的地方。

包含：

- 任务说明
- 上下文
- 产物
- AI 协作
- 评论
- 日志

---

### 27.3 AI Collaborators

管理 AI 成员。

包含：

- 模型
- 提供者
- 角色
- 权限
- 共享范围
- 预算
- 状态

---

### 27.4 Inbox / Approvals

处理需要人类判断的事情。

包含：

- 审批
- 回复
- 风险
- 待审查
- 模型访问请求
- 预算请求

---

### 27.5 Artifacts

沉淀成果。

包含：

- 文档
- 报告
- PPT
- 代码
- 表格
- 图表
- 会议纪要
- 决策记录
- 研究卡片

---

## 28. 最重要的产品原则

```text
轻任务要快。
重项目要稳。

AI 可以参与执行。
人类保留责任和审批。

聊天可以开始工作。
但结果必须沉淀成任务、文件、决策和交付物。

每个人可以带自己的 LLM。
但每个 LLM 的权限、成本、数据访问都必须清楚。

信息不要堆积。
系统要自动总结、分类、传递和提醒。

不同任务需要不同工作区。
不要用一个聊天框解决所有问题。
```

---

## 29. 最终总结

这个合作模式的本质不是“邀请别人进入一个聊天房间”，而是构建一个 **AI 时代的项目协作操作系统**。

普通协作工具是：

```text
人和人一起编辑。
```

普通 AI 工具是：

```text
一个人调用一个 AI。
```

你的系统可以定义成：

```text
人和人合作，
人和 AI 合作，
AI 和 AI 合作，
并且每个人都可以带自己的 AI 加入项目。
```

最终产品描述：

> 一个允许人类成员和他们各自的 AI 模型共同加入项目、分工执行任务、共享上下文、追踪责任和成本的多智能体协作工作台。

英文描述：

> A collaborative project workspace where people and their own AI agents can join the same project, share context, divide tasks, execute workflows, review outputs, and track cost and responsibility across multiple LLM providers.
