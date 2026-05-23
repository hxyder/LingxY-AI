# Signal Design Discipline

Signals carry evidence, not final routing decisions. Before adding or changing a
signal, classify it on one axis:

- Provenance: what input or evidence exists, such as files, images, selected
  text, browser context, or local project references. Example: `source_scope`.
- Constraint: what the user explicitly forbids or requires. Examples:
  `explicit_no_search`, `local_only_constraint`.
- Capability / information need: what tools or information may be needed.
  Examples: `explicit_search`, `explicit_external`, `explicit_single_url`,
  `semantic_router`.

Do not mix axes in `Signal.kind`. `kind` stays epistemic: `fact`, `hint`, or
`assumption`. Local input is evidence, not a local-only policy by itself; a
local-only policy requires an explicit constraint or an SR/planner judgement.
