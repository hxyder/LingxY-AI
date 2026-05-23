const STORAGE_KEY = "lingxy.locale";
const SUPPORTED = new Set(["en-US", "zh-CN"]);
const textOriginals = new WeakMap();
const attrOriginals = new WeakMap();
const managedTextNodes = new WeakSet();
const localeSelects = new Set();
let activeLocale = normalizeLocale(readStoredLocale());
let applying = false;
let observer = null;
let storageListenerInstalled = false;

const ATTRS = ["title", "aria-label", "placeholder", "data-empty-prompt"];
const TEXT_SKIP_SELECTOR = [
  "[data-no-i18n]",
  ".bubble",
  ".console-chat-message",
  ".console-chat-empty-icon",
  ".markdown-body",
  ".artifact-preview",
  "#taskArtifactPreview",
  "#filesPreviewBody",
  "#consolePreviewBody",
  "#noteBody",
  "#noteChatLog",
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE"
].join(",");

const EN_TO_ZH = new Map(Object.entries({
  "Tasks": "任务",
  "Chat": "聊天",
  "Schedules": "计划",
  "Inbox": "收件箱",
  "Notes": "笔记",
  "Connectors": "连接器",
  "Settings": "设置",
  "Refresh": "刷新",
  "Back": "返回",
  "Close": "关闭",
  "New chat": "新建对话",
  "Search": "搜索",
  "Cancel": "取消",
  "Save": "保存",
  "Delete": "删除",
  "Configure": "配置",
  "Enable": "启用",
  "Disable": "禁用",
  "Language": "语言",
  "Light": "浅色",
  "Dark": "深色",
  "Quick actions": "快速动作",
  "Active model": "当前模型",
  "Attach file": "添加文件",
  "Insert from notes": "从笔记插入",
  "Voice input": "语音输入",
  "Open overlay": "打开 Overlay",
  "Keyboard shortcuts": "快捷键",
  "Check for updates": "检查更新",
  "Location": "位置",
  "Console sections": "控制台栏目",
  "Conversation list": "对话列表",
  "Conversation and project files": "对话和项目文件",
  "File preview": "文件预览",
  "Preview content": "预览内容",
  "Open output folder": "打开输出目录",
  "Search notes...": "搜索笔记...",
  "Untitled note": "未命名笔记",
  "Note body": "笔记正文",
  "New project": "新建项目",
  "New project name": "新项目名称",
  "Refresh tasks": "刷新任务",
  "Search task runs": "搜索任务运行",
  "Task time range": "任务时间范围",
  "Task status filter": "任务状态过滤",
  "Advanced filter": "高级过滤",
  "Task date filter": "任务日期过滤",
  "Task source filter": "任务来源过滤",
  "Schedule view mode": "计划视图模式",
  "Resource type": "资源类型",
  "Settings sections": "设置栏目",
  "Find setting": "查找设置",
  "More": "更多",
  "Edit": "编辑",
  "Merge": "合并",
  "Move to group": "移到分组",
  "Exit multi-select": "退出多选",
  "Created": "创建时间",
  "Last edited": "最后编辑",
  "Send": "发送",
  "Bold": "加粗",
  "Italic": "斜体",
  "Underline": "下划线",
  "Heading": "标题",
  "Quote": "引用",
  "List": "列表",
  "Numbered": "编号",
  "Link": "链接",
  "Image": "图片",
  "Table": "表格",
  "Divider": "分隔线",
  "Insert timestamp": "插入时间戳",
  "Font size": "字号",
  "Font family": "字体",
  "Open voice note recorder": "打开语音笔记",
  "Open this project in Chat": "在聊天中打开项目",
  "Start a new chat in this project": "在此项目中新建对话",
  "Add files/folders": "添加文件/文件夹",
  "Refresh project workspace": "刷新项目工作区",
  "Clear chat thread": "清空聊天线程",
  "Show context files": "显示上下文文件",
  "Open containing folder": "打开所在文件夹",
  "Open in window / external app": "在窗口/外部应用打开",
  "Open local file": "打开本地文件",
  "Reveal in folder": "在文件夹中显示",
  "Remove from project": "从项目移除",
  "Reindex for project search": "为项目搜索重建索引",
  "Clear project search index only": "仅清除项目搜索索引",
  "Change model for this conversation": "更改此对话模型",
  "No providers configured. Click \"+ Add Provider\" to start.": "尚未配置服务商。点击“+ Add Provider”开始。",
  "No email accounts configured.": "尚未配置邮箱账号。",
  "No MCP servers configured.": "尚未配置 MCP 服务。",
  "No code CLI adapters configured.": "尚未配置代码 CLI 适配器。",
  "Could not save connector account config.": "无法保存连接器账号配置。",
  "Could not save MCP server config.": "无法保存 MCP 服务配置。",
  "Could not save routing config.": "无法保存路由配置。",
  "Could not save output config.": "无法保存输出配置。",
  "Could not save feature config.": "无法保存功能配置。",
  "Could not save runtime labs config.": "无法保存 Runtime Labs 配置。",
  "Invalid configuration.": "配置无效。"
}));

