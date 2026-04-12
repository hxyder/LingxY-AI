# UCA 当前问题完整解决方案与升级设计（MD 版）

> 适用范围：当前 `src / scripts / tasks` 这一套桌面控制台 + 运行时 + agentic 执行链
> 
> 本文基于现有代码结构与模块检查整理，重点解决：
> 1. AI 打开文件 / 创建文件不稳定
> 2. 复杂请求（例如“基于近年的 AI 发展生成一份 PPT 分析报告”）拆错、没联网、没产出真实文件
> 3. 执行流缺少泛化能力，面对不同目标时不能稳定地走正确路径
> 4. 文档生成能力仍停留在“测试夹具 / 占位实现”，需要升级到正式文档生成库路线

---

## 0. 先给出一句总判断

当前系统的核心问题，不是“模型不够聪明”，而是：

- **任务意图识别、任务拆分、执行器选择、工具调用、文件产物验收** 分布在多个模块中重复判断；
- 没有一个真正统一的 **单一真相源（Single Source of Truth）**；
- 工具虽然已经接了一部分，但 **文件发现、文件验证、产物注册、格式转换** 这一整套闭环没有完成；
- 文档生成现在还有明显的 **fixture / placeholder 痕迹**，还没有进入“正式生产级文件生成”的阶段。

因此，系统才会出现：

1. **AI 口头说“已打开 / 已生成”**，但系统实际上没有可靠证据证明它真的做到了。
2. **一个本应是一条连续流水线的请求**，被拆成若干松散步骤，甚至绕开搜索、绕开工具，最后只给一段文本。
3. **文件能力和动作能力混在一起**，导致附带文件的任务经常被偏向某个 CLI 路径，而不是优先走真正适合“动作执行 / 产物生成”的 agentic 工具流。

---

## 1. 当前代码里已经有的基础能力

从现有目录和模块看，你已经搭好了很多关键骨架，说明方向不是错的，问题主要在“收口”和“硬约束”。

### 1.1 已存在的关键模块

当前代码里已经能看到这些基础：

- `src/service/core/router/intent-router.mjs`
- `src/service/core/router/decomposer.mjs`
- `src/service/core/context-submission.mjs`
- `src/service/core/file-submission.mjs`
- `src/service/core/browser-submission.mjs`
- `src/service/action_tools/tools/index.mjs`
- `src/service/action_tools/schemas/index.mjs`
- `src/service/executors/agentic/planner.mjs`
- `src/service/executors/shared/provider-resolver.mjs`
- `scripts/verify-service-core.mjs`
- `scripts/verify-action-tools.mjs`
- `scripts/verify-agentic-planner.mjs`
- `tasks/49_provider_agnostic_agentic_runtime.md`

这说明系统已经开始朝这些方向演进：

- provider 无关的 agentic runtime
- 多执行器协作
- action tools 工具带
- 输出格式与 artifact 生成
- 桌面控制台 / Overlay / 任务事件流

也就是说，**你不是从 0 到 1 的问题，而是从“骨架可用”升级到“行为稳定、可控、可验收”的问题。**

---

## 2. 当前暴露出来的主要问题

---

### 2.1 问题一：AI 打开文件 / 创建文件，不稳定

#### 现象

- 让 AI 打开一个文件，它可能回答“已打开”，但并没有真正打开。
- 让 AI 创建一个文件，它可能输出了文本，或以为已经落地了，但文件并不存在，或路径不对，或没有注册到 artifact。
- 用户不知道文件到底在哪里，也不知道是“生成失败”还是“生成了但 UI 没显示”。

#### 根因

##### 根因 A：缺少“文件发现层”

当前工具层虽然已经有：

- `open_file`
- `reveal_in_explorer`
- `write_file`
- `generate_document`

但还缺少真正让 AI 先“找到文件”的工具，例如：

- `list_files`
- `stat_file`
- `get_latest_artifact`
- `find_artifacts_by_kind`
- `create_folder`
- `verify_file_exists`

所以 AI 经常是：

- 直接拿一个不可靠路径去 `open_file`
- 或直接假设某个输出文件已经存在
- 或生成文件后没有二次确认

##### 根因 B：`open_file` 缺少硬验证

`open_file` 当前更像“尝试交给系统默认程序处理”，但不等于“完成了文件打开任务”。

真正可靠的打开文件流程应该是：

1. 先拿到确定路径
2. 路径绝对化
3. 文件存在性检查
4. 如果不存在，先尝试从 artifact store / outputDir / 最近产物里解析
5. 调系统打开
6. 回写 metadata
7. 失败时自动 fallback 到 `reveal_in_explorer`

##### 根因 C：文件任务和动作任务被混用

`file-submission.mjs` 里仍然保留了“文件任务优先走 kimi / code_cli”的倾向。

这对“读取文件内容”有一定帮助，但对下面这些动作反而会造成干扰：

- 打开文件
- 创建文件
- 基于文件生成产物
- 搜索 + 分析 + 生成报告

因为这些任务的核心不是“把文件喂给一个 CLI 模型”，而是“模型要正确地调用工具，并完成动作闭环”。

##### 根因 D：产物创建后缺少统一验收

当前系统还没有形成统一的产物成功标准。真正应该存在的标准是：

