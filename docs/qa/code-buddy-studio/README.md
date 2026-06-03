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
| Build/typecheck guard | `npm run build`, `cd cowork && npm run typecheck`, `cd cowork && npm run build:e2e` |
| Packaging guard | `npm run build:gui` (`electron-builder` win-x64 NSIS; pre-build check: 9 passed, 0 warnings, 0 failed) |
| Packaged launch guard | `COWORK_PACKAGED_EXE="release/win-unpacked/Code Buddy Cowork.exe" npx playwright test e2e/packaged-launch-smoke.spec.ts --reporter=list --timeout=120000` (1 passed; capture [`110`](./screenshots/110-packaged-win-unpacked-launch.png)) |
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

## Release Readiness Route

Use this order before claiming the desktop app is ready for a public user or release candidate:

| Gate | Evidence to collect | Where it lives |
| --- | --- | --- |
| 1. User path is documented | Install, launch, provider setup, Cowork usage, and French/English guides are linked from the main getting-started flow | [`../../getting-started.md`](../../getting-started.md), [`../../cowork-user-guide.md`](../../cowork-user-guide.md), [`../../cowork-guide-fr.md`](../../cowork-guide-fr.md) |
| 2. Visual proof exists | Public PNG captures show the packaged app shell, work surface, settings, permissions, Test Runner, real provider checks, Hermes, mobile supervision, Computer Use, and runner bundles | [`./screenshots/`](./screenshots/) and the captures below |
| 3. Machine report agrees | Functional rows, coverage split, screenshot paths, and public capture metadata are machine-checkable | [`./feature-qa-report.json`](./feature-qa-report.json), `npm run test:docs-public` |
| 4. Build/package gates pass | Root TypeScript build, Cowork typecheck, Cowork Vite/e2e build, full Electron packaging, and packaged app launch succeed on the current checkout | `npm run build`, `cd cowork && npm run typecheck`, `cd cowork && npm run build:e2e`, `npm run build:gui`, `COWORK_PACKAGED_EXE=... npx playwright test e2e/packaged-launch-smoke.spec.ts` |
| 5. Safe checks pass | Safe runner bundles cover CLI, providers, server/API/MCP, Fleet, context, voice/TTS, scheduler/hooks, sessions/cache, plugins/skills, UI, permissions, and Cowork project/session flows | `Runner-Verified Cowork Bundles` below |
| 6. Opt-in real checks are explicit | Real ChatGPT OAuth, Docker, Computer Use, mobile, Hermes built CLI, and desktop automation are documented as opt-in and have separate captures | [`./feature-qa.md`](./feature-qa.md), [`./overnight-qa-campaign.md`](./overnight-qa-campaign.md) |
| 7. Publication guard passes | Local links, PNG dimensions, report integrity, and obvious private strings are checked before pushing public docs | `npm run test:docs-public` |

## Evidence Matrix

Use this matrix to decide which proof lane to re-run when the app, docs, captures, or release package changes:

| Lane | Run when | Command or proof | Public evidence |
| --- | --- | --- | --- |
| Safe publication | Any public docs or screenshot change | `npm run test:docs-public` | Guards links, screenshot dimensions, QA report integrity, and private-string leaks |
| Source build/typecheck | TypeScript, renderer, or Cowork source changes | `npm run build`, `cd cowork && npm run typecheck`, `cd cowork && npm run build:e2e` | Evidence snapshot and Release Readiness Route gate 4 |
| Packaged desktop | Release-review or packaging changes | `npm run build:gui`, then `COWORK_PACKAGED_EXE="release/win-unpacked/Code Buddy Cowork.exe" npx playwright test e2e/packaged-launch-smoke.spec.ts --reporter=list --timeout=120000` | [`110-packaged-win-unpacked-launch.png`](./screenshots/110-packaged-win-unpacked-launch.png) |
| Packaging warning triage | Any claim that packaging is warning-free or release-silent | Inspect `npm run build:gui` output and keep `Known Packaging Warnings` below current | Publicly separates passing package evidence from remaining cleanup signals |
| Safe runner bundles | Broad non-provider regression claims | Test Runner safe bundles for CLI, providers, server/API/MCP, Fleet, context, voice/TTS, automation, sessions/cache, permissions, and Cowork project/session flows | `Runner-Verified Cowork Bundles` below |
| Opt-in real provider/system | Claims involving external credentials, Docker, Computer Use, mobile, Hermes built CLI, or live desktop automation | Opt-in real rows in the QA dossier and overnight campaign | [`./feature-qa.md`](./feature-qa.md), [`./overnight-qa-campaign.md`](./overnight-qa-campaign.md) |

## Known Packaging Warnings

The current package build is green but not silent. Do not claim a zero-warning release until these rows are resolved or explicitly accepted:

