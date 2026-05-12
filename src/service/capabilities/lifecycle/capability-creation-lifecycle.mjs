import {
  validateSubPath,
  validateBranchName,
  validateGitHubSkillUrl
} from "../skills/github-install.mjs";
import { buildMarketplaceTrustPreview } from "../marketplace/trust-model.mjs";

export const CAPABILITY_CREATION_LIFECYCLE_SCHEMA_VERSION = "capability-creation-lifecycle.v1";

export const CAPABILITY_CREATION_STAGES = Object.freeze([
  "template",
  "dry_run_validation",
  "install_preview",
  "user_approval",
  "activation",
  "archive_recovery"
]);

export const CAPABILITY_CREATION_FAMILIES = Object.freeze([
  {
    id: "skill",
    owner: "src/service/capabilities/skills",
    routes: Object.freeze({
      template: "/skills/create",
      dryRunValidation: "/skills/test",
      installPreview: "/skills/install/github/preview",
      install: "/skills/install/github",
      activation: "/config/skills/state",
      archiveRecovery: "/skills/delete /skills/rollback"
    })
  },
  {
    id: "mcp_server",
    owner: "src/service/capabilities/mcp",
    routes: Object.freeze({
      template: "/config/mcp/drafts",
      dryRunValidation: "/config/mcp/test",
      installPreview: "/config/mcp/install/preview",
      install: "/config/mcp/install/run",
      activation: "/ai/mcp/:id/toggle",
      archiveRecovery: "/config/mcp/drafts/import /config/mcp/servers/:id"
    })
  },
  {
    id: "connector_plugin",
    owner: "src/service/capabilities/connectors/core/plugin-registry.mjs",
    routes: Object.freeze({
      template: "plugin.json",
      dryRunValidation: "/plugins/install/preview",
      installPreview: "/plugins/install/preview",
      install: "/plugins/install",
      activation: "/plugins/:id/enabled",
      archiveRecovery: "/plugins/:id"
    })
  }
]);

function asString(value, fallback = "") {
  const text = `${value ?? ""}`.trim();
  return text || fallback;
}

function sourceRefFromGithubValidation(validation, branch = null, subPath = null) {
  if (!validation?.ok) return null;
  const ref = branch ?? validation.fragmentBranch ?? "default";
  const suffix = subPath ? `/${subPath}` : "";
  return `github:${validation.owner}/${validation.repo}#${ref}${suffix}`;
}

export function buildCapabilityCreationLifecycleCatalog() {
  return {
    schemaVersion: CAPABILITY_CREATION_LIFECYCLE_SCHEMA_VERSION,
    stages: [...CAPABILITY_CREATION_STAGES],
    families: CAPABILITY_CREATION_FAMILIES.map((family) => ({
      id: family.id,
      owner: family.owner,
      routes: { ...family.routes },
      requiresPreviewBeforeInstall: true,
      requiresExplicitActivation: true,
      archiveRecoverable: true
    }))
  };
}

export function previewGitHubSkillInstall({ url = "", branch = null } = {}) {
  const urlValidation = validateGitHubSkillUrl(url);
  const branchValidation = validateBranchName(branch ?? urlValidation.fragmentBranch ?? null);
  const subPathValidation = validateSubPath(urlValidation.ok ? urlValidation.subPath : null);
  const errors = [];
  if (!urlValidation.ok) {
    errors.push({
      field: "url",
      code: urlValidation.reason ?? "invalid_url",
      message: urlValidation.message ?? "GitHub skill URL is invalid."
    });
  }
  if (!branchValidation.ok) {
    errors.push({
      field: "branch",
      code: branchValidation.reason ?? "invalid_branch",
      message: branchValidation.message ?? "GitHub branch is invalid."
    });
  }
  if (!subPathValidation.ok) {
    errors.push({
      field: "subPath",
      code: subPathValidation.reason ?? "invalid_subpath",
      message: subPathValidation.message ?? "GitHub skill path is invalid."
    });
  }

  const ok = errors.length === 0;
  const sourceRef = ok ? sourceRefFromGithubValidation(urlValidation, branchValidation.branch, subPathValidation.subPath) : null;
  const entry = {
    id: sourceRef ?? asString(url, "github_skill"),
    displayName: ok
      ? `${urlValidation.owner}/${urlValidation.repo}${subPathValidation.subPath ? `/${subPathValidation.subPath}` : ""}`
      : "GitHub Skill",
    description: "Third-party skill source. Preview validates URL shape only; install clones and validates SKILL.md before registering.",
    source: "github_install",
    enabled: false,
    shareable: false
  };

  return {
    schemaVersion: CAPABILITY_CREATION_LIFECYCLE_SCHEMA_VERSION,
    ok,
    family: "skill",
    stage: "install_preview",
    source: {
      type: "github",
      sourceRef,
      owner: ok ? urlValidation.owner : null,
      repo: ok ? urlValidation.repo : null,
      branch: ok ? branchValidation.branch ?? urlValidation.fragmentBranch ?? null : null,
      subPath: ok ? subPathValidation.subPath ?? null : null
    },
    policyImpact: {
      trust: "third_party_prompt_surface",
      writesFiles: true,
      executesCode: false,
      requiresDesktopActor: true,
      requiresUserApproval: true,
      activatesAfterInstall: true
    },
    trustPreview: buildMarketplaceTrustPreview(entry, { kind: "skill" }),
    errors
  };
}
