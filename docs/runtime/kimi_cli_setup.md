# Kimi CLI Setup

## Required

- A local `kimi` executable
- UTF-8 stdio support
- A logged-in Kimi CLI session or equivalent credential state

## Expected Contract

- LingxY resolves Kimi from this precedence order:
  - injected runtime in code
  - `config.runtime.json` under `ai.codeCli.kimi`
  - env vars such as `UCA_KIMI_COMMAND`
  - `kimi` found on `PATH`
- For mock and fixture execution, LingxY still supports the legacy JSONL task-package mode.
- For the real Kimi CLI, LingxY uses print mode with `--output-format stream-json`, scopes the workspace to the selected files, captures the final markdown reply, and writes `report.md` into the task output directory.

## Supported Configuration

- `UCA_KIMI_COMMAND`: override executable path
- `UCA_KIMI_ARGS_JSON`: JSON array of extra base args
- `UCA_KIMI_MODEL`: default model name
- `UCA_KIMI_MAX_RUNTIME_SECONDS`: override runtime limit
- `UCA_KIMI_CONFIG_FILE`: explicit Kimi config file
- `UCA_KIMI_MCP_CONFIG_FILES`: path-delimited list of MCP config files

Runtime config file also supports:

- `ai.codeCli.kimi.command`
- `ai.codeCli.kimi.args`
- `ai.codeCli.kimi.env`
- `ai.codeCli.kimi.model`
- `ai.codeCli.kimi.maxRuntimeSeconds`
- `ai.codeCli.kimi.configFile`
- `ai.codeCli.kimi.mcpConfigFiles`

Generic code CLI providers can also receive MCP config files through `ai.customProviders[*].mcpConfigFiles` or `ai.codeCli.adapters[*].mcpConfigFiles`; see [AI integrations](ai_integrations.md).

## Verification

- `npm run verify:file-kimi` exercises the mock JSONL bridge.
- `npm run verify:kimi-runtime` exercises the real CLI when `kimi` is installed and already configured locally; otherwise it skips cleanly.