| Warning | Current disposition | Follow-up |
| --- | --- | --- |
| Node `DEP0190` during packaging | Build succeeds; `NODE_OPTIONS=--trace-deprecation npm run build:gui` traces the warning to electron-builder's third-party `app-builder-lib/src/node-module-collector/nodeModulesCollector.ts` while collecting npm modules, not to a repo-owned packaging script | Track upstream electron-builder/app-builder-lib behavior before attempting a local workaround |

## Resolved Packaging Signals

| Signal | Evidence |
| --- | --- |
| Vite chunk-size warnings | `npm run build:gui` now reports 0 occurrences of `Some chunks`; the renderer entry chunk is 496.11 kB after lazy-loading closed-by-default Cowork surfaces, replacing full `highlight.js` with core language registration, and adding measured renderer vendor chunks without raising `chunkSizeWarningLimit` |
| Dynamic/static import reporter warnings | `npm run build:gui` now reports 0 occurrences of `vite:reporter`, `core-loader`, or `Dynamic/static import`; the former mixed `core-loader` boundary was removed by replacing redundant dynamic helper imports while keeping `server-bridge`, `sandbox-bootstrap`, and `reasoning-bridge` as action-path lazy chunks |

## Runner-Verified Cowork Bundles

| Bundle | Verified coverage | Runner proof |
| --- | --- | --- |
| CLI command surface | CLI flags, headless exit codes, model/session commands, slash/context/session/permission/security/tool handlers, backups, agents, run recall, worktrees, Fleet, auth, config, and memory commands | `562 ok / 0 ko` |
| Plugins and skills | Plugin onboarding, SDK channel, manager, conflict detector, cloud providers, plugin CLI, skill registry, starter packs, layering, hub, eligibility, and deprecation warnings | `755 ok / 0 ko` |
| Terminal UI and observer | Ink UI accessibility, chat rendering, diff logic, keyboard shortcuts, metrics dashboard, status line, themes, tool streams, clipboard, GUI tool, and screen observer | `376 ok / 0 ko` |
| Config, auth, providers | Profile manager, ChatGPT OAuth, doctor checks, Codex OAuth, provider hooks, ChatGPT responses, Gemini CLI/vision, stream retry, model registry/pricing/defaults, migrations, env schema, TOML/JSONC, provider manager, and model snapshots | `849 ok / 0 ko` |
| Data, sessions, sync, cache | Database layer, KV config, session locks/branches/timeline/replay/export/cleanup, cloud sync, peer session store, cron persistence, response cache, prompt cache, and distributed cache | `901 ok / 0 ko` |
| Server, API, MCP platform | API server, auth, middleware, mobile/native routes, workflow builder, canvas, HTTP/REST, IDE server, LSP, MCP client/server/OAuth, and JSON-RPC integration | `703 ok / 0 ko` |
| Fleet routing orchestration | TaskRouter, saga store, consensus, privacy lint, peer chat stream/factory, registry/listener/handler, dispatch profiles, cost tracking, compaction bridge, capability registry, and autonomous ticks | `357 ok / 0 ko` |
| Context compression pruning | Web-search context, restorable compression gaps, dangling patches, context guardrails, observation variation, importance scoring, TTL/soft/hard pruning, and progressive/parallel/adaptive compaction | `282 ok / 0 ko` |
| Voice, speech, TTS | Voice control, speech recognition, wake-word fallback, TTS providers, audio reader, audio tool, and voice-to-code | `164 ok / 0 ko` |
| Provider resilience errors | Stream/client retry, backoff policy, rate limiting, rate-limit display, normalized errors, error-handling audit, client recovery, and malformed Gemini recovery | `367 ok / 0 ko` |
| Server provider error status | Local provider `429`/`503` propagation, `Retry-After`, server rate-limit separation, and OpenAI-compatible error payloads | `5 ok / 0 ko` |
| Infrastructure MCP sandbox adapters | MCP manager/discovery/tool adapter, Electron core adapter LRU/hotswap, sandbox registry, auto-sandbox, OS sandbox/exec policy, and E2B fallback | `190 ok / 0 ko` |
| Automation scheduler hooks notifications | Watchdogs, scheduled delivery, cron prechecks/persistence, lifecycle/input/tool hooks, session lanes, webhooks, triggers, proactive notifications, and default sinks | `766 ok / 0 ko` |
| Maintenance doctor backup settings | Doctor checks/fixes, ChatGPT OAuth diagnostics, onboarding wizard, backup handlers, update notifier, settings manager, update tags, migrations, and hooks/policies/memory settings | `254 ok / 0 ko` |
| Remote control | Remote manager, remote user messages, default workdir, `!cd`, cwd propagation, port conflict handling, remote panel links/layout, and remote slash-command bridge | `16 ok / 0 ko` |
| Device transport adapters | SSH, ADB, and local transports, transport helpers, and Tailscale dashboard node modeling | `178 ok / 0 ko` |
| Cowork sandbox executor | Dangerous-command validation, workspace containment, WSL/Lima command-injection guards, stderr capture, and `rm -rf`/symlink protections | `42 ok / 0 ko` |
| Project, session, and git | Git worktrees/compare, project selection, recent files, attachments, session CRUD/cache/search/resume, and session insights | `73 ok / 0 ko` |
| Cowork UI localization layout | App/chat/welcome/message/config layouts, dark palette, French i18n, Fleet Command Center translations, settings/plugin/schedule surfaces, focus view, local links, LaTeX, markdown, and long attachment layout | `96 ok / 0 ko` |
| Activity, audit, diagnostics | Activity feed, global search, audit recall, diagnostics renderer, preview service, event mapping, and recent files | `67 ok / 0 ko` |
| Fleet command and team | FleetBridge, IPC dispatch, command-center board, discovery YAML, SagaRunner, internet-proof metadata, outcomes, scheduled work, and TeamBridge | `61 ok / 0 ko` |
| Permission path rules | Computer-use permission dialog, quick rules, classification/preview/target rules, declarative fallback, path containment, UNC, and command path conversion | `58 ok / 0 ko` |
| Settings, hooks, MCP, workflows | Theme/autostart settings, hook dry-runs, MCP env/tool sync, staged MCP bundles, DAG workflow compilation, and the real Orchestrator | `62 ok / 0 ko` |
| Custom commands and slash | Markdown persistence, slash-name normalization, invalid draft validation, delete flow, custom-over-builtin precedence, autocomplete, remote execution, and `/schedule` parsing | `11 ok / 0 ko` |

