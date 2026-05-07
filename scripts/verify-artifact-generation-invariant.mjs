#!/usr/bin/env node
/**
 * verify-artifact-generation-invariant.mjs — B2-a (b) safety floor
 *
 * Plan (UPGRADE_PLAN.md §B2-a (b)):
 *
 *   "artifact 场景的 deterministic recovery 只能走无副作用、可本地闭环的
 *    路径（generate_document / write_file / render_diagram / render_svg），
 *    绝不可 fallback 到 email_send / open_url / connector_workflow_run
 *    这类对外副作用通道."
 *
 * The full deterministic-recovery hook is post-launch C-class work (the
 * actual call site that injects generate_document into a stuck task);
 * this verifier locks the *contract* it must obey. If anyone later adds
 * a side-effect tool to the artifact_generation group, the recovery
 * door opens to outbound traffic — this test catches that the moment
 * someone tries.
 *
 * Constitution:
 *   - 不打补丁: the rule is at the policy-group layer, not the
 *     recovery hook. Future recovery hooks can change without
 *     re-litigating the safety contract.
 *   - 不针对特定提问: the verifier checks the GROUP, not any single
 *     tool — adding new tools to the group is fine, adding *any*
 *     side-effect tool is not.
 */

import assert from "node:assert/strict";
import {
  POLICY_GROUPS,
  toolsInGroup
} from "../src/service/core/policy/policy-groups.mjs";

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${label}`);
    failed += 1;
  }
}

// ----------------------------------------------------------------------
// 1. artifact_generation group exists.
// ----------------------------------------------------------------------
{
  check(
    "POLICY_GROUPS.artifact_generation exists",
    Array.isArray(POLICY_GROUPS.artifact_generation)
      && POLICY_GROUPS.artifact_generation.length > 0
  );
}

// ----------------------------------------------------------------------
// 2. The expected core members are present.
// ----------------------------------------------------------------------
{
  const members = toolsInGroup("artifact_generation");
  for (const expected of [
    "generate_document",
    "write_file",
    "edit_file",
    "render_diagram",
    "render_svg"
  ]) {
    check(
      `core member: artifact_generation includes ${expected}`,
      members.includes(expected)
    );
  }
}

// ----------------------------------------------------------------------
// 3. INVARIANT: no outbound side-effect tools may live in this group.
//    Cross-check against every other policy group's side-effect membership.
// ----------------------------------------------------------------------
const FORBIDDEN_SIDE_EFFECT_TOOLS = [
  // email_send group
  "account_send_email",
  "send_email_smtp",
  "connector_workflow_run",
  "google.gmail.send_email",
  "microsoft.outlook.send_email",
  // calendar_create group
  "account_create_event",
  "google.calendar.create_event",
  "microsoft.calendar.create_event",
  // file_upload group
  "account_upload_file",
  "google.drive.upload_file",
  "microsoft.onedrive.upload_file",
  // schedule_create group
  "create_scheduled_task",
  // browser navigate
  "open_url"
];

{
  const members = toolsInGroup("artifact_generation");
  for (const forbidden of FORBIDDEN_SIDE_EFFECT_TOOLS) {
    check(
      `INVARIANT: artifact_generation does NOT contain side-effect tool '${forbidden}'`,
      !members.includes(forbidden)
    );
  }
}

// ----------------------------------------------------------------------
// 4. INVARIANT: every member of artifact_generation must be a
//    no-side-effect, locally-closed-loop tool. We check this by
//    asserting NONE of them are members of any side-effect-bearing
//    policy group.
// ----------------------------------------------------------------------
const SIDE_EFFECT_GROUPS = [
  "email_send",
  "calendar_create",
  "file_upload",
  "schedule_create"
];

{
  const members = toolsInGroup("artifact_generation");
  for (const tool of members) {
    for (const sideGroup of SIDE_EFFECT_GROUPS) {
      check(
        `INVARIANT: ${tool} is not a member of side-effect group ${sideGroup}`,
        !toolsInGroup(sideGroup).includes(tool)
      );
    }
  }
}

// ----------------------------------------------------------------------
// 5. Group is frozen so accidental at-runtime mutation is blocked.
// ----------------------------------------------------------------------
{
  check(
    "artifact_generation array is frozen (Object.isFrozen)",
    Object.isFrozen(POLICY_GROUPS.artifact_generation)
  );
}

console.log(`\n${passed} pass / ${failed} fail`);
if (failed > 0) process.exit(1);
