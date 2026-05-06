const CURRENT_FILE_RE = /(这个文件|当前文件|这个文档|当前文档|这份文档|打开的文件|打开的文档|this\s+(?:file|document)|current\s+(?:file|document))/i;
const CURRENT_BROWSER_RE = /(这个页面|当前页面|此页面|该页面|此页|该页|这个网页|当前网页|此网页|当前标签页|this\s+(?:page|webpage|tab)|current\s+(?:page|webpage|tab))/i;

export function commandTargetsCurrentFileContext(commandText = "") {
  return CURRENT_FILE_RE.test(`${commandText ?? ""}`);
}

export function commandTargetsCurrentBrowserContext(commandText = "") {
  return CURRENT_BROWSER_RE.test(`${commandText ?? ""}`);
}
