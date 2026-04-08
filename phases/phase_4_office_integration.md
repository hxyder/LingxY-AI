# Phase 4 — Office 深度集成

> 周期估计：W23–W26（4 周） · 角色：1 .NET/Office + 1 后端
> 上一阶段：[Phase 2.5](phase_2_5_privacy_security.md) / [Phase 3](phase_3_overlay_followcursor.md) · 下一阶段：[Phase 5](phase_5_pdf_visual_fallback.md)

## 1. 目标

让 UCA 在 Word / Excel / PowerPoint 内变成"自然存在的助手"：
- 用户在文档中选区 → 通过 Add-in 的 Task Pane 一键发起任务
- 不依赖剪贴板、不依赖屏幕监控
- 选区精确到 cell 范围、page、slide

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | Office.js Add-in 项目 | Word / Excel / PowerPoint 三个清单 |
| 2 | Task Pane UI | 与悬浮窗类似但作为 Add-in 嵌入 |
| 3 | 选区抓取 | 调 Office.js API 取选中范围 |
| 4 | Word: 选段 / 整文档 | + 段落级 metadata |
| 5 | Excel: 选区 / 命名区域 / 整 sheet | + 行列数 / 数据类型 |
| 6 | PPT: 选中对象 / 当前 slide / 整套 | + 形状类型 |
| 7 | Add-in ↔ Service 通信 | 走 HTTPS localhost:9412（需 cert） |
| 8 | 本地 HTTPS 自签证书 | Add-in 要求 https |
| 9 | 任务结果回写 | "插入到文档"/"替换选区" 动作 |
| 10 | 智能动作菜单 | Word 偏改写/总结，Excel 偏图表/分析，PPT 偏大纲/总结 |

### 2.2 不做

- VSTO（弃用方向，不投入）
- COM Add-in（旧）
- Outlook 集成（如有需要 Phase 6）
- Office for Mac 兼容（Office.js 跨平台但 MVP 只验证 Windows）

## 3. 架构

### 3.1 Office Add-in 类型决策

| 方案 | 选择 | 理由 |
|---|---|---|
| Office.js Add-in (JavaScript / Web) | ✅ | 跨 Office 版本、跨平台、官方推荐、最稳 |
| VSTO | ❌ | 仅 Windows、需 .NET、Microsoft 减少投入 |
| COM Add-in | ❌ | 老技术 |

### 3.2 部署方式

- **开发期**：sideload manifest.xml
- **小规模发布**：网络共享文件夹托管 manifest.xml
- **正式发布**：AppSource 商店（评估中，需企业资质）
- **企业批量**：用 Microsoft Intune 推送

### 3.3 通信链路

```
┌────────────────────────────────────┐
│  Word / Excel / PowerPoint          │
│  ┌──────────────────────────────┐  │
│  │  Office.js Add-in            │  │
│  │  (Task Pane: HTML+TS)        │  │
│  │  - Office.context.document   │  │
│  │  - getSelectedDataAsync      │  │
│  └────────────┬─────────────────┘  │
└───────────────┼────────────────────┘
                │ HTTPS https://localhost:9413
                ▼
       ┌─────────────────────┐
       │  uca-service        │
       │  (新增 9413 HTTPS) │
       └─────────────────────┘
```

**为什么单独开 9413**：Office.js 要求所有外部资源走 HTTPS。Phase 1a 的 9412 是 HTTP（其它客户端用），9413 加 TLS 仅给 Office Add-in。

### 3.3.1 Local HTTPS 前置 Spike

Office 的本地 HTTPS 不视为“默认已解决问题”，而是 Phase 4 的前置 spike。要求如下：

- **时间盒**：5 个工作日
- **超时策略**：5 个工作日内无法得出明确结论，则默认进入“基础验收”路径，暂不阻塞 Phase 4 ship

Spike 需要对比 3 条候选路径：

| 路径 | 实现 | 优点 | 缺点 | 风险评级 |
|---|---|---|---|---|
| A. 自签根证书 + Trusted Root | service 安装本地证书并由 Add-in 直连 `https://localhost:9413` | 全本地、嵌入体验完整、可做回写 | 受 admin/UAC 与企业 GPO 限制明显 | 个人版高，企业版低 |
| B. 远端 Add-in shell + localhost companion | Add-in shell 托管在受控站点，本地仍由 companion 与 service 握手 | 减少本地静态资源分发复杂度 | 仍需解决 localhost 证书有效性 | 中 |
| C. 自定义 URI / protocol handler | Add-in 只负责读取选区并把 payload 交给 `uca-cli` | 最稳、规避本地 HTTPS 依赖 | 无法提供完整回写与深嵌入体验 | 最稳但体验最低 |

Spike 的退出条件：

- 路径 A 在个人版与企业版测试机都可用：选 A
- 路径 A 仅个人版可用，企业版失败：评估 A/B 双轨
- 路径 A、B 都不满足：选 C，并接受“Phase 4 不含文档回写”作为正式交付边界

Phase 4 采用双层验收：

- **基础验收（必须达成）**：
  - 选区采集 → ContextPacket → service → 任务执行 → 主控制台可见结果
  - 不要求结果写回 Word/Excel/PPT
  - Task Pane 可简陋，但必须可用
- **增强验收（不阻塞 ship）**：
  - Task Pane 中流式显示结果
  - 一键回写选区 / 插入到下方单元格
  - 本地 HTTPS 直连无证书告警

