# Security Policy

LingxY is a local-first desktop productivity tool. Security reports should
protect users while giving maintainers enough detail to reproduce and fix the
issue.

## Reporting a Vulnerability

Do not file public issues for vulnerabilities. Email the maintainer directly;
see git log for the current maintainer contact.

Please include:

- Affected version, commit, or branch.
- Operating system and Node/Electron versions.
- Reproduction steps, proof of concept, logs, screenshots, or packet traces.
- Whether the issue requires local OS admin access, physical access, or a
  configured third-party account.

## Scope

Reports are in scope when they affect this repository's code or default
distribution path, including:

- Local HTTP/SSE desktop actor boundaries and guarded mutation routes.
- Scheduler approvals, misfire recovery, and side-effect execution gates.
- MCP install, test, enable, and runtime configuration paths.
- Connector workflows for email, calendar, files, browser, and Office actions.
- Provider key handling through `apiKeyRef`, local Secret Store integration,
  and redacted diagnostics/export behavior.
- Browser extension, Office add-in, popup card, overlay, and desktop shell
  contracts.

## Out of Scope

The following are usually out of scope unless they expose a vulnerability in
this project:

- Vulnerabilities in third-party MCP packages, model providers, browsers,
  Office, or operating systems. Report those upstream.
- Self-hosted misconfiguration, exposed local ports, or credentials stored
  outside LingxY's documented configuration paths.
- Attacks requiring local OS administrator privileges or malware already
  running as the same user.
- Denial-of-service reports that only exhaust local disk, CPU, or model quota
  without crossing a trust boundary.

## Disclosure Timeline

We aim to acknowledge valid reports within 7 days. We coordinate fixes and
public disclosure with reporters, with a target disclosure window of 90 days
unless active exploitation or ecosystem coordination requires a different
timeline.

## Supported Versions

The repository is pre-1.0. Security fixes target the default branch first and
may be backported to active release or trial branches when practical.