[
  ["Chat", "对话"],
  ["Conversations", "会话"],
  ["Conversations", "对话"],
  ["Conversations and history", "对话与历史"],
  ["Choose a conversation or project", "选择会话或项目"],
  ["Choose a project or history conversation", "选择项目或历史对话"],
  ["Conversation history list", "历史对话列表"],
  ["Switch conversations / view history", "切换对话 / 查看历史会话"],
  ["Switch conversations / view history (local cache pending, click to retry)", "切换对话 / 查看历史会话（本地缓存待写入，点击重试）"],
  ["Projects", "项目"],
  ["Search conversations...", "搜索对话…"],
  ["Project scope", "项目范围"],
  ["Start a conversation", "开始对话"],
  ["No conversation selected.", "未选择对话。"],
  ["Drop to add attachments", "松开鼠标以添加附件"],
  ["Images, documents, code, and more are supported.", "支持图片、文档、代码等"],
  ["Drag dialog", "拖动对话框"],
  ["Conversation history", "对话记录"],
  ["Task list", "任务清单"],
  ["Open task list", "打开任务清单"],
  ["Close task list", "关闭任务清单"],
  ["Pin", "置顶"],
  ["Resize dialog", "调整对话框大小"],
  ["Waiting for recording...", "等待录音..."],
  ["Close", "关闭"],
  ["Update check uses GitHub Releases.", "检查更新（会访问 GitHub Releases）"],
  ["Enable Windows location for place-aware queries and triggers.", "启用 Windows 定位（用于地点相关查询和触发器）"],
  ["Pending Approvals", "待确认"],
  ["Failed Tasks", "最近失败任务"],
  ["Refresh", "刷新"],
  ["Preview", "预览"],
  ["Preview engine", "文件预览引擎"],
  ["Task templates", "任务模板"],
  ["Saved reusable prompt templates.", "保存可复用的提示词模板。"],
  ["Token Usage", "用量"],
  ["Audit Log", "审计日志"],
  ["Tool calls, approvals, and connector runtime traces.", "工具调用、审批和连接器行为的运行时轨迹。"],
  ["Retry", "重试"],
  ["Retrying...", "重试中…"],
  ["Retry failed", "重试失败"],
  ["Started", "已发起"],
  ["Copied", "已复制"],
  ["Copy", "复制"],
  ["Regenerate", "重新生成"],
  ["Regenerating...", "重新生成中…"],
  ["Task failed", "任务失败"],
  ["Task cancelled", "任务已取消"],
  ["Task cancelled.", "任务已取消。"],
  ["Task failed.", "任务执行失败。"],
  ["Loading image preview...", "正在加载图片预览..."],
  ["Open image:", "打开图片："],
  ["Args collapsed", "参数已折叠"]
].forEach(([en, zh]) => EN_TO_ZH.set(en, zh));

