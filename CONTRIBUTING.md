# Contributing to LingxY

Thank you for considering a contribution.

LingxY is an MIT-licensed desktop AI assistant. We welcome bug reports, feature
suggestions, code patches, and documentation improvements from anyone.

---

## Before you start

- Read [README.md](README.md) for setup and usage.
- Read [产品介绍.md](产品介绍.md) for the product positioning.
- Look through open issues to avoid duplicating in-flight work.
- For non-trivial changes (new features, refactors, dependency additions),
  please open an issue first to discuss the approach. This avoids wasted work
  if the change conflicts with the project direction.

---

## Reporting issues

When filing a bug report, please include:

- LingxY version (or commit hash if running from source)
- Operating system and version (Windows 10 / 11)
- Node version (`node --version`)
- Steps to reproduce — minimal repro is best
- Expected vs. actual behavior
- Relevant logs (Console → Settings → Diagnostics JSON has a redacted bundle)

For feature requests, describe the user scenario first ("I want to do X
because Y") rather than the implementation. We may have a different way to
solve the same problem.

---

## Submitting changes

1. **Fork** the repository and create a topic branch (`task/your-feature` or
   `fix/issue-NNN`).
2. **Match the existing style** — the codebase has structural verifiers in
   `scripts/verify-*.mjs` that lock module boundaries. Run `npm run check`
   before pushing.
3. **Add tests where appropriate**:
   - Behavior-level tests live in `tests/behavior/` (run with
     `npm run verify:behavior-tests`).
   - Structural verifiers live in `scripts/verify-*.mjs`.
   - Don't disable existing verifiers to make a change pass — they encode
     invariants the project relies on.
4. **Keep commits focused**. One logical change per commit, with a clear
   message. The `fix:` / `feat:` / `docs:` / `chore:` / `refactor:` prefixes
   are encouraged but not enforced.
5. **Open a pull request** against `main`. CI runs `verify:github-readiness`,
   `verify:structure`, `verify:doc-references`, `verify:local-http-surface`,
   and `verify:behavior-tests`. Larger changes should also pass the full
   `npm run check` locally.
6. **Respond to review feedback** — we aim to give a first response within a
   reasonable time, but maintainers also have day jobs. If a PR sits idle,
   feel free to ping.

---

## License of contributions

**By submitting a pull request, issue, patch, code snippet, design proposal,
or any other contribution to this project, you agree that your contribution
will be licensed under the MIT License (see [LICENSE](LICENSE)), unless you
explicitly state otherwise in writing.**

You also certify that:

- You have the right to submit the contribution under this license.
- The contribution is your own original work, or you have permission from
  the original author(s) to relicense it under MIT.
- Your contribution does not knowingly include code copied from sources
  governed by an incompatible license (such as GPL/AGPL/proprietary code).

This is the standard "inbound = outbound" model used by most MIT and
Apache-2.0 projects. It is what makes it safe for the project (and any
downstream user) to use, modify, redistribute, and incorporate contributions
into commercial products.

If you are contributing on behalf of your employer, please confirm that
your employer has authorized the contribution before submitting.

---

## What you keep, what you grant

- **Copyright stays with you** (or your employer, depending on your contract).
- You **grant the project and all users** a perpetual, worldwide, royalty-free
  license to use, modify, and redistribute the contribution under the terms of
  the MIT License.
- You **do not assign copyright** to the project owner — there is no CLA at
  this stage.

If LingxY ever needs to relicense to something other than MIT, we would have
to ask each contributor for permission, or remove their contributions. We
have no plans to do this.

---

## Code of conduct

Be respectful. Disagreements are fine; personal attacks are not. We
follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/).

If you experience or witness unacceptable behavior, please email the
maintainer (see git log for current maintainer contact).

---

## Security

Do not file public issues for security vulnerabilities. Email the maintainer
directly with details. We will respond within a reasonable timeframe and
coordinate disclosure.

For non-sensitive security improvements (e.g. tightening a CSP rule, fixing
a CORS misconfiguration), a normal pull request is fine.

---

## Questions

If anything in this document is unclear, open an issue tagged `question` and
we will clarify (and update this file).