- 文件生成了
- 文件路径存在
- 扩展名与 MIME 对上
- artifact 已注册
- 可选：可打开 / 可在资源管理器定位
- 任务事件里有对应的 `artifact_created`

如果没有这些标准，系统就会停留在“模型说它完成了”这种弱成功状态。

---

### 2.2 问题二：复杂请求拆错、没联网、没返回真实文件

典型例子：

> 基于近年的 AI 发展，生成一份 PPT 分析报告。

#### 期望行为

正确执行应该是：

1. 判断这是**时效性请求**
2. 先联网搜索
3. 汇总近年 AI 发展主题
4. 组织 PPT 大纲
5. 生成真实 `.pptx`
6. 返回产物路径 / UI 卡片 / 打开方式

#### 实际问题

- 任务可能被错误拆分
- 可能直接回答，不搜索
- 可能只返回一段文字
- 可能生成的是很弱的占位文件，甚至不是正式的 PPT 生成流程

#### 根因

##### 根因 A：是否需要联网搜索仍主要依赖 prompt 约束

现在 prompt 确实已经有“recent/current topic 应该先搜索”的思想，但这还不是执行前的硬规则。

这意味着：

- 模型可能遵守
- 也可能跳过
- 不同 provider / CLI / transport 表现不一致

##### 根因 B：任务拆分还没有完全收口

虽然已有 AI-first decomposition，但现在仍然可能被多个层再次改写：

- router
- decomposer
- context submission
- browser submission
- file submission
- executor fallback
- output fallback

结果是“一个用户请求”没有被视作一个连续流水线，而是被中途拆散。

##### 根因 C：artifact 路径不统一

当前产物可能来自两条路：

1. agentic 真的调用 `generate_document`
2. 结束后 `writeRequestedArtifacts(...)` 再做后置兜底

这样会带来两个问题：

- 不清楚到底是谁生成了文件
- 工具调用失败时，后置兜底可能掩盖真正的问题

##### 根因 D：当前文档生成仍有明显测试夹具色彩

现有 `generate_document` 的 OOXML 产物仍是较轻量的 fixture 风格；
PDF 甚至还是 HTML fallback + 后置转换思路。

这说明：

- 你已经证明了“系统可以生成合法文件”
- 但还没有完成“系统可以稳定生成生产级正式文档”

##### 根因 E：文件理解能力仍有 placeholder

从 extractor 层可以看到：

- DOCX 占位提取
- 图像 OCR 占位提取
- `pdf_ocr.mjs` 里仍是 placeholder
- browser submission 里还有 `web_fetch_placeholder`

这会影响所有“基于文件 / 网页 / PDF 自动分析并生成报告”的真实效果。

---

### 2.3 问题三：执行流程没有真正形成“按目标泛化”的能力

这个问题是最本质的。

当前系统还没有真正把“不同目标”抽象成统一可编译的任务模型，所以面对不同请求时，会出现：

- 有时走 fast
- 有时走 kimi / code_cli
- 有时走 agentic
- 有时只是返回文本
- 有时虽然请求了文件，却没有进入产物闭环

也就是说，系统缺少一个中间层，把用户自然语言编译成**面向目标的任务规范**。

---

## 3. 你真正需要建立的核心架构

这里给出一个建议：以后整套系统都围绕 **ContextPacket → TaskSpec → ExecutionPlan → ToolLoop → ArtifactContract** 运转。

---

## 4. 分层设计：应该怎么分层

---

### 4.1 第 1 层：输入采集层（Input Capture Layer）

这一层只负责把各种入口统一成标准输入，不做复杂决策。

#### 入口类型

- 聊天输入
- 文件右键 / Explorer 选中
- 浏览器选中文本 / 链接 / 图片
- Office 选区
- 剪贴板
- 截图 / OCR
- 活动窗口上下文

#### 输出

统一输出 `ContextPacket`：

```json
{
  "schema_version": "1.0",
  "context_id": "ctx_xxx",
  "trace_id": "trace_xxx",
  "source_type": "chat|file|browser|office|clipboard|image",
  "source_app": "explorer.exe",
  "capture_mode": "manual|shell_menu|overlay|system",
  "text": "用户原始请求",
  "file_paths": [],
  "url": null,
  "selection_metadata": {},
  "captured_at": "..."
}
```

#### 这一层禁止做的事

- 不在这里决定执行器
- 不在这里决定要不要拆任务
- 不在这里决定用哪个 provider
- 不在这里决定是否生成文件

> 输入层只负责“干净地收集上下文”。

---

### 4.2 第 2 层：任务编译层（Task Compiler）

这是整个系统最关键的新增层。

系统需要一个统一的 **TaskSpec**，把用户请求翻译成“机器可执行目标”。

#### 建议的 TaskSpec 结构

```json
{
  "goal": "generate_presentation",
  "user_goal_text": "基于近年的AI发展生成一份PPT分析报告",
  "topic": "近年的 AI 发展",
  "needs_current_web_data": true,
  "artifact": {
    "required": true,
    "kind": "pptx",
    "quality": "formal",
    "auto_open": false
  },
  "source": {
    "files": [],
    "urls": [],
    "selection_text": null,
    "clipboard": null
  },
  "constraints": {
    "language": "zh-CN",
    "can_split": false,
    "must_use_tools": true,
    "must_verify_artifact": true
  },
  "required_steps": [
    "search",
    "synthesize",
    "generate_artifact"
  ],
  "success_contract": {
    "needs_artifact": true,
    "needs_registered_artifact": true,
    "needs_citations_or_sources": false,
    "needs_tool_trace": true
  }
}
```

