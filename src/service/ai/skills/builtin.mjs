export const BUILTIN_SKILL_REGISTRIES = Object.freeze([
  {
    id: "local-codex-skills",
    rootPath: "%CODEX_HOME%/skills",
    async listSkills() {
      return [];
    }
  }
]);