const ZH_TO_EN = new Map([...EN_TO_ZH.entries()].map(([en, zh]) => [zh, en]));

export function normalizeLocale(locale = "en-US") {
  const value = String(locale ?? "").trim();
  if (SUPPORTED.has(value)) return value;
  const lower = value.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower.startsWith("zh-hans")) return "zh-CN";
  if (lower === "en" || lower === "en-us" || lower.startsWith("en-")) return "en-US";
  return "en-US";
}

export function currentLingxyLocale() {
  return activeLocale;
}

export function setLingxyLocale(locale) {
  activeLocale = normalizeLocale(locale);
  try { localStorage.setItem(STORAGE_KEY, activeLocale); } catch { /* ignore */ }
  syncLocaleSelects();
  applyLingxyLocale(activeLocale);
  window.dispatchEvent(new CustomEvent("lingxy-locale-changed", { detail: { locale: activeLocale } }));
}

export function installLingxyI18nControls({ select = null } = {}) {
  activeLocale = normalizeLocale(readStoredLocale());
  if (select) {
    localeSelects.add(select);
    select.value = activeLocale;
    if (select.dataset.lingxyLocaleBound !== "true") {
      select.dataset.lingxyLocaleBound = "true";
      select.addEventListener("change", () => setLingxyLocale(select.value));
    }
  }
  applyLingxyLocale(activeLocale);
  if (!observer && document.body) {
    observer = new MutationObserver(() => {
      if (applying) return;
      queueMicrotask(() => applyLingxyLocale(activeLocale));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (!storageListenerInstalled) {
    storageListenerInstalled = true;
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        activeLocale = normalizeLocale(event.newValue);
        syncLocaleSelects();
        applyLingxyLocale(activeLocale);
      }
    });
  }
}

export function applyLingxyLocale(locale = activeLocale) {
  activeLocale = normalizeLocale(locale);
  applying = true;
  try {
    document.documentElement.lang = activeLocale;
    document.documentElement.dataset.locale = activeLocale;
    document.body?.setAttribute("data-locale", activeLocale);
    applyBilingualContainers(document.body);
    applyTextNodes(document.body);
    applyAttributes(document.body);
  } finally {
    applying = false;
  }
}

function readStoredLocale() {
  try {
    return localStorage.getItem(STORAGE_KEY)
      || navigator.languages?.find((lang) => /^zh|^en/i.test(lang))
      || navigator.language
      || "en-US";
  } catch {
    return "en-US";
  }
}

function translate(value, locale) {
  const raw = String(value ?? "");
  if (!raw.trim()) return raw;
  const split = splitInlineBilingual(raw);
  if (split) return locale === "zh-CN" ? split.zh : split.en;
  const trimmed = raw.trim();
  const mapped = locale === "zh-CN" ? EN_TO_ZH.get(trimmed) : ZH_TO_EN.get(trimmed);
  if (!mapped) return raw;
  return raw.replace(trimmed, mapped);
}

function splitInlineBilingual(value) {
  const raw = String(value ?? "");
  if (!/[A-Za-z]/.test(raw) || !/[\u3400-\u9fff]/.test(raw)) return null;
  const enFirst = raw.match(/^(?<en>.*?[A-Za-z][^。？！\u3400-\u9fff]*?)(?:\s{2,}|[|／/]|[—-])(?<zh>[\u3400-\u9fff].*)$/u);
  if (enFirst?.groups?.en && enFirst.groups.zh) {
    return { en: enFirst.groups.en.trim(), zh: enFirst.groups.zh.trim() };
  }
  const zhFirst = raw.match(/^(?<zh>[\u3400-\u9fff].*?)(?:\s{2,}|[|／/]|[—-])(?<en>.*?[A-Za-z].*)$/u);
  if (zhFirst?.groups?.en && zhFirst.groups.zh) {
    return { en: zhFirst.groups.en.trim(), zh: zhFirst.groups.zh.trim() };
  }
  return null;
}

