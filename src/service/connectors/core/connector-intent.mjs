const CONNECTOR_RESOURCE_PATTERN = /(邮件|邮箱|\bemails?\b|\bmail\b|gmail|outlook|日历|\bcalendar\b|google\s*calendar|google\s*drive|onedrive|云端文件|网盘|连接账户|连接的账户|已连接账户|账户|账号|connected\s+accounts?)/i;
const CONNECTOR_CONTEXT_PATTERN = /(我的|我连接|连接的|已连接|账户|账号|邮箱|邮件|日历|\bcalendar\b|gmail|outlook|google\s*drive|onedrive|云端文件|网盘|最近|最新|列出|查看|读取|具体|多少|哪个|\blist\b|\bshow\b|\bread\b|\brecent\b|\blatest\b|\bconnected\b)/i;
const CONNECTOR_IDENTITY_PATTERN = /(邮箱|邮件|gmail|outlook|google|microsoft|连接|已连接|connected).{0,20}(账户|账号|帐号|邮箱地址)|(?:账户|账号|帐号).{0,20}(邮箱|邮件|gmail|outlook|google|microsoft|连接|已连接|connected)|我的邮箱账号|我的邮箱账户|具体账户/i;
const CONNECTOR_SEARCH_TOPIC_PATTERN = /(新闻|资讯|动态|价格|股价|汇率|天气|航班|机票|酒店|\bnews\b|\bprice\b|\bstock\b|\bweather\b|\bflight\b|\bhotel\b)/i;

export function isConnectorDomainRequest(value = "") {
  const text = String(value ?? "");
  if (!CONNECTOR_RESOURCE_PATTERN.test(text)) return false;

  // "最新 Gmail 新闻" is a web/news request, while "我的 Gmail 最新邮件"
  // is a connector request. Anchor provider words to account/resource context.
  if (CONNECTOR_SEARCH_TOPIC_PATTERN.test(text) && !/(我的|连接|已连接|账户|账号|邮箱|邮件|日历|文件|drive|onedrive)/i.test(text)) {
    return false;
  }

  return CONNECTOR_CONTEXT_PATTERN.test(text);
}

export function isConnectorAccountIdentityRequest(value = "") {
  const text = String(value ?? "");
  return CONNECTOR_IDENTITY_PATTERN.test(text)
    || (isConnectorDomainRequest(text) && /(账户|账号|帐号|邮箱地址|具体账户|connected\s+accounts?)/i.test(text));
}

export function inferConnectorProvider(value = "") {
  const text = String(value ?? "");
  if (/(gmail|google|谷歌)/i.test(text)) return "google";
  if (/(outlook|microsoft|微软|onedrive)/i.test(text)) return "microsoft";
  return null;
}

export function inferConnectorLimit(value = "", fallback = 10) {
  const text = String(value ?? "");
  const arabic = text.match(/(\d{1,3})\s*(?:个|封|条|封邮件|emails?|messages?)/i);
  if (arabic) return Math.max(1, Math.min(100, Number(arabic[1])));
  if (/(三|three)/i.test(text)) return 3;
  if (/(五|five)/i.test(text)) return 5;
  if (/(十|ten)/i.test(text)) return 10;
  return fallback;
}
