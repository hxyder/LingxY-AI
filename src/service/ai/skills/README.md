# Skills Integration

Skill registries are intentionally separate from MCP because skills and MCP resources evolve independently.

UCA discovers skills from:

- `%CODEX_HOME%/skills`
- the runtime `data/integrations/skills` directory
- `ai.skills.registries` in runtime config
- JSON declarations in `data/integrations/skills/*.json`
- the HTTP endpoints under `/config/skills/registries`

A skill directory is any directory containing `SKILL.md`. The agentic planner renders discovered skill descriptors into the shared system prompt, so API model providers and code CLI providers see the same skill catalogue.