#### 核心价值

以后任何入口、任何 executor、任何 provider，**都只能消费 TaskSpec，不能重新自由猜。**

这会极大减少：

- 路由飘忽
- 中途被改 executor
- 同一请求在多处被反复拆分
- artifact 要求丢失

---

### 4.3 第 3 层：规划策略层（Planning Policy Layer）

这一层不负责自由发挥，而是负责把 TaskSpec 变成一个 **ExecutionPlan**。

#### 例子：针对不同目标的泛化规则

##### 目标 A：问答型

例如：

> 解释一下 TS 错误是什么

计划应是：

- 不需要搜索
- 不需要文件
- 不需要动作工具
- 走 `fast`

##### 目标 B：最新信息型

例如：

> 最近 AI 发展怎么样

计划应是：

- 需要搜索
- 不需要文件
- 需要 search tool
- 走 `agentic`

##### 目标 C：生成文档型

例如：

> 基于近年的 AI 发展生成一份 PPT

计划应是：

- 需要搜索
- 需要产物
- 需要 `generate_document`
- 不应拆成多个平级任务
- 走 `agentic`

##### 目标 D：文件动作型

例如：

> 打开刚才生成的 PPT

计划应是：

- 需要先找最近 artifact
- 需要文件存在性校验
- 需要 `open_file` 或 `reveal_in_explorer`
- 走 `agentic`

##### 目标 E：基于现有文件分析并产出文档

例如：

> 基于这个 PDF，生成一份摘要 Word 文档

计划应是：

- 先抽取 / 读取 PDF
- 识别是否文本层 / OCR
- 分析内容
- 生成 docx
- 校验 docx
- 走 `file_specialist + agentic`

##### 目标 F：系统动作型

例如：

> 打开微信并截图当前窗口

计划应是：

- 启动应用
- 等待窗口
- 调截图工具
- 走 `agentic`

#### 这一层必须有的硬规则

1. 只要 `needs_current_web_data = true`，**第一步必须搜索**。
2. 只要 `artifact.required = true`，任务成功判定必须包含 artifact 验证。
3. “分析 + 生成一个文件”默认视为**单流水线任务**，不能拆成多个松散平级任务。
4. 文件动作前必须先有确定路径；没有路径不能直接 `open_file`。

---

### 4.4 第 4 层：执行器层（Executor Layer）

执行器必须收敛，职责必须单一。

#### 建议保留的执行器

##### 1. `fast`

用途：

- 纯文本问答
- 不调用工具
- 不生成文件
- 不需要联网的快速响应

##### 2. `agentic`

用途：

- 搜索
- 文件打开 / 创建
- 多步推理
- 工具调用
- 生成 PPT / Word / Excel / PDF
- 动作类任务

##### 3. `file_specialist`

用途：

- 读文件
- 建立文件内容上下文
- 只做解析与抽取，不负责最终动作闭环

##### 4. `multi_modal`

用途：

- 图片分析
- OCR
- 视觉理解

##### 5. `code_cli`

用途：

- 作为专门的 CLI 类 provider 接入
- 可参与 agentic，但不再作为“有文件就默认走它”的主路径

#### 关键改动原则

- **`kimi` 不再是任务语义上的执行器名。**
- `kimi` 只作为一种 `code_cli provider` 的实现方式存在。
- 对用户而言，语义上只有：`fast / agentic / file_specialist / multi_modal / code_cli`。

---

### 4.5 第 5 层：工具网关层（Tool Gateway Layer）

这层是当前系统最需要补强的地方。

---

## 5. 工具体系应该怎么升级

### 5.1 当前已有工具

现有工具层已经具备一定基础：

- `open_url`
- `web_search`
- `open_file`
- `reveal_in_explorer`
- `launch_app`
- `copy_to_clipboard`
- `notify`
- `web_search_fetch`
- `write_file`
- `run_script`
- `generate_document`

说明你已经完成了“让模型可以开始调工具”的第一阶段。

### 5.2 当前缺失的关键工具

为了让 AI 真正把“文件类任务”做完整，必须新增下面这一组：

#### 文件发现类

- `list_files`
- `glob_files`
- `find_recent_files`
- `get_latest_artifact`
- `find_artifacts_by_kind`
- `stat_file`
- `verify_file_exists`

#### 文件创建类

- `create_folder`
- `ensure_output_dir`
- `reserve_output_path`

#### 文件读取辅助类

- `read_file_excerpt`
- `read_artifact_manifest`
- `resolve_relative_path`

#### 产物后处理类

- `convert_html_to_pdf`
- `open_artifact_by_kind`
- `register_artifact`

### 5.3 为什么这些工具必须要有

因为 AI 想完成“打开文件 / 生成文件 / 展示结果”时，本质上需要经过 4 个阶段：

1. **找**：这个文件在哪？输出目录在哪？刚才生成的最新 PPT 是哪个？
2. **做**：打开、写入、生成、转换
3. **验**：文件是否真的存在？类型对不对？注册成功没有？
4. **呈**：告诉用户结果在哪，是否自动打开，是否可在资源管理器定位

