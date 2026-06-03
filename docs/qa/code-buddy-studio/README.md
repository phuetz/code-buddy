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

## Current Evidence Themes

- ChatGPT OAuth `gpt-5.5`: account check, provider direct call, stream, tool-call, CLI, server API, and Cowork/Electron.
- Cowork desktop: workspace, settings, chat, IPC, companion, permissions, workflows, MCP, Fleet, plugins, and runner surfaces.
- **Tests & executions**: safe bundles, opt-in real checks, cancellation, timeout, failure tracking, and re-run failing behavior.
- Real infrastructure: local HTTP server, MCP stdio/HTTP fixtures, Fleet peer/tool checks, Docker sandbox, Computer Use, and Hermes built CLI smoke.
- Publication safety: public docs and screenshots are checked for private account, token, local path, and screenshot metadata leaks.

## Representative Captures

![Cowork ChatGPT gpt-5.5 real run](./screenshots/29-real-gpt55-cowork-gui.png)

![Tests and executions window](./screenshots/30-test-runner-window.png)

![Permission real flow](./screenshots/55-test-runner-permission-real-flow.png)

![Computer Use real desktop suite](./screenshots/108-test-runner-computer-use-real-suite.png)

## Re-run Public Documentation Guards

Run these before publishing new public documentation or captures:

```bash
npm run test:docs-public
```

This script runs the public documentation guards in `tests/docs/public-doc-links.test.ts`,
`tests/docs/public-doc-discoverability.test.ts`, and
`tests/docs/public-screenshot-privacy.test.ts`, plus the renderer checks in
`tests/docs/renderers.test.ts`.

The guards verify exact-case local links, relative screenshot references, real PNG files with minimum public-capture dimensions, and absence of obvious private strings in public docs or PNG metadata.
