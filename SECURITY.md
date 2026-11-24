# Security Policy

## Supported versions

Only the latest release of Panes receives security fixes. The in-app updater delivers new versions, so please update before reporting and confirm the issue still reproduces.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not open a public issue, discussion, or pull request for a security problem.

Report it privately through GitHub instead: open the repository's [Security tab](https://github.com/wygoralves/panes/security) and choose **Report a vulnerability**, or go straight to the [private report form](https://github.com/wygoralves/panes/security/advisories/new).

If that form is not available to you, open a regular issue that says only that you have a security report and asks for a private channel. Leave every detail of the problem out of it, and the maintainer will follow up privately.

Include what you can of the following:

- The Panes version and your operating system
- Which part of the app is affected
- Steps to reproduce, or a proof of concept
- What an attacker could do with it

The maintainer aims to acknowledge a report within 7 days and will keep you updated in the advisory thread until a fix ships or the report is closed. Panes has a single maintainer, so a fix can take longer than the acknowledgement.

## Scope

Panes runs coding agents with access to your repositories, terminals, and git credentials, so these areas matter most:

- The Claude Agent SDK sidecar and the Codex and OpenCode engine integrations
- Approvals, sandbox and network overrides, and anything that lets an agent act without the approval it should need
- Native terminal sessions (PTY) and the terminal notification bridge
- Git operations and the handling of git credentials
- File access outside the opened workspace and repository roots
- The updater and the release artifacts it installs

Vulnerabilities in the external CLIs Panes launches (Codex CLI, Claude Code, and the other harnesses) should go to those projects. If Panes makes one of them worse, report that part here.