如果缺失第 1 和第 3 阶段，AI 再聪明也会“说得像做了，但其实没闭环”。

---

## 6. 文档生成升级：选择 P2 路线 B（正式接文档生成库）

你已经明确选择 **路线 B：正式接文档生成库**。这一步非常正确，因为它直接把系统从“演示级 / 夹具级文档产出”升级到“生产级文件能力”。

---

### 6.1 为什么必须放弃 fixture 主路径

当前 `generate_document` 里的 OOXML fixture 方案有一个价值：

- 证明系统能生成一个合法、可打开的文件

但它不适合作为正式主路径，因为它的定位本质上更接近：

- smoke test
- 协议验证
- output contract 占位

而不是：

- 正式业务输出
- 高质量 PPT
- 结构稳定的 Word 报告
- 可样式化的 Excel 报表
- 高质量 PDF 输出

所以建议变成：

- **fixture 保留为 regression fallback / smoke test only**
- **正式业务流切到文档生成库**

---

### 6.2 推荐的正式文档生成库栈

#### PPTX：`PptxGenJS`

适合作为正式的 PowerPoint 生成主库。官方文档显示它支持 Node/Electron，并且可以创建文本、表格、形状、图像、图表等主要幻灯片对象，也支持自定义 Slide Master、导出 Buffer/Stream 等，更适合你当前 Electron + Node 的桌面控制台场景。 citeturn254358view0turn778703search8

#### DOCX：`docx`

适合作为正式的 Word 生成主库。官方资料显示它支持在 Node 和浏览器中以 JS/TS 方式生成和修改 `.docx`，并且是声明式 API，适合把“报告大纲 / section 结构”稳定映射成正式文档。 citeturn778703search1turn171892search1

#### XLSX：`ExcelJS`

适合作为正式的 Excel 生成主库。其官方 README 说明它支持读写 XLSX/JSON，并可处理样式；这比当前简化夹具方式更适合生成真实报表、表格、汇总页和多工作表导出。 citeturn171892search0

#### PDF：`Playwright` HTML-to-PDF

对于 PDF，推荐采用 **HTML 渲染 → Playwright `page.pdf()`** 的正式路径。Playwright 官方文档明确提供 `page.pdf()`，支持输出 PDF、控制纸张尺寸、页边距、媒体类型等，适合把统一的 HTML 报告模板稳定转成最终 PDF。 citeturn161985view1turn161985view2

---

### 6.3 正式文档生成架构建议

新增目录：

```text
src/service/docgen/
  contracts/
    presentation-schema.mjs
    report-schema.mjs
    spreadsheet-schema.mjs
  renderers/
    pptxgenjs-renderer.mjs
    docx-renderer.mjs
    exceljs-renderer.mjs
    html-renderer.mjs
    pdf-renderer.mjs
  templates/
    ppt/
    doc/
    html/
  validators/
    artifact-validator.mjs
    manifest-writer.mjs
```

#### 核心思想

以后模型不再直接“自由写文件内容”，而是先输出一个**结构化中间表示**，再由 renderer 渲染成正式文档。

例如：

##### PPT 中间表示

```json
{
  "title": "近年AI发展分析",
  "subtitle": "2023-2026 趋势概览",
  "theme": "executive-modern",
  "slides": [
    {
      "type": "title",
      "heading": "背景",
      "bullets": ["生成式AI加速进入企业", "多模态能力成为主流"]
    },
    {
      "type": "bullets",
      "heading": "关键趋势",
      "bullets": ["模型推理成本下降", "Agent 与工具调用兴起"]
    },
    {
      "type": "table",
      "heading": "厂商对比",
      "columns": ["厂商", "方向", "特点"],
      "rows": [
        ["A", "多模态", "产品化快"],
        ["B", "推理", "企业集成强"]
      ]
    }
  ]
}
```

然后 renderer 再用 PptxGenJS 去生成真正的 `.pptx`。

#### 为什么这样更好

- 模型负责“规划内容结构”
- 渲染器负责“保证文件合法、样式一致、输出稳定”
- 以后要加模板、主题、图表、页脚、封面，就不用改 prompt，只改 renderer 和 schema

---

### 6.4 `generate_document` 工具应该怎么改

当前建议把 `generate_document` 分成两层：

#### 第一层：tool API 不变

仍然保留统一工具入口：

```json
{
  "kind": "pptx|docx|xlsx|pdf",
  "document_model": { ... },
  "filename": "...",
  "theme": "..."
}
```

#### 第二层：内部实现换成正式 renderer

- `pptx` → `pptxgenjs-renderer`
- `docx` → `docx-renderer`
- `xlsx` → `exceljs-renderer`
- `pdf` → `html-renderer + pdf-renderer`

#### 保留 fallback

如果正式 renderer 失败：

- 允许降级到 fixture 路径
- 但必须把任务状态标记为 `partial_success`
- 并清楚告诉用户：
  - 正式文档渲染失败
  - 当前已生成兼容性较弱的 fallback 文件
  - 错误日志在哪

不能再把 fallback 当成“完全成功”。

---

### 6.5 PDF 正式路径

建议统一为：

