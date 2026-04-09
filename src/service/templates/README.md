# Templates

Phase 6 template schema, parser, builtin templates, and user template persistence live here.

Current runtime behavior:

- builtins are read-only and always shipped in-repo
- user templates are stored under the runtime `data/templates/` directory
- import / export stays JSON-first so the console and CLI can share one contract
