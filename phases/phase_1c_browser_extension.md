# Phase 1c — 浏览器扩展

> 周期估计：W13–W15（3 周） · 角色：1 前端 + 0.5 后端
> 上一阶段：[Phase 1b](phase_1b_file_capability.md) · 下一阶段：[Phase 2](phase_2_status_completeness.md)

## 1. 目标

让用户在浏览器内（Chrome / Edge）选中文本、右键链接、右键图片就能调出 UCA。这是 UCA 第一次"接近选区"的能力，是日常高频使用场景。

> 用户在网页上选中一段话 → 右键 "用 UCA 总结" → 浮窗几秒内显示流式结果。

## 2. 范围

### 2.1 必做

| # | 模块 | 范围 |
|---|---|---|
| 1 | MV3 浏览器扩展 | Chrome / Edge 适配，含 manifest.json |
| 2 | content script | 监听 selectionchange，缓存最近选区 |
| 3 | background service worker | 路由消息到 Native Messaging Host |
| 4 | 右键菜单 | "用 UCA 总结" / "用 UCA 翻译" / "用 UCA 抓取并总结" |
| 5 | Native Messaging Host | 注册 Win 注册表，stdin/stdout JSON |
| 6 | uca-service 接收新 source_type | text_selection / link / image / webpage |
| 7 | 链接抓取 Tool Executor | 用 fetch + readability 简化网页 |
| 8 | 浮窗轻浮标 (限定浏览器) | content script 注入按钮，靠近选区 |
| 9 | 扩展 popup | 显示最近 5 条 UCA 任务 + 跳转主控制台 |

### 2.2 不做

- Firefox / Safari（后续）
- 跨应用跟随浮标（不做）
- DOM 复杂结构提取（Phase 6 用动作模板做）
- 内容农场反爬绕过（不做）
- 表单填充 / 自动化操作（不做）

## 3. 架构

### 3.1 通信链路

```
┌────────────────────────────────────────────────┐
│  Chrome / Edge                                  │
│  ┌─────────────────┐  ┌──────────────────────┐ │
│  │ content script  │  │ background SW         │ │
│  │ - 监听 selection │←→│ - chrome.contextMenus │ │
│  │ - 注入浮标       │  │ - chrome.runtime.     │ │
│  │ - 显示结果 toast │  │   sendNativeMessage   │ │
│  └─────────────────┘  └──────────┬───────────┘ │
└─────────────────────────────────┼──────────────┘
                                  │ stdio JSON
                                  ▼
                ┌─────────────────────────────┐
                │  uca-native-host.exe        │
                │  (Node single-file binary)  │
                │  - 解析浏览器消息            │
                │  - HTTP POST → uca-service  │
                │  - 把响应/事件转回 stdio     │
                └─────────────┬───────────────┘
                              │ HTTP localhost:9412
                              ▼
                ┌─────────────────────────────┐
                │  uca-service                │
                │  (已存在)                    │
                └─────────────────────────────┘
```

### 3.2 关键技术决策

| 项 | 选择 | 理由 |
|---|---|---|
| Manifest 版本 | MV3 | Chrome 已强制；MV2 6 月将终止 |
| Service Worker | 是 | MV3 强制；注意要处理 SW 休眠 |
| 通信 | Native Messaging Host | 浏览器扩展无法直接 fetch localhost（CORS + 安全） |
| 注册位置 | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.uca.host` | 用户级，不需管理员 |
| 消息格式 | 4 字节长度 + JSON | 标准 Native Messaging 协议 |
| 网页内容简化 | `@mozilla/readability` | 标准、稳定 |
| 浮标实现 | Shadow DOM 注入 | 避免污染页面样式 |
| 扩展商店 | 暂不上架，sideload + .crx 安装 | MVP 阶段方便迭代 |

### 3.3 Native Messaging Host 注册

Phase 1b 安装包要在卸载/安装时写入：

```jsonc
// %APPDATA%/UCA/native_host_manifest.json
{
  "name": "com.uca.host",
  "description": "UCA Native Messaging Host",
  "path": "C:/Program Files/UCA/uca-native-host.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<EXT_ID>/",
    "chrome-extension://<EDGE_EXT_ID>/"
  ]
}
```

注册表：
```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.uca.host
  (default) = "C:/Users/.../AppData/Roaming/UCA/native_host_manifest.json"
HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.uca.host
  (default) = "C:/Users/.../AppData/Roaming/UCA/native_host_manifest.json"
```

### 3.4 ContextPacket 新 source_type

```jsonc
// 文本选区
{
  "source_type": "text_selection",
  "source_app": "chrome.exe",
  "capture_mode": "extension",
  "text": "选中的内容",
  "url": "https://example.com/article",
  "selection_metadata": {
    "page_title": "...",
    "context_before": "...",  // 选区前 100 字
    "context_after": "..."
  }
}

// 链接
{
  "source_type": "link",
  "url": "https://example.com/article",
  "selection_metadata": { "anchor_text": "Read more" }
}

// 图片
{
  "source_type": "image",
  "url": "https://example.com/img.png",
  "image_paths": ["..."]  // 下载到本地后填充
}

