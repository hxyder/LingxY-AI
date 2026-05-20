// Real-LLM functional test corpus v2.
//
// Goals (from user direction 2026-05-07):
//   - Pre-define expected outcomes per test for tight pass/fail grading.
//   - Cover "complex" (multi-step), "multi-task" (concurrent / scheduled /
//     follow-up), and "semantically ambiguous" prompts.
//   - Avoid prompts the user has tested or pasted in chat (e.g. specific
//     stock-market + email scenarios from prior bug reports).
//
// Each item:
//   - id: stable identifier for failure tracking across runs.
//   - userCommand: text submitted to /task.
//   - extra: optional shape (sourceType, contextText, scheduledFire, ...).
//   - expected: {
//       terminal:        success | partial_success | failed | cancelled set
//       toolMustInclude: tools that MUST appear in the call log
//       toolMustNotInclude: tools that MUST NOT appear
//       toolGroup:       "external_web_read" → at least one web tool fired
//       artifactKind:    docx / pptx / xlsx / pdf / md when artifact required
//       textMustInclude: substrings the final text MUST contain
//       textMustNotInclude: substrings the final text MUST NOT contain
//       behavior:        plain-language note describing intent (logged
//                        verbatim into the failure report so a reader
//                        can tell what we wanted from a glance).
//     }

const TERMINAL_OK = ["success"];
const TERMINAL_ANY = ["success", "partial_success", "failed"];
const TERMINAL_RESEARCH_OK = ["success", "partial_success"];

function mkItem(id, userCommand, expected, extra = null) {
  return {
    id,
    category: id.split(".")[0],
    userCommand,
    extra,
    expected
  };
}

