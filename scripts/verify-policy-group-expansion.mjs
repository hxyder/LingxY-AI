#!/usr/bin/env node
/**
 * UCA-077 P4-00 (Issue β / RR-03): policy-group expansion regression.
 *
 * Asserts:
 *   1. `buildExternalWebReadPolicy` emits both the canonical
 *      `policy_groups.external_web_read` entry AND a per-toolId entry for
 *      every member (back-compat surface).
 *   2. `resolveToolPolicy` output covers every group member when forbidden,
 *      optional, or required — i.e. the LLM cannot bypass a `forbidden`
 *      decision by switching to a synonymous tool.
 *   3. The connector-domain branch in createTaskSpec uses the same expansion
 *      (it previously hand-built `{ web_search_fetch: forbidden }` only).
 *   4. Registry policy guard blocks group-member tools when ONLY the
 *      group-level `policy_groups.<group>` entry is set (defense in depth).
 *   5. Registry policy guard does NOT block tools that are not in the group.
 *   6. Audit entries written for group-level blocks carry
 *      `policy_source = "group:<group>"` so an admin can distinguish a
 *      direct-toolId block from a group-membership block.
 *
 * Run: node scripts/verify-policy-group-expansion.mjs
 */

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import {
  POLICY_GROUPS,
  toolsInGroup,
  groupsOfTool,
  renderToolPolicyForPrompt
} from "../src/service/core/policy/policy-groups.mjs";
import {
  resolveToolPolicy,
  buildExternalWebReadPolicy
} from "../src/service/core/policy/tool-policy-resolver.mjs";
import { createTaskSpec } from "../src/service/core/task-spec.mjs";
import { createActionToolRegistry } from "../src/service/capabilities/registry/registry.mjs";

let pass = 0;
let fail = 0;
function it(label, fn) {
  try {
    fn();
    process.stdout.write(`PASS  ${label}\n`);
    pass += 1;
  } catch (err) {
    process.stdout.write(`FAIL  ${label}\n  ${err.message}\n`);
    if (err.stack) process.stdout.write(`  ${err.stack.split("\n").slice(1, 3).join("\n  ")}\n`);
    fail += 1;
  }
}

function makeFakeRuntime() {
  const auditEntries = [];
  return {
    auditEntries,
    perTaskToolCallCounts: new Map(),
    store: {
      appendAuditLog(entry) { auditEntries.push(entry); return entry; }
    }
  };
}

function makeFakeWebTool(id) {
  let calls = 0;
  return {
    id,
    name: id,
    description: "fake",
    parameters: {},
    risk_level: "low",
    required_capabilities: [],
    policy_group: "external_web_read",
    execute() { calls += 1; return { success: true, observation: `${id} ok`, artifact_paths: [], error: null, metadata: {} }; },
    get callCount() { return calls; }
  };
}