1. 先生成标准 HTML 报告
2. 调 Playwright 打开 HTML
3. `page.emulateMedia({ media: 'screen' })`
4. `page.pdf({ path, format, margin, printBackground })`
5. 校验 PDF 文件存在
6. 注册 artifact

这样 PDF 就从现在的“HTML sidecar + 以后再想办法转”升级成真实的最终产物能力。

---

## 7. 面向不同目标的泛化执行流程

这是本次升级最关键的一部分。

系统以后不能只靠“关键词命中某个 executor”，而是要根据 **目标类型** 自动生成执行计划。

---

### 7.1 统一目标分类（Goal Taxonomy）

建议引入 `goal_family` 概念：

- `qa`
- `search_and_answer`
- `analyze_and_report`
- `generate_document`
- `open_or_reveal_file`
- `transform_existing_file`
- `launch_and_act`
- `schedule_or_notify`
- `translate`
- `multimodal_analyze`

### 7.2 不同目标的标准执行模板

#### 模板 A：纯问答

输入：

> TS 错误是什么

执行：

- 编译为 `qa`
- 不调用工具
- `fast`
- 直接答复

#### 模板 B：搜索后回答

输入：

> 近一年的 AI 趋势是什么

执行：

- 编译为 `search_and_answer`
- 设置 `needs_current_web_data=true`
- `agentic`
- 首步强制 `web_search_fetch`
- 汇总后返回文本

#### 模板 C：搜索后生成文档

输入：

> 基于近年的 AI 发展，生成一份 PPT 分析报告

执行：

- 编译为 `generate_document`
- `artifact.required=true`
- `artifact.kind=pptx`
- `needs_current_web_data=true`
- `can_split=false`
- `agentic`
- search → synthesize → render pptx → validate artifact → present result

#### 模板 D：基于文件生成文档

输入：

> 基于这个 PDF 生成一份摘要 Word

执行：

- 编译为 `transform_existing_file`
- `source.files=[pdf]`
- 先走 `file_specialist`
- 再转 `agentic`
- 分析 → 生成 docx → validate

#### 模板 E：打开或定位文件

输入：

> 打开刚才的 PPT

执行：

- 编译为 `open_or_reveal_file`
- 先 `get_latest_artifact(kind=pptx)`
- 再 `stat_file`
- 成功则 `open_file`
- 失败则 `reveal_in_explorer`

#### 模板 F：动作型任务

输入：

> 打开微信，截图当前窗口，并保存到桌面

执行：

- 编译为 `launch_and_act`
- 计划步骤：launch → capture → write → validate
- 走 `agentic`

---

## 8. 任务成功标准必须升级为“契约式验收”

这一步必须单独做，不可继续隐含在 executor 内部。

---

### 8.1 文本型任务成功标准

- 有最终答复
- 若要求搜索，则有搜索证据
- 若要求引用来源，则来源齐全

### 8.2 文件型任务成功标准

- `artifact.required = true`
- 文件存在
- 扩展名正确
- MIME 正确
- artifact store 已注册
- 任务事件里有 `artifact_created`
- 最终回复不能在没有成功工具记录时声称“已完成”

### 8.3 文件打开型任务成功标准

- 目标路径已解析
- 文件存在
- 系统打开命令执行成功
- 如果打开失败，自动 fallback 到 `reveal_in_explorer`
- 最终回复明确说明是“已打开”还是“已定位到资源管理器”

### 8.4 任务状态枚举建议

- `success`
- `partial_success`
- `failed`
- `blocked`
- `needs_confirmation`
- `needs_user_input`

不要再用“模型自己声称完成”作为成功依据。

---

## 9. 模型如何正确调用工具：要靠制度，不靠祈祷

模型能否正确调用工具，关键不在于你写了多少提示词，而在于系统有没有给出**足够明确的可执行协议**。

---

### 9.1 Prompt Builder 需要继续保留，但角色从“行为驱动”变成“规则说明”

system prompt 应该动态从工具注册表渲染：

- 工具列表
- 每个工具的 schema
- 典型示例
- 成功声称规则

但重点不是“靠 prompt 逼模型听话”，而是：

- prompt 只是让模型知道自己有这些工具
- 真正的强制规则由 `TaskSpec / Planning Policy / Success Contract` 保证

### 9.2 必须增加 Required Actions 注入

例如：

- `needs_current_web_data = true` → 强制把 `web_search_fetch` 注入首步
- `artifact.required = true` → 强制 planner 结束前必须有 artifact
- `open_or_reveal_file` → 强制先做 path resolution

### 9.3 必须限制“自由拆分”

默认规则：

- **单目标 + 单产物请求 = 一个流水线任务**
- 只有用户明确提出多个并列目标时才拆分

例如：

- “帮我搜最新 AI 趋势并做一个 PPT” → 一个任务
- “帮我翻译这段话，再去打开 Excel，再给我做一个 PPT” → 可拆

### 9.4 必须保留 Tool Truthfulness Guard

即：

如果最终回复里出现“已保存 / 已打开 / 已生成”，但工具记录里没有对应成功项，则自动降级：

- 状态改为 `partial_success`
- 系统提示：AI 声称完成，但未检测到对应工具成功记录

这能显著减少“口头完成”的假阳性。

---

## 10. 具体模块怎么改

