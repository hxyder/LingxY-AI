# Code CLI Adapters

Place code CLI integration adapters here, for example:

- Kimi Code CLI
- Codex CLI
- other task-oriented local CLIs

Adapters should implement the shared contracts in `src/shared/contracts/code-cli.ts`.

User adapters are loaded from `ai.codeCli.adapters`, `ai.customProviders` entries with `kind: "code_cli"`, JSON declarations in `data/integrations/code_cli`, or `POST /config/code-cli/adapters`.

For `stream_json_print` adapters, the agentic bridge passes `--print`, stream JSON flags, model, optional `--config-file`, and any configured `--mcp-config-file` values unless those flags are already encoded in `args`.
