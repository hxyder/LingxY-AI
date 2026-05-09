import assert from "node:assert/strict";
import { filterToolsForTask } from "../src/service/executors/tool_using/tool-surface.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { detectUnsatisfiedRequiredLinkAnswer } from "../src/service/core/policy/success-contract-validator.mjs";

const tools = [
  { id: "web_search", policy_group: "external_web_read" },
  { id: "web_search_fetch", policy_group: "external_web_read" },
  { id: "fetch_url_content", policy_group: "external_web_read" },
  { id: "open_url" }
];

const linkTask = {
  user_command: "今天有没有什么值得看的 analyst 工作，我想申请，工资100K+，把链接给我",
  context_packet: { source_type: "clipboard", source_app: "uca.console" },
  context_packet_initial: {},
  task_spec: {
    success_contract: {
      required_policy_groups: ["external_web_read"]
    },
    tool_policy: {
      policy_groups: {
        external_web_read: { mode: "required" }
      },
      web_search_fetch: { mode: "required" }
    }
  },
  context_packet_extra: {},
  task_spec_initial: null
};

const exposed = filterToolsForTask(tools, linkTask).map((tool) => tool.id);
assert.ok(exposed.includes("web_search_fetch"), "link/research tasks must expose result-fetching search");
assert.ok(exposed.includes("fetch_url_content"), "link/research tasks may fetch concrete source URLs");
assert.ok(!exposed.includes("web_search"), "opening a search page must not satisfy link/research delivery");
assert.ok(!exposed.includes("open_url"), "asking for links must not navigate the browser");

const openSearchTask = {
  ...linkTask,
  user_command: "打开 Google 搜索页搜索 analyst jobs 100k",
  task_spec: { success_contract: { required_policy_groups: [] } }
};
const openSearchExposed = filterToolsForTask(tools, openSearchTask).map((tool) => tool.id);
assert.ok(openSearchExposed.includes("web_search"), "explicit search-page navigation still exposes web_search");

for (const prompt of [
  "帮我找 3 个今天仍值得申请的 remote operations analyst 岗位，目标总薪资 100K+，回答必须给公司、职位、薪资线索和申请链接；不要打开网页，只把链接列出来。",
  "查找最近一周关于美国半导体股票的 analyst report 或评级更新，选 3 条最值得看的，给出机构、关注点和原文链接；不要打开浏览器页面。"
]) {
  const spec = createTaskSpec(prompt, {}, {});
  assert.equal(
    spec.tool_policy?.policy_groups?.external_web_read?.mode,
    "required",
    `link/source prompt must require background web read: ${prompt}`
  );
  assert.ok(spec.success_contract?.required_policy_groups?.includes("external_web_read"));
}

const linkSpec = createTaskSpec(
  "帮我找 3 个 remote analyst 岗位，给公司、薪资线索和申请链接；不要打开网页，只把链接列出来。",
  {},
  {}
);
assert.equal(
  detectUnsatisfiedRequiredLinkAnswer(
    linkSpec,
    [{ type: "tool_result", tool: "web_search_fetch", success: true, observation: "generic job boards only" }],
    "我无法直接列出公司、职位、薪资和申请链接。建议你自行访问 Indeed 搜索。"
  )?.kind,
  "required_link_answer_not_satisfied",
  "admitted failure to provide requested links must downgrade success"
);
assert.equal(
  detectUnsatisfiedRequiredLinkAnswer(
    linkSpec,
    [{ type: "tool_result", tool: "web_search_fetch", success: true, observation: "found concrete link" }],
    "1. Example Analyst - https://example.com/jobs/123"
  ),
  null,
  "concrete URL answer should not be downgraded"
);

console.log("web search link contract ok");