function applyBilingualContainers(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(".zh").forEach((span) => {
    const parent = span.parentElement;
    if (!parent || parent.dataset.i18nBilingual === "done") return;
    const directZh = Array.from(parent.children).filter((child) => child.classList?.contains("zh"));
    const hasOtherElementChildren = Array.from(parent.children).some((child) => !child.classList?.contains("zh"));
    if (hasOtherElementChildren || directZh.length === 0) return;
    const clone = parent.cloneNode(true);
    clone.querySelectorAll(".zh").forEach((node) => node.remove());
    const en = clone.textContent.trim();
    const zh = directZh.map((node) => node.textContent.trim()).filter(Boolean).join(" ");
    if (!en || !zh) return;
    parent.dataset.i18nEn = en;
    parent.dataset.i18nZh = zh;
    parent.dataset.i18nBilingual = "done";
  });
  root.querySelectorAll(".zh").forEach((span) => {
    const parent = span.parentElement;
    if (!parent || parent.dataset.i18nComplexBilingual === "done") return;
    const directZh = Array.from(parent.children).filter((child) => child.classList?.contains("zh"));
    const hasOtherElementChildren = Array.from(parent.children).some((child) => !child.classList?.contains("zh"));
    if (!hasOtherElementChildren || directZh.length === 0) return;
    const directTextNodes = Array.from(parent.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim());
    if (directTextNodes.length === 0) return;
    const left = directTextNodes.map((node) => node.nodeValue.trim()).filter(Boolean).join(" ");
    const right = directZh.map((node) => node.textContent.trim()).filter(Boolean).join(" ");
    const pair = normalizeBilingualPair(left, right);
    if (!pair) return;
    parent.dataset.i18nEn = pair.en;
    parent.dataset.i18nZh = pair.zh;
    parent.dataset.i18nComplexBilingual = "done";
    for (const node of directTextNodes) managedTextNodes.add(node);
    directZh.forEach((node) => {
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
    });
  });
  root.querySelectorAll("[data-i18n-en][data-i18n-zh]").forEach((element) => {
    if (element.dataset.i18nComplexBilingual === "done") {
      const directTextNodes = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE && managedTextNodes.has(node));
      if (directTextNodes[0]) {
        directTextNodes[0].nodeValue = activeLocale === "zh-CN" ? element.dataset.i18nZh : element.dataset.i18nEn;
      }
      return;
    }
    element.textContent = activeLocale === "zh-CN" ? element.dataset.i18nZh : element.dataset.i18nEn;
  });
}

function applyTextNodes(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (managedTextNodes.has(node)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(TEXT_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (!textOriginals.has(node)) textOriginals.set(node, node.nodeValue);
    node.nodeValue = translate(textOriginals.get(node), activeLocale);
  }
}

function applyAttributes(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("*").forEach((element) => {
    let originals = attrOriginals.get(element);
    if (!originals) {
      originals = new Map();
      attrOriginals.set(element, originals);
    }
    for (const attr of ATTRS) {
      if (!element.hasAttribute(attr)) continue;
      if (!originals.has(attr)) originals.set(attr, element.getAttribute(attr));
      element.setAttribute(attr, translate(originals.get(attr), activeLocale));
    }
  });
}

function normalizeBilingualPair(left, right) {
  const a = String(left ?? "").trim();
  const b = String(right ?? "").trim();
  if (!a || !b) return null;
  const aEnglish = /[A-Za-z]/.test(a);
  const aChinese = /[\u3400-\u9fff]/.test(a);
  const bEnglish = /[A-Za-z]/.test(b);
  const bChinese = /[\u3400-\u9fff]/.test(b);
  if (aEnglish && bChinese) return { en: a, zh: b };
  if (aChinese && bEnglish) return { en: b, zh: a };
  return null;
}

function syncLocaleSelects() {
  for (const select of localeSelects) {
    if (select?.isConnected) select.value = activeLocale;
  }
}