下面是按模块给出的详细改造建议。

---

### 10.1 `src/service/core/router/intent-router.mjs`

#### 当前问题

- 已经能给出 `intent_tags`、`suggested_formats`
- 但还不够“目标导向”
- 还没有输出完整 TaskSpec 所需的信息

#### 建议改造

让它输出更完整的路由元信息：

```js
{
  intent: "general",
  goal_family: "generate_document",
  suggested_executor: "agentic",
  intent_tags: [...],
  suggested_formats: ["pptx"],
  needs_current_web_data: true,
  must_use_tools: true,
  can_split: false,
  artifact_required: true
}
```

#### 原则

- router 只做“目标判断”
- 不做最终执行器覆盖
- 不做产物 fallback

---

### 10.2 `src/service/core/router/decomposer.mjs`

#### 当前问题

- 已有 AI-first decomposition
- 但仍缺少“单目标 + 单产物”保护

#### 建议改造

增加一层规则：

- 若检测到请求包含一个主主题和一个主产物要求，则 `can_split=false`
- decomposer 只能返回一个流水线任务

#### 例如

> 总结近一年 AI 发展，并生成一个 PPT，加一些图表

应始终只保留一个子任务：

- `command: 总结近一年 AI 发展并生成带图表的 PPT`
- `suggested_executor: agentic`
- `suggested_formats: [pptx]`

而不是拆成：

- 搜索
- 总结
- 生成文件

---

### 10.3 `src/service/core/context-submission.mjs`

#### 当前问题

这是目前“执行链 decision 重复”的关键来源之一：

- 会重新判断 executor
- 会做 kimi/code_cli 偏置
- 会做 artifact fallback
- 会在某些情况下改写原始任务意图

#### 建议改造

把它改成“只消费 ExecutionPlan”的模块：

1. 接收 `TaskSpec`
2. 调 `compileExecutionPlan(taskSpec)`
3. 根据 plan 找执行器
4. 运行
5. 调 artifact contract
6. 返回结果

#### 禁止行为

- 不允许自己再次自由猜测 `shouldUseKimi`
- 不允许自己私自改变任务目标
- 不允许在没有 success contract 的情况下擅自补 artifact 并宣称成功

---

### 10.4 `src/service/core/file-submission.mjs`

#### 当前问题

现在它仍有明显“文件任务优先走 kimi / code_cli”的倾向。

#### 这会导致的问题

- 文件动作型任务被错误引导
- 附件上下文和动作执行纠缠在一起
- agentic 工具流被绕开

#### 建议改造

把 file submission 拆成两段职责：

##### 阶段 1：文件理解

- 构建 file context
- 做 MIME/文本层/OCR 判断
- 输出 `FileAnalysisPacket`

##### 阶段 2：目标驱动执行

- 如果目标是“读文件内容” → `file_specialist`
- 如果目标是“基于文件生成文档” → `file_specialist -> agentic`
- 如果目标是“打开文件” → 直接 `agentic`
- 如果目标是“对文件执行动作” → `agentic`

#### 原则

- 文件只是上下文来源，不应该自动等价于“必须走 CLI 模型主链”

---

### 10.5 `src/service/action_tools/tools/index.mjs`

#### 当前问题

已有工具骨架不错，但缺少文件发现和严格验证类工具。

#### 建议新增

- `list_files`
- `find_recent_files`
- `get_latest_artifact`
- `stat_file`
- `verify_file_exists`
- `create_folder`
- `open_artifact_by_kind`
- `convert_html_to_pdf`

#### 建议强化

##### `open_file`

- 路径为空直接失败
- 相对路径自动解析到任务输出目录
- 必须先校验存在
- 失败时提供 fallback 建议

##### `write_file`

- 加 manifest 写入
- 加覆盖行为标志
- 可选创建父目录

##### `generate_document`

- 切正式 renderer
- 输出 artifact metadata
- 返回 document model hash，便于重放与调试

---

### 10.6 `src/service/action_tools/schemas/index.mjs`

#### 建议

把 schema 细化为：

- 输入 schema
- 校验规则
- 默认值
- artifact 相关字段
- 是否需要输出文件

例如 `generate_document`：

```json
{
  "kind": "pptx",
  "filename": "ai-trends-report.pptx",
  "theme": "executive-modern",
  "document_model": { ... },
  "output_dir": "optional"
}
```

---

### 10.7 `src/service/executors/agentic/planner.mjs`

#### 当前问题

它已经是未来主链的方向，但还需要强化为“硬约束式 planner”。

#### 建议改造

增加以下能力：

##### 1. Required actions 注入

根据 TaskSpec 自动注入：

- `web_search_fetch`
- `get_latest_artifact`
- `generate_document`
- `convert_html_to_pdf`

##### 2. Artifact success contract 检查

planner 结束后：

- 若 `artifact.required=true` 且没有 artifact → 不能判 success

##### 3. Tool truthfulness guard

- 若模型声称已完成，但工具记录不支持 → 降级 partial success

##### 4. 结构化 final state

planner 最终输出建议统一为：

```json
{
  "status": "success|partial_success|failed",
  "summary": "...",
  "inline_text": "...",
  "artifact_paths": [],
  "tool_trace": [...],
  "followup_actions": []
}
```

