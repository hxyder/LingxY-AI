// Fresh live mini-corpus for source/link-return behavior.
//
// These prompts intentionally avoid the user's earlier analyst-job wording and
// the existing feature-smoke/corpus prompts. The goal is to prove the framework
// uses evidence-fetching tools and returns links instead of opening a search
// page or claiming the request is unclear.

const SOFT_OK = ["success", "partial_success"];

function mk(id, userCommand) {
  return {
    id,
    category: "link_contract",
    userCommand,
    expected: {
      terminal: SOFT_OK,
      toolMustIncludeOneOf: ["web_search_fetch", "fetch_url_content"],
      toolMustNotInclude: ["web_search", "open_url"],
      textMustInclude: ["http"],
      textMustNotInclude: ["不理解", "没有告诉我", "无法理解", "I don't understand"],
      behavior: "Fresh research/link task must fetch evidence and answer with usable links, not open a browser/search page."
    }
  };
}

export const TEST_CORPUS = [
  mk(
    "LINK.jobs.ops_analyst_100k",
    "帮我找 3 个今天仍值得申请的 remote operations analyst 或 business systems analyst 岗位，目标总薪资 100K+，回答必须给公司、职位、薪资线索和申请链接；不要打开网页，只把链接列出来。"
  ),
  mk(
    "LINK.reports.semiconductor_analyst",
    "查找最近一周关于美国半导体股票的 analyst report 或评级更新，选 3 条最值得看的，给出机构、关注点和原文链接；不要打开浏览器页面。"
  ),
  mk(
    "LINK.devtools.windows_app_sdk",
    "帮我找 3 个关于 Windows App SDK 近期版本或迁移建议的官方/高质量资料链接，简要说明每个链接适合解决什么问题；不要只打开搜索页。"
  )
];

export default TEST_CORPUS;
