# Code CLI Adapters

Place code CLI integration adapters here, for example:

- Kimi Code CLI
- Codex CLI
- other task-oriented local CLIs

Adapters should implement the shared contracts in `src/shared/contracts/code-cli.ts`.

User adapters are loaded from `ai.codeCli.adapters`, `ai.customProviders` entries with `kind: "code_cli"`, JSON declarations in `data/integrations/code_cli`, or `POST /config/code-cli/adapters`.

For `stream_json_print` adapters, the agentic bridge passes print/JSONL flags and model unless those flags are already encoded in `args`.

CLI-family-specific flags are intentionally split:

- Kimi gets `--print --output-format stream-json --input-format text`, `-w`, `--config-file`, and `--mcp-config-file`.
- Claude Code gets `--print --output-format stream-json --input-format text`, process `cwd`, `--settings`, and `--mcp-config`.
- Codex gets `exec --json`, `-C`, `--add-dir`, and `-c model_reasoning_effort="..."`.