---

## 11. 文件理解能力怎么补齐

这是所有“基于文件进行分析、总结、生成报告”的基础。

---

### 11.1 当前问题

当前 extractor 层还有明显 placeholder：

- DOCX 占位提取
- 图片 OCR 占位提取
- PDF OCR 占位
- 部分网页抓取占位

### 11.2 升级建议

#### 第一优先级

- DOCX 文本抽取
- PPTX 文本抽取
- XLSX 表格抽取
- PDF 文本层抽取

#### 第二优先级

- PDF OCR 正式接入
- 图片 OCR 正式接入

#### 第三优先级

- 网页正文提取
- 结构化表格抓取

### 11.3 建议原则

文件读取层不要和任务层耦合。

应单独输出：

```json
{
  "path": "...",
  "mime": "application/pdf",
  "extraction_mode": "text|ocr|hybrid",
  "text": "...",
  "tables": [],
  "images": [],
  "confidence": 0.93,
  "warnings": []
}
```

这样 agentic 层只消费统一抽取结果即可。

---

## 12. UI 与用户体验也要跟着升级

如果执行链升级了，但 UI 仍然不能清楚表达过程，用户还是会觉得“不知道 AI 到底干了什么”。

---

### 12.1 任务详情必须明确展示

- 用户目标
- 编译后的 goal family
- 是否需要搜索
- 是否要求产物
- 实际调用的 provider
- 实际调用的工具顺序
- 生成的 artifact 列表
- 失败点

### 12.2 artifact center 应强化

建议在 Artifact Center 显示：

- 文件名
- 类型
- 所属任务
- 生成时间
- 生成路径
- 打开按钮
- 在资源管理器中显示按钮
- 重新生成按钮

### 12.3 对“完成状态”要区分清楚

不要只显示一个“completed”。

应区分：

- 已回答
- 已搜索并回答
- 已生成文件
- 已打开文件
- 已定位文件
- 部分成功
- 失败

---

## 13. 推荐的升级实施顺序

这里按优先级给出建议。

---

### Phase 1：建立单一真相源

#### 目标

让所有任务统一先编译为 TaskSpec / ExecutionPlan。

#### 要做的事

1. 新增 `task-spec.mjs`
2. 新增 `execution-plan.mjs`
3. router 输出 goal_family 与 traits
4. context/file/browser submission 统一改为消费 plan

#### 交付标准

- 所有入口都能输出统一的 plan
- 不再出现多个层重复改 executor

---

### Phase 2：补齐文件发现与产物契约

#### 目标

解决“打开文件 / 创建文件不稳定”。

#### 要做的事

1. 新增文件发现工具
2. 强化 `open_file`
3. 新增 artifact validator
4. 新增 artifact manifest
5. 新增 `open_artifact_by_kind`

#### 交付标准

- “打开刚才生成的 PPT”可稳定工作
- “生成文件”必须有 manifest + artifact 记录

---

### Phase 3：搜索优先规则硬化

#### 目标

解决“最新主题没搜索”的问题。

#### 要做的事

1. 在 TaskSpec 增加 `needs_current_web_data`
2. 在 planner 增加 required action injection
3. 最新主题首步强制 `web_search_fetch`

#### 交付标准

- 涉及时效信息的文档生成任务，不允许跳过搜索直接回答

---

### Phase 4：正式接文档生成库

#### 目标

把 PPT / DOCX / XLSX / PDF 升级到正式生产级输出。

#### 要做的事

1. 引入 `PptxGenJS`
2. 引入 `docx`
3. 引入 `ExcelJS`
4. 引入 `Playwright` PDF 生成
5. 新增 renderer 层
6. `generate_document` 切正式实现
7. fixture 降为 fallback only

#### 交付标准

- 可正式生成结构稳定的 PPT / Word / Excel / PDF
- 文档质量不再依赖测试夹具脚本

---

### Phase 5：文件理解能力补齐

#### 目标

让“基于文件生成报告”真正可用。

#### 要做的事

1. 接 DOCX/PPTX/XLSX 提取
2. 接 PDF 文本层
3. 接 PDF OCR
4. 接网页正文提取

#### 交付标准

- 基于用户上传文件生成文档时，准确率与稳定性明显提升

---

### Phase 6：UI 对齐

#### 目标

让用户真正看懂系统在做什么。

#### 要做的事

1. 任务详情展示 ExecutionPlan
2. 展示 provider/tool trace
3. 强化 artifact center
4. 明确 success / partial success / failed

#### 交付标准

- 用户能一眼看出：这个任务有没有搜索、有没有生成文件、文件在哪里、为什么失败

---

## 14. 建议新增的数据结构

---

### 14.1 TaskSpec

```ts
interface TaskSpec {
  goalFamily: string;
  userGoalText: string;
  needsCurrentWebData: boolean;
  artifact?: {
    required: boolean;
    kind: "pptx" | "docx" | "xlsx" | "pdf";
    quality: "draft" | "formal";
    autoOpen?: boolean;
  };
  source: {
    files?: string[];
    urls?: string[];
    selectionText?: string | null;
  };
  constraints: {
    canSplit: boolean;
    mustUseTools: boolean;
    mustVerifyArtifact: boolean;
    language?: string;
  };
  requiredSteps: string[];
}
```

