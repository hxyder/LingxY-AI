# Intent / Router Archive

**Purpose**: staging area for regex-heavy intent classifiers and router rules
that have been retired as the TaskPlan understanding layer takes over the
decisions they used to make.

Every entry below records:
- the file / function that was retired
- *why* it's retired (what failure mode it produced)
- *what replaced it* (so future maintainers can trace the migration)
- the commit that moved it here

Code kept here is **frozen reference**, not live. Nothing in this directory is
imported by the runtime. Delete the whole folder when the migration is done
and we're confident in the replacement.

---

## Retirement log

### _(placeholder — no files archived yet)_

The TaskPlan migration is in progress. As Week 2/3/4 of P0-0 land and the
understanding LLM takes over each classifier, the retired file will move here
with a log entry above this line.

Template for each retirement entry:

```
### <module / function name>
- **Retired at**: YYYY-MM-DD (commit <sha>)
- **Why**: brief description of the failure mode the regex caused
- **Replaced by**: path to the new module + how the new module handles the
  same case
- **Verification**: link to the regression test that proves the new path
  works for the cases the old regex tried to cover
```

---

## Design rule for deciding "is this archivable"

A regex / keyword check belongs in live code **only** if:

1. **Pure speed** — the check must succeed deterministically without an LLM
   (e.g. `fast-path-router` for "open <url>" and "launch <app>"), AND the
   same input can never have two valid interpretations.
2. **Safety net** — the check catches LLM misbehaviour (refusal, hallucinated
   success) and cannot itself produce a false classification (because it only
   triggers *after* the LLM has spoken).
3. **Blacklist / allowlist** — simple enumerations (e.g. skill pattern
   tracker's skip list). Not semantic.

Anything else — "does this command mean email / calendar / schedule / file
action" — belongs to the understanding LLM. If the regex can reasonably be
fooled by a sentence the user might say, it's a classifier in disguise and
should move here.