## Representative Captures

![Packaged win-unpacked launch](./screenshots/110-packaged-win-unpacked-launch.png)

![Cowork ChatGPT gpt-5.5 real run](./screenshots/29-real-gpt55-cowork-gui.png)

![Local provider config bundle](./screenshots/101-test-runner-local-provider-config-bundle.png)

![Tests and executions window](./screenshots/30-test-runner-window.png)

![Cowork IPC chat flow](./screenshots/59-test-runner-cowork-ipc-chat.png)

![Permission real flow](./screenshots/55-test-runner-permission-real-flow.png)

![Workflow bridge integration](./screenshots/54-test-runner-workflow-integration.png)

![Artifact and document bundle](./screenshots/99-test-runner-artifact-document-bundle.png)

![Scheduling and session bundle](./screenshots/100-test-runner-scheduling-session-bundle.png)

![CLI command surface bundle](./screenshots/79-test-runner-cli-command-surface-bundle.png)

![Plugins skills bundle](./screenshots/80-test-runner-plugins-skills-bundle.png)

![Terminal UI observer bundle](./screenshots/81-test-runner-terminal-ui-observer-bundle.png)

![Config auth provider bundle](./screenshots/82-test-runner-config-auth-provider-bundle.png)

![Data session sync cache bundle](./screenshots/83-test-runner-data-session-sync-cache-bundle.png)

![Server API MCP platform bundle](./screenshots/84-test-runner-server-api-mcp-platform-bundle.png)

![Fleet routing orchestration bundle](./screenshots/85-test-runner-fleet-routing-orchestration-bundle.png)

![Context compression pruning bundle](./screenshots/86-test-runner-context-compression-pruning-bundle.png)

![Voice speech TTS bundle](./screenshots/87-test-runner-voice-speech-tts-bundle.png)

![Provider resilience error bundle](./screenshots/91-test-runner-provider-resilience-error-bundle.png)

![Server provider error status bundle](./screenshots/92-test-runner-server-provider-error-status-bundle.png)

![Infrastructure MCP sandbox adapters bundle](./screenshots/93-test-runner-infra-mcp-sandbox-adapters-bundle.png)

![Scheduler hooks notifications bundle](./screenshots/88-test-runner-scheduler-hooks-notifications-bundle.png)

![Maintenance doctor backup settings bundle](./screenshots/89-test-runner-maintenance-doctor-backup-settings-bundle.png)

![Remote control bundle](./screenshots/94-test-runner-remote-control-bundle.png)

![Device transport adapters bundle](./screenshots/95-test-runner-device-transport-adapters-bundle.png)

![Cowork sandbox executor bundle](./screenshots/96-test-runner-cowork-sandbox-executor-bundle.png)

![Project session git bundle](./screenshots/97-test-runner-project-session-git-bundle.png)

![Cowork UI localization layout bundle](./screenshots/98-test-runner-ui-localization-layout-bundle.png)

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