// 整网页
{
  "source_type": "webpage",
  "url": "https://example.com/article",
  "html": "<readability simplified html>",
  "text": "<extracted text>"
}
```

## 4. 流程设计

### 4.1 选区→总结流程

```
User             Page         Content   Background    Native      Service
                              Script    SW            Host
 │ 选中文本       │              │          │           │            │
 ├──────────────►│              │          │           │            │
 │               │ selection    │          │           │            │
 │               ├─────────────►│          │           │            │
 │               │              │ debounce(150ms)      │            │
 │               │              │ inject 浮标按钮       │            │
 │ 点击浮标按钮    │              │          │           │            │
 ├─────────────────────────────►│          │           │            │
 │               │              │ message  │           │            │
 │               │              ├─────────►│           │            │
 │               │              │          │ sendNativeMessage      │
 │               │              │          ├──────────►│            │
 │               │              │          │           │ HTTP /context
 │               │              │          │           ├───────────►│
 │               │              │          │           │  ctx_id    │
 │               │              │          │           │◄───────────┤
 │               │              │          │           │ HTTP /task │
 │               │              │          │           ├───────────►│
 │               │              │          │           │  task_id   │
 │               │              │          │           │◄───────────┤
 │               │              │          │           │ SSE events │
 │               │              │          │           │◄───────────┤
 │               │              │          │◄──────────┤            │
 │               │              │◄─────────┤           │            │
 │               │ 显示流式 toast │          │           │            │
 │◄──────────────┤              │          │           │            │
```

### 4.2 链接抓取流程

```
1. 用户右键链接 → "用 UCA 抓取并总结"
2. background SW → Native Host → service
3. service.IntentRouter 路由到 Tool Executor: WebFetcher
4. WebFetcher: fetch(url) → readability.parse() → text
5. 把 text 作为新 ContextPacket 喂给 FastExecutor 做 summarize
6. 流式回传到浮窗
```

### 4.3 浮标显示规则

- 选区长度 ≥ 5 字才显示
- 选区附近坐标 + 16px 偏移
- 选区取消 → 浮标消失
- 用户按 Esc → 本页本轮不再显示
- 浮标用 Shadow DOM 注入，CSS 完全隔离
- 同一对象 5s 内不重复出现

## 5. 验收标准

### 5.1 功能验收
- [ ] Chrome / Edge 上手动安装 .crx 后能看到扩展图标
- [ ] 选中网页文本 ≥ 5 字 → 浮标 ≤ 200ms 出现
- [ ] 浮标位置不被滚动错位
- [ ] 浮标按钮点击 → 浮窗显示流式总结
- [ ] 右键链接菜单 → 抓取后总结闭环
- [ ] 右键图片 → 进入 image source 流程（即使本 Phase 还没接 OCR，也要能创建任务并标 unsupported）
- [ ] 扩展 popup 显示最近 5 条任务，点击跳到主控制台对应记录
- [ ] 扩展卸载干净（含 native host 注册表）

### 5.2 性能验收
- [ ] 选区到浮标显示 ≤ 200ms（P95）
- [ ] Native Messaging 单次往返 ≤ 50ms
- [ ] Service Worker 冷启动 ≤ 500ms（首次）

### 5.3 工程验收
- [ ] manifest.json 通过 Chrome web store 静态校验（虽不上架）
- [ ] 单测：readability 抽取、消息序列化
- [ ] E2E：用 Puppeteer 模拟选区 + 点击浮标 + 验证服务收到请求
- [ ] 文档：扩展安装步骤（含 Edge）、Native Host 故障排查

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| MV3 Service Worker 5 分钟无活动会休眠 | 消息丢失 | 使用 `chrome.alarms` 唤醒 + 客户端重试 |
| Native Messaging Host 注册表权限问题 | 扩展连不上 | 安装时写 HKCU 而非 HKLM |
| 跨域抓取被网站 CORS 拦截 | 部分链接抓不到 | 走 service 端 fetch（服务器无 CORS 限制） |
| 网页 SPA 选区不稳定 | 浮标错位 | 监听 scroll/resize/mutation，重新定位 |
| Shadow DOM 注入与某些站点 CSP 冲突 | 浮标不显示 | 失败时降级到右键菜单 |
| 反爬虫导致抓取失败 | 部分链接拿不到正文 | 给用户明确提示"无法抓取，请手动复制文本" |
| 用户隐私（哪些站点监听） | 隐私顾虑 | 默认全部站点，但提供"网站黑名单"设置 |

## 7. 交付物清单

```
new components:
  browser_ext/
    ├─ manifest.json
    ├─ content_script/
    ├─ background/
    ├─ popup/
    └─ shadow_ui/
  uca-native-host/
    ├─ index.ts
    └─ build single-file binary
docs:
  install_extension.md
  native_messaging_protocol.md
  phase_1c_demo.mp4
```

## 8. 与下一 Phase 的接口

完成 Phase 1c 后，UCA 已拥有 **3 类入口**（剪贴板/快捷键、文件菜单、浏览器扩展）和 **2 类执行器**（Fast / Kimi CLI）。

[Phase 2](phase_2_status_completeness.md) 将在此基础上补齐"清楚可控"——流式步骤、失败分类、重试取消、任务详情完整化。
