# Security Policy

Code Buddy can read and write files, execute commands, call model providers, and
expose local or remote integrations. Security reports that cross one of those
trust boundaries are taken seriously.

## Supported versions

Security fixes target the latest published `1.x` release and the `main` branch.
Upgrade to the newest release before reporting a problem that may already be
fixed.

## Report a vulnerability privately

Do **not** open a public issue or discussion for a suspected vulnerability.
Use GitHub's private
[Report a vulnerability](https://github.com/phuetz/code-buddy/security/advisories/new)
form. If that form is unavailable, contact the maintainer through the
[maintainer's GitHub profile](https://github.com/phuetz) without sharing exploit
details publicly.

Include:

- the affected version, commit, platform, and installation method;
- the security boundary that was crossed and the expected boundary;
- minimal reproduction steps or a proof of concept;
- the realistic impact and required attacker capabilities;
- relevant file paths, logs, or screenshots with all secrets redacted.

Do not include live API keys, access tokens, private prompts, personal data, or
third-party credentials. Revoke and rotate any secret that may have been
exposed.

We aim to acknowledge reports within three business days, confirm the initial
triage within seven days, and coordinate remediation and disclosure with the
reporter. Complex or upstream issues may take longer. Credit is offered unless
the reporter prefers anonymity.

## Scope

High-value reports include:

- sandbox, workspace-root, path traversal, or command-policy escapes;
- bypasses of permission modes, confirmation gates, tool allowlists, or fleet
  safety checks;
- secret exposure through logs, configuration, telemetry, prompts, exports, or
  generated artifacts;
- authentication or authorization flaws in the HTTP server, gateway, MCP,
  fleet, browser automation, or Cowork desktop app;
- unsafe cross-project, cross-session, or remote-peer data access;
- dependency vulnerabilities with a demonstrated path through Code Buddy.

Usually out of scope unless they cross a Code Buddy security boundary:

- model hallucinations or prompt injection alone;
- provider availability, model output quality, or provider-side behavior;
- social engineering, self-XSS, or attacks requiring an already-compromised
  machine;
- automated scanner output without a reproducible impact;
- denial of service that requires trusted local access and has no privilege
  escalation or data exposure.

## Safe research

Test only with accounts, machines, repositories, and peers you own or are
authorized to use. Minimize access to private data, stop once impact is proven,
and do not disrupt services or other users. Please allow a reasonable remediation
window before disclosure.

## User safety basics

- Keep confirmation prompts enabled unless you understand the consequences of
  the selected permission or YOLO mode.
- Constrain sandboxes and `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` to the smallest
  practical workspace.
- Review commands and diffs before execution or commit.
- Store credentials in environment variables or supported secret references;
  never commit them to a repository.
- Treat transcripts, exported sessions, logs, and screenshots as potentially
  sensitive.
- Keep Code Buddy and its dependencies updated.

General bugs and feature requests belong in the public
[issue tracker](https://github.com/phuetz/code-buddy/issues). Security details do
not.
