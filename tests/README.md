# Tests

`tests/behavior/*.test.mjs` uses Node's built-in `node:test` runner for hot-path behavior invariants. Run it with:

```bash
npm run verify:behavior-tests
```

The older `scripts/verify-*.mjs` checks remain in place as structure and regression guards.

Submission policy boundary audits live in `scripts/verify-submission-policy-boundary.mjs`; that script classifies current `*-submission.mjs` entrypoints without changing their behavior.

External-call boundary audits live in `scripts/verify-external-call-boundary.mjs`. It keeps the current naked `fetch` / `spawn` inventory visible while new call sites migrate toward `src/service/core/external-call.mjs`; behavior tests cover the first migrated fast-executor OpenAI-compatible fetch path.