async function run() {
  // ── 1. buildExternalWebReadPolicy shape ────────────────────────────────
  await (async () => {
    const policy = buildExternalWebReadPolicy(
      "forbidden",
      "test forbidden",
      [{ type: "test", source: "unit", reason: "manual" }]
    );

    it("expand: emits policy_groups.external_web_read entry", () => {
      assert.ok(policy.policy_groups);
      assert.equal(policy.policy_groups.external_web_read.mode, "forbidden");
      assert.equal(policy.policy_groups.external_web_read.reason, "test forbidden");
    });
    it("expand: emits a per-toolId entry for every group member", () => {
      for (const toolId of toolsInGroup("external_web_read")) {
        assert.ok(policy[toolId], `missing tool entry: ${toolId}`);
        assert.equal(policy[toolId].mode, "forbidden");
        assert.equal(policy[toolId].policy_group, "external_web_read");
      }
    });
    it("expand: per-toolId entries are independent objects (mutating one does not bleed)", () => {
      policy.web_search_fetch.mode = "optional";
      assert.equal(policy.web_search.mode, "forbidden");
      assert.equal(policy.policy_groups.external_web_read.mode, "forbidden");
    });
    it("expand: tagged with policy_group so consumers can group-render", () => {
      const fresh = buildExternalWebReadPolicy("required", "explicit external", []);
      assert.equal(fresh.web_search_fetch.policy_group, "external_web_read");
      assert.equal(fresh.fetch_url_content.policy_group, "external_web_read");
    });
  })();

  // ── 2. resolveToolPolicy output covers every group member ──────────────
  await (async () => {
    const cases = [
      { label: "forbidden chitchat", text: "你好", scope: "none", expectedMode: "forbidden" },
      { label: "required explicit external", text: "查一下网上最近的开源项目", scope: "none", expectedMode: "required" },
      { label: "forbidden local code", text: "分析下面代码", scope: "current_context", expectedMode: "forbidden" }
    ];
    for (const { label, text, expectedMode } of cases) {
      const spec = createTaskSpec(text, {}, {});
      const members = toolsInGroup("external_web_read");
      it(`resolver/${label}: every member of external_web_read shares mode=${expectedMode}`, () => {
        for (const toolId of members) {
          const got = spec.tool_policy?.[toolId]?.mode;
          assert.equal(got, expectedMode, `${toolId} got ${got}, expected ${expectedMode}`);
        }
        assert.equal(spec.tool_policy?.policy_groups?.external_web_read?.mode, expectedMode);
      });
    }
  })();

  // ── 3. connector-domain branch uses the same expansion ─────────────────
  await (async () => {
    // "查一下我最近的邮件" hits isConnectorDomainRequest (mail). Connector
    // capability requests keep open-web optional unless IntentRoute makes it
    // required, but the branch still MUST emit the full group expansion so
    // every external_web_read member shares the same mode.
    const spec = createTaskSpec("查一下我最近的邮件", {}, {});
    it("connector-domain: optional expanded across every group member", () => {
      for (const toolId of toolsInGroup("external_web_read")) {
        assert.equal(
          spec.tool_policy?.[toolId]?.mode,
          "optional",
          `${toolId} not optional in connector-domain branch`
        );
      }
      assert.equal(
        spec.tool_policy?.policy_groups?.external_web_read?.mode,
        "optional"
      );
    });
    it("connector-domain: reason mentions connector tools (not lost in expansion)", () => {
      assert.match(
        spec.tool_policy?.web_search_fetch?.reason ?? "",
        /Connector capability/i
      );
    });
  })();

  // ── 4. guard blocks group members via group-level entry only ───────────
  await (async () => {
    const tools = ["web_search", "web_search_fetch", "fetch_url_content"].map(makeFakeWebTool);
    const registry = createActionToolRegistry(tools);
    const runtime = makeFakeRuntime();
    const task = {
      task_id: "task_group_only",
      task_spec: {
        // Note: NO per-toolId entries. Only the group-level entry. This is
        // exactly the shape a future SemanticRouter or hand-rolled policy
        // could produce — the guard MUST still block via membership lookup.
        tool_policy: {
          policy_groups: {
            external_web_read: {
              mode: "forbidden",
              reason: "Defense-in-depth check: group only",
              evidence: []
            }
          }
        }
      }
    };

    for (const tool of tools) {
      const r = await registry.call(tool.id, { query: "x" }, { runtime, task });
      it(`guard/group-only: blocks ${tool.id}`, () => {
        assert.equal(r.success, false);
        assert.equal(r.error, "blocked_by_policy");
        assert.equal(tool.callCount, 0);
        assert.equal(r.metadata.policy_source, "group:external_web_read");
      });
    }
    it("guard/group-only: audit entries tagged with policy_source", () => {
      const blocks = runtime.auditEntries.filter((e) => e.event_subtype === "tool.blocked_by_policy");
      assert.equal(blocks.length, tools.length);
      for (const entry of blocks) {
        assert.equal(entry.payload.policy_source, "group:external_web_read");
      }
    });
  })();

  // ── 5. guard does NOT block tools outside the group ────────────────────
  await (async () => {
    const writeFile = {
      id: "write_file",
      name: "write_file",
      description: "fake",
      parameters: {},
      risk_level: "low",
      required_capabilities: [],
      called: 0,
      execute() { this.called += 1; return { success: true, observation: "ok", artifact_paths: [], error: null, metadata: {} }; }
    };
    const registry = createActionToolRegistry([writeFile]);
    const runtime = makeFakeRuntime();
    const task = {
      task_id: "task_outside_group",
      task_spec: {
        tool_policy: {
          policy_groups: {
            external_web_read: { mode: "forbidden", reason: "x", evidence: [] }
          }
        }
      }
    };
    const r = await registry.call("write_file", { path: "x.txt" }, { runtime, task });
    it("guard/outside-group: write_file not blocked by external_web_read forbidden", () => {
      assert.equal(r.success, true);
      assert.equal(writeFile.called, 1);
    });
  })();

  // ── 6. groupsOfTool / toolsInGroup consistency ─────────────────────────
  await (async () => {
    it("metadata: every group member round-trips through groupsOfTool", () => {
      for (const [group, members] of Object.entries(POLICY_GROUPS)) {
        for (const toolId of members) {
          assert.ok(
            groupsOfTool(toolId).includes(group),
            `${toolId} should report membership in ${group}`
          );
        }
      }
    });
    it("metadata: toolsInGroup returns empty for unknown group", () => {
      assert.deepEqual(toolsInGroup("does_not_exist"), []);
    });
    it("metadata: groupsOfTool returns empty array for ungrouped tool", () => {
      // B2-a (b): write_file moved INTO the artifact_generation policy
      // group as part of the no-side-effect artifact-recovery floor.
      // Use take_screenshot (true ungrouped) as the negative example.
      assert.deepEqual(groupsOfTool("take_screenshot"), []);
    });
  })();

  // ── renderToolPolicyForPrompt: shared between agentic + tool_using ────
  await (async () => {
    const policy = buildExternalWebReadPolicy("required", "User explicitly asked.", []);
    const lines = renderToolPolicyForPrompt(policy);
    it("render: group entry comes first with `(any of: ...)`", () => {
      assert.ok(lines[0].startsWith("external_web_read: required"));
      assert.match(lines[0], /\(any of: web_search, web_search_fetch, fetch_url_content\)/);
    });
    it("render: reason is the next pre-indented line", () => {
      assert.equal(lines[1], "  reason: User explicitly asked.");
    });
    it("render: per-toolId entries do NOT duplicate the group decision", () => {
      // After the group block, only entries WITHOUT a covered policy_group
      // should remain. Our resolver tags each per-toolId entry with
      // policy_group=external_web_read, so none of them should re-appear.
      const remainder = lines.slice(2);
      for (const member of toolsInGroup("external_web_read")) {
        assert.ok(!remainder.some((line) => line.startsWith(`${member}:`)),
          `member ${member} should not be re-rendered after the group entry`);
      }
    });
    it("render: empty / null input → []", () => {
      assert.deepEqual(renderToolPolicyForPrompt(null), []);
      assert.deepEqual(renderToolPolicyForPrompt(undefined), []);
      assert.deepEqual(renderToolPolicyForPrompt({}), []);
    });
    it("render: standalone per-toolId entry (no group) renders as itself", () => {
      const lonePolicy = {
        edit_file: { mode: "forbidden", reason: "Read-only task" }
      };
      const out = renderToolPolicyForPrompt(lonePolicy);
      assert.deepEqual(out, ["edit_file: forbidden", "  reason: Read-only task"]);
    });
  })();

  // ── tool_using/agent-loop is wired to the shared helper ───────────────
  await (async () => {
    const src = readFileSync("src/service/executors/tool_using/agent-loop.mjs", "utf8");
    it("agent-loop: imports renderToolPolicyForPrompt from policy-groups", () => {
      assert.match(src, /import\s+\{[^}]*renderToolPolicyForPrompt[^}]*\}\s+from\s+"\.\.\/\.\.\/core\/policy\/policy-groups\.mjs"/);
    });
    it("agent-loop: no longer reads tool_policy.web_search_fetch directly for prompt rendering", () => {
      // The helper is the single rendering point. A regression where someone
      // re-introduces `tool_policy?.web_search_fetch` for prompt purposes
      // would defeat group semantics on the tool_using path. The two
      // remaining references are: the executor decision branch (line ~48,
      // `mode === "required"` early return — pre-execution gate) and the
      // success-contract / forbidden checks elsewhere — those are NOT
      // prompt-rendering and are allowed.
      const promptPolicyHack = src.match(/const\s+webPolicy\s*=\s*task\.task_spec\?\.tool_policy\?\.web_search_fetch/g);
      assert.equal(promptPolicyHack, null,
        "agent-loop must not extract webPolicy for prompt rendering — use renderToolPolicyForPrompt");
    });
    it("agent-loop: search guidance reads the external_web_read group", () => {
      assert.match(src, /Use search by judgment[\s\S]*external_web_read/);
    });
  })();

  // ── 7. direct-toolId entry still works alongside group-level ───────────
  await (async () => {
    const tool = makeFakeWebTool("web_search_fetch");
    const registry = createActionToolRegistry([tool]);
    const runtime = makeFakeRuntime();
    const task = {
      task_id: "task_direct",
      task_spec: {
        tool_policy: {
          web_search_fetch: { mode: "forbidden", reason: "direct entry", evidence: [] }
        }
      }
    };
    const r = await registry.call("web_search_fetch", { query: "x" }, { runtime, task });
    it("guard/direct: tool-level forbidden takes precedence and tags policy_source=tool", () => {
      assert.equal(r.success, false);
      assert.equal(r.error, "blocked_by_policy");
      assert.equal(r.metadata.policy_source, "tool");
    });
  })();

  process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
  if (fail > 0) process.exit(1);
}

await run();
