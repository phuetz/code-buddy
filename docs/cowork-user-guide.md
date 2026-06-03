# Cowork User Guide

Version française: [`cowork-guide-fr.md`](./cowork-guide-fr.md).

Cowork is the desktop cockpit for Code Buddy. It gives you the same core agent as the CLI, but with project navigation, chat, traces, settings, permissions, workflows, MCP connectors, Fleet coordination, companion controls, and the **Tests & executions** runner in one Electron app.

This guide is meant for GitHub readers: every screenshot below is a repository-local PNG, and the public evidence is guarded by `tests/docs/public-screenshot-privacy.test.ts`.

## 1. Prepare Code Buddy

From a source checkout:

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run build
```

For ChatGPT Plus / Pro subscription routing:

```bash
buddy login
buddy whoami
```

For server-backed Cowork flows:

```bash
buddy server --port 3000
```

Cowork can also run against API-key providers configured in Settings.

## 2. Start Cowork

For a source checkout:

```bash
npm run dev:gui
```

The first screen is the work surface. Select a workspace, then start a chat or open the navigation surfaces from the sidebar.

![Cowork home work surface](./qa/code-buddy-studio/screenshots/01-home-work-surface.png)

For a release-review package check, build the desktop app and launch the generated Windows `win-unpacked` executable through the opt-in smoke:

```bash
npm run build:gui
cd cowork
COWORK_PACKAGED_EXE="release/win-unpacked/Code Buddy Cowork.exe" npx playwright test e2e/packaged-launch-smoke.spec.ts --reporter=list --timeout=120000
```

That smoke verifies the app is really packaged, uses an isolated `userData` profile, waits for the renderer shell, and publishes this capture:

![Packaged win-unpacked launch](./qa/code-buddy-studio/screenshots/110-packaged-win-unpacked-launch.png)

## 3. Configure the Agent Route

Open **Settings** to select the provider, model, embedded engine mode, backend URL, permission behavior, MCP connectors, plugins, and quick prompts.

![Settings overview](./qa/code-buddy-studio/screenshots/22-settings.png)

For a ChatGPT OAuth route, use `buddy login` first, then select the ChatGPT profile/model in Cowork. The real non-mocked Electron run below forced the ChatGPT profile and rendered the marker `REAL-GPT55-COWORK-GUI`.

![Cowork ChatGPT gpt-5.5 real run](./qa/code-buddy-studio/screenshots/29-real-gpt55-cowork-gui.png)

For local or custom providers, use the API configuration panel to test profiles, config sets, diagnostics, Ollama, LM Studio, loopback gateways, and retry behavior before routing a chat through them. The verified local provider bundle exercises those paths from the desktop runner with `143 ok / 0 ko`.

![Local provider config bundle](./qa/code-buddy-studio/screenshots/101-test-runner-local-provider-config-bundle.png)

## 4. Use Chat, Files, and Workspace Context

Typical workflow:

1. Select a workspace folder.
2. Attach files or drag them into the chat input.
3. Ask for a concrete output, such as a report, code change, spreadsheet, or test run.
4. Review tool calls and trace events before accepting risky actions.
5. Save or export artifacts from the generated outputs.

Cowork keeps file operations scoped to the selected workspace, and the core engine applies the same transcript repair, output sanitizer, MCP routing, and model hot-swap behavior as the CLI.

## 5. Work With Artifacts, Documents, and Schedules

Generated artifacts stay attached to the conversation and can be opened through Cowork's preview/workshop surfaces. The verified artifact bundle covers artifact detection, file links, document workshop progress, tool-output path extraction, citation normalization, and document-ready message states.

![Artifact and document bundle](./qa/code-buddy-studio/screenshots/99-test-runner-artifact-document-bundle.png)

For follow-up work, use the scheduling surfaces from Settings or slash commands. The verified scheduling bundle covers one-shot and repeating tasks, run-now behavior, daily/weekly slots, session titles, slash `/schedule`, and schedule metadata shown back in Cowork.

![Scheduling and session bundle](./qa/code-buddy-studio/screenshots/100-test-runner-scheduling-session-bundle.png)

## 6. Review Permissions Before Risky Actions

When the agent needs a sensitive operation, Cowork shows a permission dialog. The real permission E2E flow injects a Bash request, clicks **Allow**, persists a scoped write rule, and proves the runner can execute the flow from the desktop app.

![Permission real flow from the runner](./qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png)

Use narrow scopes when possible:

- Approve one command for a one-off action.
- Persist a path rule only when the workspace path is intentional.
- Keep destructive desktop automation opt-in.
- Re-run the safe test bundle before publishing results.

## 7. Run Real Verification From the Desktop

Open **Tests & executions** to launch safe local bundles and opt-in real checks. The runner tracks status, counts, environment badges, and execution history.

![Tests and executions window](./qa/code-buddy-studio/screenshots/30-test-runner-window.png)

Useful rows include:

| Row | What it proves |
| --- | --- |
| `Cowork / real GPT-5.5 chat` | Real Electron + ChatGPT OAuth desktop chat |
| `Server / real GPT-5.5 chat API` | Local HTTP routes backed by ChatGPT OAuth |
| `Cowork / permission real flow` | Real permission prompt and persisted scoped rule |
| `MCP / real transport suite` | Real stdio and HTTP MCP fixtures plus fail-closed guard |
| `Computer Use / real desktop suite` | WinForms, dialog, Notepad, and Excel COM opt-in desktop automation |
| `Hermes / built CLI real smoke` | Rebuilds Code Buddy, verifies Hermes tools/doctor, proves guarded lifecycle execution, and documents Vercel Sandbox attach |
| `Mobile / supervision gateway bundle` | Loopback-only pairing/status routes, approval queue, and Cowork bridge behavior |

For day-to-day confidence checks, start with the safe bundles. They do not require a real provider token, Docker, or desktop automation opt-in:

| Need | Runner row | Proof |
| --- | --- | --- |
| Check installed plugins and reusable skills | `Plugins / skills bundle` | `755 ok / 0 ko`, [capture](./qa/code-buddy-studio/screenshots/80-test-runner-plugins-skills-bundle.png) |
| Check the terminal UI and observer stack | `UI / terminal observer bundle` | `376 ok / 0 ko`, [capture](./qa/code-buddy-studio/screenshots/81-test-runner-terminal-ui-observer-bundle.png) |
| Check session persistence, sync, and caches | `Data / session sync cache bundle` | `901 ok / 0 ko`, [capture](./qa/code-buddy-studio/screenshots/83-test-runner-data-session-sync-cache-bundle.png) |
| Check voice, wake-word fallback, and TTS | `Voice / speech TTS bundle` | `164 ok / 0 ko`, [capture](./qa/code-buddy-studio/screenshots/87-test-runner-voice-speech-tts-bundle.png) |
| Check schedules, hooks, webhooks, and notifications | `Automation / scheduler hooks notifications bundle` | `766 ok / 0 ko`, [capture](./qa/code-buddy-studio/screenshots/88-test-runner-scheduler-hooks-notifications-bundle.png) |
| Check doctor, backup, settings, and migrations | `Maintenance / doctor backup settings bundle` | `254 ok / 0 ko`, [capture](./qa/code-buddy-studio/screenshots/89-test-runner-maintenance-doctor-backup-settings-bundle.png) |

The runner also exposes execution monitoring:

![Executions tracking](./qa/code-buddy-studio/screenshots/31-test-runner-executions.png)

The Hermes row is a manual real smoke because it rebuilds the compiled CLI before executing it. It proves `hermes tools`, `hermes doctor safe`, the Daytona lifecycle attach plan, the blocked Daytona and Vercel Sandbox `--execute` guards without allow flags, and the Vercel Sandbox attach mapping.

![Hermes built CLI lifecycle guard](./qa/code-buddy-studio/screenshots/109-test-runner-hermes-built-cli-real.png)

The mobile supervision row checks the local-operator boundary before any phone-facing workflow is treated as usable. It covers loopback-only pairing/status routes, spoofed-forwarder denial, prompt draft approval/cancel behavior, the Cowork mobile bridge client, and the disabled listener contract that keeps off-device execution gated until TLS and auth are deliberately configured.

![Mobile supervision gateway bundle](./qa/code-buddy-studio/screenshots/90-test-runner-mobile-supervision-gateway-bundle.png)

When a Hermes research-script job proposes a reusable SKILL.md candidate, inspect the candidate before installing it:

```bash
buddy tools skill-candidate inspect .codebuddy/skill-candidates/<candidate-dir>
```

The successful run evidence must show a written local output artifact: `outputStatus: written` and `outputVerified: true`. A clean process exit with `outputStatus: placeholder` or `outputStatus: missing` means the remote or sandbox run did not return usable evidence yet, so Cowork and the CLI deliberately refuse to count it as repeatable proof for promotion.

## 8. Extend Cowork With MCP, Fleet, and Skills

Use **MCP Connectors** to add external tools and local transports.

![MCP connectors](./qa/code-buddy-studio/screenshots/24-mcp-connectors.png)

Use **Fleet Command Center** and agent team surfaces when multiple peers or workflows need coordination.

![Fleet command center](./qa/code-buddy-studio/screenshots/07-fleet-command-center.png)

Use **Skills** and plugin surfaces when the task needs reusable workflows for documents, spreadsheets, presentations, browser automation, or domain-specific operations.

![Plugins](./qa/code-buddy-studio/screenshots/26-plugins.png)

For learning and Hermes-oriented operation, use the knowledge surfaces to review lesson candidates before they become durable lessons, browse the lessons vault, inspect Hermes plans/tool profiles, review skill candidates, and check local presence model readiness. The verified knowledge bundle covers those paths without silently writing memory or lessons.

![Knowledge Hermes presence bundle](./qa/code-buddy-studio/screenshots/107-test-runner-knowledge-hermes-presence-bundle.png)

## 9. Opt In to Desktop Automation Carefully

Computer Use checks are opt-in because they touch real desktop applications. The verified suite drives Windows Forms controls, dialogs, Notepad save behavior, and Excel COM automation, then reports `1 ok / 0 ko` from the runner.

![Computer Use real desktop suite](./qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png)

Before using desktop automation:

- Close private documents and browser tabs.
- Keep the workspace narrow.
- Prefer safe runner rows first.
- Capture only redacted or non-private screenshots for public docs.

## 10. Publish Evidence Safely

Before publishing documentation or screenshots:

```bash
npm run test:docs-public
```

The current public QA dossier starts at [`qa/code-buddy-studio/`](./qa/code-buddy-studio/README.md). Its full report records the real command evidence for ChatGPT OAuth, Cowork/Electron, server routes, MCP, Fleet, permissions, Docker, Computer Use, Hermes, and companion flows.