function buildCorpus() {
  const items = [];

  // ─── A. qa_basic — 12 items, no tools required, factual answers ──────
  // Generic, not from the user's chats. Each expects no web tool.
  const basics = [
    ["A.bubblesort", "What is bubble sort?", ["bubble", "compar"]],
    ["A.binarytree", "二叉树有哪些常见的遍历方式？", ["遍历"]],
    ["A.dependency_inversion", "What is the dependency inversion principle?", ["abstract", "depend"]],
    ["A.kafka_basic", "Kafka 中 topic 和 partition 的关系是什么？", ["topic", "partition"]],
    ["A.float_precision", "Why is 0.1 + 0.2 not exactly 0.3 in JavaScript?", ["float", "binary"]],
    ["A.cap_theorem", "解释一下 CAP 定理。", ["consist", "avail", "partit"]],
    ["A.git_rebase", "Explain git rebase vs git merge.", ["rebase", "merge"]],
    ["A.virtual_dom", "什么是虚拟 DOM？为什么有用？", ["DOM", "diff"]],
    ["A.threadpool", "What is a thread pool and when should I use one?", ["thread", "pool"]],
    ["A.event_loop", "Node.js 的 event loop 包含哪几个阶段？", ["事件", "阶段"]],
    ["A.indexing", "为什么数据库索引能加速查询？", ["索引", "查找"]],
    ["A.unicode_vs_utf8", "Unicode 和 UTF-8 是一回事吗？", ["Unicode", "UTF-8"]]
  ];
  for (const [id, q, mustInclude] of basics) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "web_search", "download_file"],
      textMustInclude: mustInclude,
      behavior: "stable factual Q&A; should answer directly without web tools"
    }));
  }

  // ─── B. qa_with_search — 10 items, MUST hit a web tool ──────────────
  // Avoid the prompts the user asked ("今天美股", "AI 新闻"). Pick adjacent
  // but distinct topics so SR consistently routes them to multi_source.
  const searches = [
    ["B.cargo_release", "查一下 Rust 最近的 stable release 版本号"],
    ["B.swift_concurrency", "Swift 6 的 strict concurrency 有哪些常见兼容问题？"],
    ["B.cpython_perf", "CPython 3.13 的 free-threaded 模式当前的性能情况"],
    ["B.kubernetes_lts", "Kubernetes 最近哪个版本被标记为 LTS"],
    ["B.jvm_release_cadence", "OpenJDK 当前的 release cadence 是怎样的"],
    ["B.cuda_latest", "查一下 NVIDIA CUDA 最新版本支持哪些 GPU"],
    ["B.electron_release", "Electron 最新稳定版本号是多少？"],
    ["B.postgres_features", "PostgreSQL 最近一个大版本带来了哪些主要特性？"],
    ["B.go_release", "Go 最新版本是哪个？"],
    ["B.bun_status", "Bun 现在最新的稳定版本号？"]
  ];
  for (const [id, q] of searches) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_RESEARCH_OK,
      toolGroup: "external_web_read",
      behavior: "needs current/external info; web search must fire"
    }));
  }

  // ─── C. qa_local_only — 6 items, explicit "no internet" ────────────
  const locals = [
    ["C.no_search_quicksort", "不要联网，告诉我快速排序的最坏情况复杂度。", ["O(n", "最坏"]],
    ["C.no_search_pid", "不要联网，简述操作系统中 PID 的概念。", ["进程", "标识"]],
    ["C.no_internet_dns", "Don't search, just explain what DNS does.", ["DNS", "domain"]],
    ["C.no_search_observer", "不要联网，介绍一下观察者模式。", ["观察", "模式"]],
    ["C.no_search_immutable", "Without checking online, explain what immutable means in functional programming.", ["immutable"]],
    ["C.no_search_redux", "不要联网，谈谈 Redux 的核心三原则。", ["Redux"]]
  ];
  for (const [id, q, must] of locals) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "web_search", "download_file"],
      textMustInclude: must,
      behavior: "user explicitly forbade web; web tools must not fire"
    }));
  }

  // ─── D. complex_multi_step — 10 items, search + synthesise + artifact ─
  // The hardest category: composite intent. Failure modes can be partial
  // success at any of the 3 stages. Be lenient on terminal but strict on
  // "did SOME web tool fire AND some artifact exist".
  const complexSteps = [
    {
      id: "D.npm_trends_md",
      q: "查一下最近 npm 上比较热门的 5 个新包，整理成 markdown 列表",
      kind: "md"
    },
    {
      id: "D.compare_frameworks_doc",
      q: "Compare SvelteKit and Next.js for SSR in 2026 and write a 1-page docx.",
      kind: "docx"
    },
    {
      id: "D.cloud_pricing_xlsx",
      q: "搜索 AWS / GCP / Azure 当前 t2-equivalent 实例价格，整理成 Excel 表",
      kind: "xlsx"
    },
    {
      id: "D.research_brief_pptx",
      q: "Make a 4-slide PPT summarising what's new in Postgres 17.",
      kind: "pptx"
    },
    {
      id: "D.weather_advisory_md",
      q: "查一下今天上海天气，写一段穿衣建议的 markdown",
      kind: "md"
    },
    {
      id: "D.lib_review_doc",
      q: "Research the top 3 Rust async runtimes and write a docx comparing them.",
      kind: "docx"
    },
    {
      id: "D.news_digest_md",
      q: "搜索一下最近 3 篇关于 RAG 进展的文章，整理成 markdown 摘要",
      kind: "md"
    },
    {
      id: "D.pricing_compare_md",
      q: "查一下 Anthropic API 当前定价，对比 OpenAI 同档位模型，markdown",
      kind: "md"
    },
    {
      id: "D.event_summary_doc",
      q: "Search for highlights of the latest GitHub Universe and write a one-pager.",
      kind: "docx"
    },
    {
      id: "D.tooling_list_xlsx",
      q: "搜索 5 个常见的 LLM eval 工具，整理 Excel 表（名字 / GitHub / star 数）",
      kind: "xlsx"
    }
  ];
  for (const { id, q, kind } of complexSteps) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_RESEARCH_OK,
      toolGroup: "external_web_read",
      artifactKind: kind,
      mustHaveArtifact: true,
      behavior: "multi-step: search → synthesise → artifact (kind + content)"
    }));
  }

  // ─── E. ambiguous — 12 items, vague intent / underspecified ────────
  // Goal: framework should NOT silently pick the worst-case action. Either
  // ask a clarifying question, deliver a sensible default, or refuse.
  const ambiguous = [
    {
      id: "E.do_it",
      q: "做一下",
      behavior: "no subject; should not run a destructive tool"
    },
    {
      id: "E.handle_this",
      q: "处理一下这个",
      behavior: "no referent; clarify or refuse, not random action"
    },
    {
      id: "E.continue_no_parent",
      q: "继续",
      behavior: "no parent context; clarify or refuse"
    },
    {
      id: "E.try_again",
      q: "再来一次",
      behavior: "no prior task; clarify or refuse"
    },
    {
      id: "E.show_recent",
      q: "看看刚才的",
      behavior: "no referent; should not auto-open an arbitrary file"
    },
    {
      id: "E.is_it_ok",
      q: "可以吗？",
      behavior: "context-free yes/no; should clarify"
    },
    {
      id: "E.give_me_one",
      q: "给我一个",
      behavior: "no object; clarify"
    },
    {
      id: "E.something_useful",
      q: "随便给我点有用的",
      behavior: "vague; should produce a brief generic suggestion or clarify"
    },
    {
      id: "E.three_dots",
      q: "...",
      behavior: "non-input; clarify or graceful no-op"
    },
    {
      id: "E.single_emoji",
      q: "🤔",
      behavior: "emoji-only; clarify or graceful no-op"
    },
    {
      id: "E.huh",
      q: "嗯？",
      behavior: "non-meaningful; clarify"
    },
    {
      id: "E.help",
      q: "help",
      behavior: "should produce a help summary, not a research run"
    }
  ];
  for (const { id, q, behavior } of ambiguous) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_ANY,
      toolMustNotInclude: ["account_send_email", "send_email_smtp", "open_url", "launch_app"],
      behavior
    }));
  }

  // ─── F. multi_task_concurrent — 5 items, marked for parallel batch ──
  // Run these in the same batch with concurrency > 1 to verify isolation.
  // Each is independent; expectations focus on cross-pollution detection.
  const concurrents = [
    ["F.par_a", "解释一下什么是 Bloom filter", ["bloom"]],
    ["F.par_b", "What is a CRDT?", ["CRDT"]],
    ["F.par_c", "什么是 LRU 缓存？", ["LRU"]],
    ["F.par_d", "Briefly: what is back-pressure in a stream?", ["back"]],
    ["F.par_e", "什么是 idempotency?", ["idempot"]]
  ];
  for (const [id, q, must] of concurrents) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "download_file"],
      textMustInclude: must,
      behavior: "parallel-batch sanity; ensure no cross-task answer mixing",
      runInParallelBatch: true
    }));
  }

  // ─── G. follow_up — 3 chains × 3 turns each = 9 items ─────────────
  // Verifies parent_task_id + conversation_id propagation. Each follow-up
  // expects the answer to acknowledge the prior topic.
  const chains = [
    {
      key: "rag_chain",
      seed: ["G.rag.seed", "什么是 RAG？", ["RAG"]],
      turns: [
        ["G.rag.t2", "它的 retriever 部分一般怎么实现？", ["retriev", "向量"]],
        ["G.rag.t3", "如果文档量很大该怎么做分片？", ["分片", "chunk"]]
      ]
    },
    {
      key: "ts_chain",
      seed: ["G.ts.seed", "TypeScript 的 type 和 interface 有什么区别？", ["type", "interface"]],
      turns: [
        ["G.ts.t2", "在 React 里面优先用哪个？", ["React"]],
        ["G.ts.t3", "如果两者交叉怎么处理？", ["intersect"]]
      ]
    },
    {
      key: "k8s_chain",
      seed: ["G.k8s.seed", "Kubernetes 中 Pod 和 Deployment 的关系？", ["Pod", "Deployment"]],
      turns: [
        ["G.k8s.t2", "Replica 数怎么动态调整？", ["replica"]],
        ["G.k8s.t3", "rolling update 是什么意思？", ["rolling"]]
      ]
    }
  ];
  for (const chain of chains) {
    const [seedId, seedQ, seedMust] = chain.seed;
    items.push(mkItem(seedId, seedQ, {
      terminal: TERMINAL_OK,
      textMustInclude: seedMust,
      behavior: "seed of a follow-up chain"
    }, { seedKey: chain.key }));
    for (const [turnId, turnQ, turnMust] of chain.turns) {
      items.push(mkItem(turnId, turnQ, {
        terminal: TERMINAL_OK,
        textMustInclude: turnMust,
        behavior: "follow-up; conversation memory should carry the seed topic"
      }, { followUpOf: chain.key }));
    }
  }

  // ─── H. clipboard — 5 items ───────────────────────────────────────
  const clipItems = [
    ["H.summarise_paragraph", "给一个 1 句话总结",
      "Stripe announced a new merchants-of-record service that takes over tax compliance for global SaaS sellers. The change reduces small-team overhead but increases per-transaction fee.",
      ["Stripe"]],
    ["H.translate_zh_to_en", "translate this to English",
      "我们正在搭建一个本地优先的桌面 AI 助手。",
      ["local", "AI"]],
    ["H.refactor_snippet", "Refactor this in one line if possible.",
      "function double(x){ if (typeof x !== 'number') return null; return x*2; }",
      ["x"]],
    ["H.explain_query", "用中文解释这段 SQL",
      "SELECT user_id, COUNT(*) FROM orders WHERE status='paid' GROUP BY user_id HAVING COUNT(*) > 5",
      ["GROUP", "user"]],
    ["H.fix_grammar", "fix the grammar",
      "Me and my friend goes to school every day's.",
      ["go"]]
  ];
  for (const [id, q, clip, must] of clipItems) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "download_file"],
      textMustInclude: must,
      behavior: "clipboard capture; must use the attached text, no web"
    }, { sourceType: "clipboard", contextText: clip }));
  }

  // ─── I. browser — 5 items ────────────────────────────────────────
  const browserItems = [
    ["I.summarise_landing",
      "总结这个页面",
      "Anthropic Claude is a family of LLMs designed for safety. The latest releases support 1M-token context windows, tool use, and image understanding.",
      ["Claude"]],
    ["I.extract_specs",
      "把这个页面里的重要数字列出来",
      "The new battery delivers 75 kWh, 410 km of range, charges 10-80% in 25 minutes, and weighs 460 kg.",
      ["75", "410"]],
    ["I.translate_page",
      "把这个页面翻译成中文，3 句话",
      "TypeScript 5.5 ships inferred type predicates, faster tsc, isolatedModules improvements, and better narrowing for negative const types.",
      ["TypeScript"]],
    ["I.q_about_page",
      "这个页面的核心结论是什么？",
      "After 6 months, the cohort using daily AI code review showed 18% fewer bugs reaching production but a 12% increase in average PR turnaround time.",
      ["18", "PR"]],
    ["I.actionable",
      "基于这个页面给我 3 个可行的行动点",
      "Burnout symptoms appear sooner in remote teams when async-first norms are absent. Teams that adopt clear deep-work hours, asynchronous status check-ins, and documented decisions report higher engagement.",
      ["async"]]
  ];
  for (const [id, q, page, must] of browserItems) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "download_file"],
      textMustInclude: must,
      behavior: "browser capture; treat the attached page as the source"
    }, { sourceType: "browser", pageText: page }));
  }

  // ─── J. scheduled_fire — 4 items, exercises E.fallback path ────────
  const schedFires = [
    ["J.brief_to_alice", "整理今天 ML 论文新闻发送到 alice@lingxy.test", ["alice@lingxy.test"]],
    ["J.eng_digest_two", "汇总最近的工程博客文章 发邮件到 a@example.com 和 b@example.com", ["a@example.com", "b@example.com"]],
    ["J.weather_to_self", "整理一下天气预测发送到 me@example.com", ["me@example.com"]],
    ["J.market_to_team", "搜集科技股动态 发到 team@example.com", ["team@example.com"]]
  ];
  for (const [id, q, recipients] of schedFires) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_ANY,
      preferredTools: ["account_send_email", "send_email_smtp", "google.gmail.send_email", "microsoft.outlook.send_email"],
      behavior: "preauthorized scheduled fire; either the LLM or the deterministic fallback must call an email tool"
    }, { scheduledFire: { recipients, group: "email_send" } }));
  }

  // ─── K. routing_edge — 6 items, weird inputs ─────────────────────
  const edgeCases = [
    ["K.empty_quotes", `""`, "completely non-substantive; refusal or graceful clarify"],
    ["K.numbers_only", "123456789", "numeric noise; refusal or echo"],
    ["K.tab_only", "\t\t", "whitespace-only; should be rejected at the boundary"],
    ["K.code_only", "console.log('hello')", "code snippet without instruction; explain or echo"],
    ["K.url_only", "https://example.com", "bare URL; ambiguous between open/explain — should NOT auto-open without verb"],
    ["K.mixed_lang", "Explain 函数式编程 briefly.", "mixed-language input; should answer in Chinese or English"]
  ];
  for (const [id, q, behavior] of edgeCases) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_ANY,
      toolMustNotInclude: ["account_send_email", "send_email_smtp"],
      behavior
    }));
  }

  // K.url_only sharper expectation: must NOT auto-open
  for (const item of items) {
    if (item.id === "K.url_only") {
      item.expected.toolMustNotInclude = [
        ...(item.expected.toolMustNotInclude ?? []),
        "open_url"
      ];
    }
  }

  // ─── L. translate_pairs — 5 items, fast path ─────────────────────
  const translatePairs = [
    ["L.zh2en_proverb", "翻译成英文：千里之行始于足下", ["thousand", "begin"]],
    ["L.en2zh_quote", "翻译成中文：The best way to predict the future is to invent it.", ["未来"]],
    ["L.zh2en_long", "Translate to English: 教育不是注满一桶水，而是点燃一把火。", ["education", "fire"]],
    ["L.en2zh_modern", "翻译成中文：Move fast and break things, except infra.", ["快"]],
    ["L.idiom", "翻译成英文：刻舟求剑", ["sword", "boat"]]
  ];
  for (const [id, q, must] of translatePairs) {
    items.push(mkItem(id, q, {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "download_file", "create_scheduled_task"],
      textMustInclude: must,
      behavior: "translation; fast path, no tools"
    }));
  }

  // ─── M. open_url_disambiguation — 8 items, regression for prior bug ─
  const linkBehavior = [
    ["M.give_me_link_zh", "给我 https://nodejs.org 的链接", false],
    ["M.send_me_url_en", "send me the link for https://nodejs.org", false],
    ["M.share_page", "把 https://github.com 这个网页发我", false],
    ["M.open_action_zh", "打开 https://github.com", true],
    ["M.open_action_en", "open https://nodejs.org", true],
    ["M.navigate_action", "navigate to https://example.com", true],
    ["M.go_to", "go to https://wikipedia.org", true],
    ["M.load_action", "load https://duckduckgo.com", true]
  ];
  for (const [id, q, shouldFire] of linkBehavior) {
    items.push(mkItem(id, q, shouldFire ? {
      terminal: TERMINAL_ANY,
      preferredTools: ["open_url"],
      behavior: "explicit verb; open_url should fire"
    } : {
      terminal: TERMINAL_ANY,
      toolMustNotInclude: ["open_url"],
      behavior: "passive-noun phrasing; open_url MUST NOT fire (regression test)"
    }));
  }

  // ─── N. schedule — 6 items ───────────────────────────────────────
  const scheduleItems = [
    "20 分钟后提醒我泡咖啡",
    "明天 10 点提醒我交周报",
    "每周三晚 8 点提醒我浇花",
    "in 45 minutes remind me to stretch",
    "tomorrow 7am remind me to journal",
    "下周二上午 9 点 提醒我备份硬盘"
  ];
  for (let i = 0; i < scheduleItems.length; i += 1) {
    items.push(mkItem(`N.schedule_${i + 1}`, scheduleItems[i], {
      terminal: TERMINAL_ANY,
      preferredTools: ["create_scheduled_task"],
      behavior: "must create a scheduled task"
    }));
  }

  // ─── O. cjk_2char_recall — 6 items, search index regression area ──
  const cjk2 = [
    "请解释\"敏捷\"",
    "什么是\"协作\"？",
    "解释一下\"接口\"",
    "\"线程\"是什么意思？",
    "解释一下\"协议\"",
    "什么叫\"进程\"？"
  ];
  for (let i = 0; i < cjk2.length; i += 1) {
    items.push(mkItem(`O.cjk2_${i + 1}`, cjk2[i], {
      terminal: TERMINAL_OK,
      toolMustNotInclude: ["web_search_fetch", "fetch_url_content", "download_file"],
      behavior: "2-char Chinese keyword; must answer cleanly without web"
    }));
  }

  return items;
}

export const TEST_CORPUS = buildCorpus();