### 3.4 ContextPacket 新 source_type

```jsonc
// Word
{
  "source_type": "office_selection",
  "source_app": "WINWORD.EXE",
  "office_app": "Word",
  "text": "选中段落文本",
  "selection_metadata": {
    "paragraph_count": 3,
    "word_count": 280,
    "style": "Heading2",
    "document_path": "C:/...sample.docx"
  }
}

// Excel
{
  "source_type": "office_selection",
  "office_app": "Excel",
  "selection_metadata": {
    "sheet_name": "Sheet1",
    "range": "A1:D20",
    "row_count": 20,
    "col_count": 4,
    "has_headers": true,
    "data_preview": [...first 5 rows...]
  }
}

// PowerPoint
{
  "source_type": "office_selection",
  "office_app": "PowerPoint",
  "selection_metadata": {
    "slide_index": 5,
    "slide_count": 24,
    "shape_type": "TextBox|Image|Chart",
    "selected_text": "..."
  }
}
```

## 4. 流程设计

### 4.1 Word 总结流程

```
1. 用户在 Word 选中 3 段文字
2. Task Pane 已打开（侧栏）
3. Task Pane 通过 Office.js 实时拿到 selection text
4. 显示：
   - "已识别 280 字"
   - 快捷动作：总结 / 改写 / 翻译 / 提取要点
5. 用户点"总结"
6. Task Pane → POST https://localhost:9413/task
7. service → FastExecutor → 流式返回
8. Task Pane 渲染流式结果
9. 结果区下方 3 个按钮：
   - 复制
   - 替换选区（回写）
   - 在控制台中查看
```

### 4.2 Excel 数据分析流程

```
1. 用户选中 A1:D20（带表头）
2. Task Pane 显示数据预览（前 5 行）
3. 智能动作：
   - 总结这张表
   - 找出异常值
   - 生成可视化建议
   - 写一段汇报
4. 用户点"找出异常值"
5. Task Pane → service → KimiCLIExecutor
6. 任务包含 selection 数据 (json) + intent
7. Kimi 分析后产出 markdown 报告
8. Task Pane 显示结果 + "插入到下方 cell" 按钮
9. 用户点击插入 → Office.js setSelectedDataAsync 写回
```

### 4.3 PPT 演讲稿生成

```
1. 用户选中 5 张 slide
2. Task Pane 自动读取每张 slide 的文本+备注
3. 动作：生成演讲稿
4. service → Kimi → 流式生成
5. 结果可下载为 .docx
```

## 5. 验收标准

### 5.1 功能验收
- [ ] Word/Excel/PPT sideload 后均能打开 Task Pane
- [ ] 选区变化时 Task Pane ≤ 500ms 内更新
- [ ] Excel 数据预览正确（前 5 行 + 列数）
- [ ] PPT 多 slide 选中能取到全部文本+备注
- [ ] "替换选区" 在 Word 中正确写回
- [ ] "插入到下方 cell" 在 Excel 中正确写回
- [ ] HTTPS 自签证书安装失败时 UI 给清晰提示
- [ ] Add-in 在 Office 365 桌面版和 Office 2019 LTSC 都能跑
- [ ] manifest.xml 通过 Microsoft 校验工具

### 5.2 性能验收
- [ ] Task Pane 打开 ≤ 1s（热）/ 3s（冷）
- [ ] 选区抓取 ≤ 200ms
- [ ] 大 sheet (10000 行) 抓取头 100 行 ≤ 500ms

### 5.3 工程验收
- [ ] manifest.xml 三份（Word/Excel/PPT）通过 Office Add-in Validator
- [ ] 自签证书安装/卸载脚本
- [ ] sideload 文档 + 截图
- [ ] 集成测试：模拟 Office.js context（jest-environment-office）

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Office.js 在不同 Office 版本 API 差异 | Add-in 部分失效 | 用 requirement sets 显式声明 + feature detection |
| HTTPS 自签证书企业策略禁止 | Add-in 无法连 service | 列为 Phase 4 前置 spike；备选为企业受信任证书、远端 Add-in shell + 本地 companion、或 protocol handler 降级路径 |
| 大 Excel 数据 OOM | service 崩溃 | 抓取限制：默认 10000 cells，超过分批 |
| 用户在 Excel 选了图片/形状而非数据 | 任务失败 | 智能识别选区类型，给出正确动作 |
| Task Pane 占用屏幕空间 | 用户嫌挤 | 支持折叠到 Quick Access |
| Add-in 启动慢 | 体验差 | 资源走 service 缓存，首次后秒开 |
| AppSource 上架审核漫长 | 无法商店发布 | MVP 用 sideload，正式版再走 AppSource |

## 7. 交付物清单

```
office_addin/
  ├─ word/manifest.xml
  ├─ excel/manifest.xml
  ├─ ppt/manifest.xml
  ├─ shared/
  │   ├─ task_pane.html
  │   ├─ index.ts
  │   ├─ office_bridge.ts
  │   └─ ui/
  └─ build/
src/service/
  ├─ https/
  │   ├─ self_signed_cert.ts
  │   └─ port_9413.ts
docs:
  ├─ office_addin_sideload.md
  ├─ self_signed_cert_setup.md
  └─ phase_4_demo.mp4
```

## 8. 与下一 Phase 的接口

Phase 5 处理 PDF 与按需 OCR。这两块与 Office 是平行能力，但都依赖 Phase 1b 的文件入口和 Phase 2.5 的 Security Broker。
