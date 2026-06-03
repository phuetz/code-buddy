# Code Buddy Studio QA Evidence

This directory is the public, GitHub-rendered evidence hub for the Code Buddy / Cowork real-use QA campaign.

Start here when you want proof that the documented Cowork flows have been exercised with real local infrastructure, real Electron/Playwright runs, and opt-in real provider or desktop automation checks.

## Read First

| Artifact | Purpose |
| --- | --- |
| [`feature-qa.md`](./feature-qa.md) | Main functional QA dossier with command evidence, screenshots, and bug-fix notes |
| [`feature-qa-report.json`](./feature-qa-report.json) | Machine-readable QA report |
| [`overnight-qa-campaign.md`](./overnight-qa-campaign.md) | Longer autonomous QA campaign notes and coverage |
| [`overnight-test-datasets.json`](./overnight-test-datasets.json) | Structured dataset used by the overnight QA pass |
| [`screenshots/`](./screenshots/) | Public PNG captures referenced by guides and reports |

## Evidence Snapshot

| Signal | Current proof |
| --- | --- |
| Functional rows | 29 / 29 passed |
| Coverage split | 3 real, 26 used, 0 partial |
| Machine report | [`feature-qa-report.json`](./feature-qa-report.json) |
| Screenshot guard | `npm run test:docs-public` |

## Current Evidence Themes

- ChatGPT OAuth `gpt-5.5`: account check, provider direct call, stream, tool-call, CLI, server API, and Cowork/Electron.
- Provider configuration: API config state/config sets, diagnostics, Ollama, LM Studio, local discovery, loopback gateways, and retry behavior.
- Cowork desktop: workspace, settings, chat, IPC, companion, permissions, workflows, MCP, Fleet, plugins, and runner surfaces.
- **Tests & executions**: safe bundles, opt-in real checks, cancellation, timeout, failure tracking, and re-run failing behavior.
- Artifacts and scheduling: document workshop, file/link handling, scheduled tasks, slash `/schedule`, and session metadata.
- Knowledge and Hermes surfaces: lesson candidates, lessons vault, user model/spec IPC, Hermes plans/tool profiles, skill-candidate review, and presence model readiness.
- Real infrastructure: local HTTP server, MCP stdio/HTTP fixtures, Fleet peer/tool checks, Docker sandbox, Computer Use, and Hermes built CLI smoke including guarded runtime lifecycle checks.
- Mobile supervision: loopback-only local-operator routes, spoofed-forwarder denial, approval queue, Cowork bridge client, and disabled listener contract.
- Publication safety: public docs and screenshots are checked for private account, token, local path, and screenshot metadata leaks.

## Runner-Verified Cowork Bundles

| Bundle | Verified coverage | Runner proof |
| --- | --- | --- |
| Remote control | Remote manager, remote user messages, default workdir, `!cd`, cwd propagation, port conflict handling, remote panel links/layout, and remote slash-command bridge | `16 ok / 0 ko` |
| Device transport adapters | SSH, ADB, and local transports, transport helpers, and Tailscale dashboard node modeling | `178 ok / 0 ko` |
| Cowork sandbox executor | Dangerous-command validation, workspace containment, WSL/Lima command-injection guards, stderr capture, and `rm -rf`/symlink protections | `42 ok / 0 ko` |
| Project, session, and git | Git worktrees/compare, project selection, recent files, attachments, session CRUD/cache/search/resume, and session insights | `73 ok / 0 ko` |
| Activity, audit, diagnostics | Activity feed, global search, audit recall, diagnostics renderer, preview service, event mapping, and recent files | `67 ok / 0 ko` |
| Fleet command and team | FleetBridge, IPC dispatch, command-center board, discovery YAML, SagaRunner, internet-proof metadata, outcomes, scheduled work, and TeamBridge | `61 ok / 0 ko` |
| Permission path rules | Computer-use permission dialog, quick rules, classification/preview/target rules, declarative fallback, path containment, UNC, and command path conversion | `58 ok / 0 ko` |
| Settings, hooks, MCP, workflows | Theme/autostart settings, hook dry-runs, MCP env/tool sync, staged MCP bundles, DAG workflow compilation, and the real Orchestrator | `62 ok / 0 ko` |
| Custom commands and slash | Markdown persistence, slash-name normalization, invalid draft validation, delete flow, custom-over-builtin precedence, autocomplete, remote execution, and `/schedule` parsing | `11 ok / 0 ko` |

## Representative Captures

![Cowork ChatGPT gpt-5.5 real run](./screenshots/29-real-gpt55-cowork-gui.png)

![Local provider config bundle](./screenshots/101-test-runner-local-provider-config-bundle.png)

![Tests and executions window](./screenshots/30-test-runner-window.png)

![Permission real flow](./screenshots/55-test-runner-permission-real-flow.png)

![Artifact and document bundle](./screenshots/99-test-runner-artifact-document-bundle.png)

![Scheduling and session bundle](./screenshots/100-test-runner-scheduling-session-bundle.png)

![Remote control bundle](./screenshots/94-test-runner-remote-control-bundle.png)

![Device transport adapters bundle](./screenshots/95-test-runner-device-transport-adapters-bundle.png)

![Cowork sandbox executor bundle](./screenshots/96-test-runner-cowork-sandbox-executor-bundle.png)

![Project session git bundle](./screenshots/97-test-runner-project-session-git-bundle.png)

![Activity audit diagnostics bundle](./screenshots/102-test-runner-activity-audit-diagnostics-bundle.png)

![Fleet command team bundle](./screenshots/103-test-runner-fleet-command-team-bundle.png)

![Permission path rules bundle](./screenshots/104-test-runner-permission-path-rules-bundle.png)

![Settings hooks MCP workflows bundle](./screenshots/105-test-runner-settings-hooks-mcp-workflows-bundle.png)

![Custom commands slash bundle](./screenshots/106-test-runner-custom-commands-slash-bundle.png)

![Knowledge Hermes presence bundle](./screenshots/107-test-runner-knowledge-hermes-presence-bundle.png)

![Computer Use real desktop suite](./screenshots/108-test-runner-computer-use-real-suite.png)

![Mobile supervision gateway bundle](./screenshots/90-test-runner-mobile-supervision-gateway-bundle.png)

![Hermes built CLI lifecycle guard](./screenshots/109-test-runner-hermes-built-cli-real.png)

## Re-run Public Documentation Guards

Run these before publishing new public documentation or captures:

```bash
npm run test:docs-public
```

This script runs the public documentation guards in `tests/docs/public-doc-links.test.ts`,
`tests/docs/public-doc-discoverability.test.ts`,
`tests/docs/public-qa-evidence-integrity.test.ts`, and
`tests/docs/public-screenshot-privacy.test.ts`, plus the renderer checks in
`tests/docs/renderers.test.ts`.

The guards verify exact-case local links, relative screenshot references, machine-readable QA report counts and screenshot paths, real PNG files with minimum public-capture dimensions, and absence of obvious private strings in public docs or PNG metadata.
