function skillEntryPath(skill = {}) {
  return skill.entryPath ?? skill.filePath ?? skill.path ?? "";
}

function skillRegistryId(skill = {}) {
  return skill.registry ?? skill.registryId ?? skill.tags?.[0] ?? "";
}

function sourceBadgeForSkill(entry = {}) {
  const source = entry.registrySource ?? entry.source ?? "";
  if (entry.thirdParty || source === "github_install") {
    return { label: "GitHub", tooltip: "Installed from GitHub" };
  }
  if (source === "builtin") {
    return { label: "Built-in", tooltip: "Bundled registry" };
  }
  if (!source || source === "runtime_config") {
    return { label: "Custom", tooltip: "User-added local skill source" };
  }
  return { label: source, tooltip: source };
}

export function getSkillStatusView(skill = {}) {
  const errors = Array.isArray(skill.errors) ? skill.errors : [];
  const active = skill.active !== false;
  const inactiveLabel = skill.inactiveReason === "duplicate_skill_id"
    ? "duplicate stopped"
    : skill.inactiveReason === "disabled_by_user"
      ? "stopped"
      : "inactive";
  if (skill.valid === false || errors.length > 0) {
    return {
      chip: "danger",
      label: `${errors.length || 1} issue${errors.length === 1 ? "" : "s"}`
    };
  }
  if (!active) return { chip: "muted", label: inactiveLabel };
  if (skill.valid === true) return { chip: "ready", label: "valid" };
  return { chip: "muted", label: "skill" };
}

function renderSkillSourceBadge(entry, { escapeHtml }) {
  const badge = sourceBadgeForSkill(entry);
  return `<span class="pill pill-neutral skill-source-badge" title="${escapeHtml(badge.tooltip)}">${escapeHtml(badge.label)}</span>`;
}

function renderSkillMoreActions(actions = []) {
  if (!actions.length) return "";
  return `
    <details class="skill-more-actions" data-skill-actions-more>
      <summary class="btn btn-sm btn-ghost">More</summary>
      <div class="skill-more-menu">
        ${actions.join("")}
      </div>
    </details>
  `;
}

function renderSkillRegistryCard(registry, { escapeHtml }) {
  const title = registry.displayName ?? registry.id ?? "Skill registry";
  const path = registry.rootPath ?? "n/a";
  const id = registry.id ?? "";
  const status = registry.available
    ? { chip: "ready", label: "ready" }
    : { chip: "warning", label: "unavailable" };
  return `
    <div class="skill-card skill-card--registry">
      <div class="skill-card-head">
        <div class="skill-card-icon">R</div>
        <div class="skill-card-info">
          <div class="skill-title-row">
            <strong class="skill-card-title">${escapeHtml(title)}</strong>
            ${renderSkillSourceBadge(registry, { escapeHtml })}
          </div>
          <div class="skill-card-meta">${escapeHtml(path)} &middot; ${escapeHtml(registry.skillCount ?? 0)} skills</div>
        </div>
        <span class="chip ${status.chip}">${escapeHtml(status.label)}</span>
      </div>
      <div class="skill-card-actions">
        <button class="btn btn-sm btn-danger" data-skill-registry-delete="${escapeHtml(id)}" type="button">Delete</button>
      </div>
    </div>
  `;
}

function renderSkillCard(skill, { escapeHtml }) {
  const entryPath = skillEntryPath(skill);
  const errors = Array.isArray(skill.errors) ? skill.errors : [];
  const active = skill.active !== false;
  const status = getSkillStatusView(skill);
  const toggleEnabled = !active;
  const registry = skillRegistryId(skill);
  const skillId = skill.id ?? "";
  const title = skill.displayName ?? skill.name ?? skill.id ?? "Unnamed skill";
  const metaParts = [
    registry || "local",
    skill.id,
    entryPath || "n/a"
  ].filter(Boolean);
  const primaryActions = [];
  const moreActions = [];
  if (entryPath) {
    primaryActions.push(`<button class="btn btn-sm" data-skill-edit="${escapeHtml(entryPath)}" type="button">Edit</button>`);
    if (registry && skillId) {
      primaryActions.push(`<button class="btn btn-sm btn-ghost" data-skill-state-registry="${escapeHtml(registry)}" data-skill-state-id="${escapeHtml(skillId)}" data-skill-state-enabled="${toggleEnabled ? "true" : "false"}" type="button">${toggleEnabled ? "Use this" : "Stop"}</button>`);
    }
    moreActions.push(`<button class="btn btn-sm btn-ghost" data-skill-duplicate="${escapeHtml(entryPath)}" type="button">Duplicate</button>`);
    moreActions.push(`<button class="btn btn-sm btn-ghost" data-skill-open="${escapeHtml(entryPath)}" type="button">Open</button>`);
    moreActions.push(`<button class="btn btn-sm btn-ghost" data-skill-reveal="${escapeHtml(entryPath)}" type="button">Reveal</button>`);
    moreActions.push(`<button class="btn btn-sm btn-danger" data-skill-delete="${escapeHtml(entryPath)}" type="button">Delete</button>`);
  }
  return `
    <div class="skill-card">
      <div class="skill-card-head">
        <div class="skill-card-icon">S</div>
        <div class="skill-card-info">
          <div class="skill-title-row">
            <strong class="skill-card-title">${escapeHtml(title)}</strong>
            ${renderSkillSourceBadge(skill, { escapeHtml })}
          </div>
          <div class="skill-card-meta">${metaParts.map((part) => escapeHtml(part)).join(" &middot; ")}</div>
        </div>
        <span class="chip ${status.chip}">${escapeHtml(status.label)}</span>
      </div>
      ${!active && skill.duplicateOf ? `
        <p class="skill-card-note">Stopped because ${escapeHtml(skill.duplicateOf.displayName ?? skill.duplicateOf.id ?? "another skill")} is active for the same id.</p>
      ` : ""}
      ${skill.description ? `<p class="skill-card-desc">${escapeHtml(skill.description)}</p>` : ""}
      ${errors.length ? `
        <div class="skill-card-issues">
          ${errors.slice(0, 3).map((error) => `<div>${escapeHtml(error.field ?? "skill")}: ${escapeHtml(error.message ?? error)}</div>`).join("")}
          ${errors.length > 3 ? `<div>+${errors.length - 3} more issue${errors.length - 3 === 1 ? "" : "s"}</div>` : ""}
        </div>` : ""}
      ${primaryActions.length || moreActions.length ? `
        <div class="skill-card-actions">
          ${primaryActions.join("")}
          <div class="skill-card-action-spacer"></div>
          ${renderSkillMoreActions(moreActions)}
        </div>` : ""}
    </div>
  `;
}

export function renderSkillManagementHtml(registries = [], skills = [], { escapeHtml }) {
  return [
    ...(registries ?? []).map((registry) => renderSkillRegistryCard(registry, { escapeHtml })),
    ...(skills ?? []).map((skill) => renderSkillCard(skill, { escapeHtml }))
  ].join("");
}