### 14.2 ExecutionPlan

```ts
interface ExecutionPlan {
  executor: "fast" | "agentic" | "file_specialist" | "multi_modal" | "code_cli";
  steps: Array<{
    kind: string;
    required: boolean;
    tool?: string;
  }>;
  successContract: {
    requiresArtifact: boolean;
    requiresRegisteredArtifact: boolean;
    requiresToolTrace: boolean;
  };
}
```

### 14.3 Artifact Manifest

```json
{
  "artifact_id": "art_xxx",
  "task_id": "task_xxx",
  "kind": "pptx",
  "path": "C:/.../ai-trends-report.pptx",
  "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "created_at": "...",
  "renderer": "pptxgenjs-renderer",
  "source_model_hash": "...",
  "validated": true
}
```

---

## 15. 验收标准（必须可测）

升级不能只写设计，必须配套回归验证。

---

### 15.1 用例一：打开文件

输入：

> 打开刚才生成的 PPT

通过标准：

- 系统能解析最近 artifact
- 文件存在
- `open_file` 成功或 `reveal_in_explorer` fallback 成功
- UI 有明确结果

### 15.2 用例二：最新主题生成 PPT

输入：

> 基于近年的 AI 发展，生成一份 PPT 分析报告

通过标准：

- `needs_current_web_data=true`
- 首步确实调用搜索
- 最终生成 `.pptx`
- artifact 已注册
- UI 展示可打开文件

### 15.3 用例三：基于文件生成 Word

输入：

> 基于这个 PDF，生成一份摘要 Word

通过标准：

- PDF 被抽取
- 若是扫描件，走 OCR
- 最终生成 `.docx`
- 验证通过

### 15.4 用例四：最新主题只回答

输入：

> 最近 AI 发展怎么样

通过标准：

- 必须搜索
- 不生成文件
- 最终文本答复清晰

### 15.5 用例五：纯问答

输入：

> TS 错误是什么

通过标准：

- 不应无故调用工具
- 不应无故拆分
- 直接回答

---

## 16. 这次升级后的最终目标状态

升级完成后，你的系统应具备下面这些稳定特征：

### 16.1 从“基于关键词猜执行器”升级到“基于目标编译执行计划”

系统能理解：

- 用户是在提问
- 还是要最新信息
- 还是要生成文件
- 还是要打开文件
- 还是要基于文件继续加工

### 16.2 从“模型口头完成”升级到“工具与产物可验证完成”

系统只在以下情况说成功：

- 真调用了工具
- 真生成了文件
- 真验证了文件
- 真能把结果展示给用户

### 16.3 从“测试夹具文件”升级到“正式文档生成能力”

你的 PPT / Word / Excel / PDF 不再只是能打开，而是能成为真正可交付的产物。

### 16.4 从“单点优化”升级到“可泛化的任务处理框架”

以后不只是“AI 趋势 PPT”这一条能跑通，而是所有相似目标类型都能跑通：

- 搜索并回答
- 搜索并生成报告
- 基于文件生成报告
- 打开 / 定位文件
- 动作执行 + 文件落地

---

## 17. 最终结论

你当前系统最缺的不是更多 prompt，也不是换一个更强模型。

你最需要的是把整条链路收紧成：

```text
输入上下文
→ TaskSpec 任务编译
→ ExecutionPlan 执行计划
→ 受约束的 agentic 工具循环
→ 正式文档渲染
→ artifact 验证与注册
→ UI 清晰呈现
```

这次升级以后，系统会发生三个本质变化：

### 变化 1：AI 不再“看心情”决定搜不搜、做不做、存不存

而是根据 TaskSpec 被强约束。

### 变化 2：文件任务不再“像成功了”，而是真正可验证地成功

打开文件、创建文件、生成 PPT、转换 PDF 都会进入同一套 artifact contract。

### 变化 3：面对不同目标时，系统开始具备真正的泛化能力

无论是：

- 回答问题
- 搜索最新内容
- 分析文件
- 生成 PPT / DOCX / XLSX / PDF
- 打开或定位产物

都能走一套统一、稳定、可扩展的目标驱动执行流。

---

## 18. 一页式落地建议（最短实施版）

如果你要尽快开始，我建议先按这个顺序落地：

### 第一批（必须先做）

1. 新增 `TaskSpec / ExecutionPlan`
2. 统一 `context-submission / file-submission / browser-submission` 只消费 plan
3. 新增 `list_files / get_latest_artifact / stat_file / create_folder`
4. 强化 `open_file`
5. 增加 artifact success contract
6. 强制最新主题先搜索

### 第二批（正式能力升级）

7. `generate_document` 改为正式 renderer 架构
8. 接 `PptxGenJS / docx / ExcelJS / Playwright`
9. fixture 降级为 fallback only
10. 新增 artifact manifest + validator

### 第三批（泛化与稳定性）

11. 文件抽取层补齐
12. UI 展示 ExecutionPlan / provider / tool trace / artifact center
13. 回归测试补齐

---

如果后续你要，我可以在这个基础上继续给你追加两份配套文档：

1. **按模块拆分的实施任务清单（developer TODO 版）**
2. **新的目录结构与接口契约草案（含 TaskSpec / ExecutionPlan / ArtifactManifest 的字段定义）**
