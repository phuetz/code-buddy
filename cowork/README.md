<p align="center">
  <img src="public/logo.png" alt="Code Buddy Cowork Logo" width="280" />
</p>

<h1 align="center">Code Buddy Cowork: Desktop Cockpit for Code Buddy</h1>

<p align="center">
  ChatGPT OAuth • Embedded Code Buddy Engine • Real QA Evidence
</p>

<p align="center">
  <a href="./README_zh.md">中文文档</a> •
  <a href="#features">Features</a> •
  <a href="#verified-evidence">Evidence</a> •
  <a href="#installation">Downloads</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#core-engine">Core Engine</a> •
  <a href="#skills">Skills Library</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  <img src="https://img.shields.io/badge/Node.js-22+-brightgreen" alt="Node.js" />
</p>

---

## 📖 Introduction

**Code Buddy Cowork** is the Electron desktop cockpit for the Code Buddy CLI, server, Fleet hub, and Buddy companion. It runs the embedded Code Buddy core engine by default, so desktop chat, tools, traces, workflows, settings, permissions, models, MCP connectors, skills, artifacts, and companion controls all use the same agentic loop as the terminal.

It provides a sandboxed workspace where AI can manage files, generate professional outputs, run real verification suites from the **Tests & executions** panel, and connect to local or remote tooling through MCP and Fleet.

> [!WARNING]
> **Disclaimer**: Code Buddy Cowork is an AI collaboration tool. Please exercise caution with its operations, especially when authorizing file modifications or deletions. We support VM-based sandbox isolation, but some operations may still carry risks.

---

<a id="features"></a>
## ✨ Key Features

- **ChatGPT subscription login**: use `buddy login` once, then Cowork can route through ChatGPT OAuth-backed `gpt-5.5` without exposing API keys in public docs or screenshots.
- **Flexible model support**: OpenAI-compatible APIs, Claude, Grok, Gemini, Ollama, LM Studio, OpenRouter, vLLM, Copilot, Mistral, and other providers supported by the Code Buddy core.
- **Embedded engine**: Cowork uses the built Code Buddy bundle by default and can fall back to the legacy runner when explicitly configured.
- **Remote control and Fleet**: coordinate peers, scheduled work, command-center boards, and cross-surface workflows.
- **GUI operation**: drive desktop applications and validate Computer Use flows through opt-in real suites.
- **Smart file management**: read, write, organize, and attach files within the selected workspace.
- **Skills system**: built-in workflows for PPTX, DOCX, PDF, XLSX generation and processing, plus custom skill creation.
- **MCP external service support**: integrate browsers, local transports, Notion, custom apps, and other tools through **MCP Connectors**.
- **Multimodal Input**: Drag & drop files and images directly into the chat input for seamless multimodal interaction.
- **Real-time Trace**: Watch AI reasoning and tool execution in the Trace Panel.
- **Secure Workspace**: All operations confined to your chosen workspace folder.
- **VM-Level Isolation**: WSL2 (Windows) and Lima (macOS) VM isolation—all commands execute in an isolated VM to protect your host system.
- **Tests & executions**: launch safe local bundles, opt-in real ChatGPT, Docker, Computer Use, Fleet, MCP, and companion checks from the desktop app, with execution history.

<a id="verified-evidence"></a>
## Verified Real-Use Evidence

The step-by-step user guide is available in [`../docs/cowork-user-guide.md`](../docs/cowork-user-guide.md), with a French version in [`../docs/cowork-guide-fr.md`](../docs/cowork-guide-fr.md). The public QA dossier is available in [`../docs/qa/code-buddy-studio/feature-qa.md`](../docs/qa/code-buddy-studio/feature-qa.md). It documents non-mocked Cowork, Electron, Playwright, CLI, HTTP server, ChatGPT OAuth `gpt-5.5`, MCP, Fleet, Docker, permission, and Computer Use flows. Screenshots are scrubbed for private account, token, and local path data before publication.

![Cowork ChatGPT gpt-5.5 real run](../docs/qa/code-buddy-studio/screenshots/29-real-gpt55-cowork-gui.png)

![Tests and executions window](../docs/qa/code-buddy-studio/screenshots/30-test-runner-window.png)

![Permission real flow from the runner](../docs/qa/code-buddy-studio/screenshots/55-test-runner-permission-real-flow.png)

![Computer Use real desktop suite](../docs/qa/code-buddy-studio/screenshots/108-test-runner-computer-use-real-suite.png)

Privacy guardrails are enforced by [`../tests/docs/public-screenshot-privacy.test.ts`](../tests/docs/public-screenshot-privacy.test.ts), public link casing is enforced by [`../tests/docs/public-doc-links.test.ts`](../tests/docs/public-doc-links.test.ts), and guide/evidence discoverability is enforced by [`../tests/docs/public-doc-discoverability.test.ts`](../tests/docs/public-doc-discoverability.test.ts).

<a id="demo"></a>
## Demo

The older demo videos remain useful for broad workflow shape: folder organization, PPT/XLSX generation, GUI operation, and remote control. The verified screenshots above are the current source-of-truth for this repository.

---

<a id="installation"></a>
## 📦 Installation

### Option 1: Build from Source

For developers and reviewers, the source path is the authoritative GitHub flow:

```bash
git clone https://github.com/phuetz/code-buddy.git
cd code-buddy
npm install
npm run build
npm run dev:gui
```

Cowork's own package is under `cowork/`. From there, use `npm run dev` for the Vite + Electron loop, `npm test` for Vitest, and `npm run test:e2e` for Playwright.

### Option 2: Packaged Installers

Packaged Windows and macOS builds may be published from this repository's release pipeline. Until a release is attached, use the source build above so the desktop app matches the current Code Buddy core.

### Security Configuration: 🔒 Sandbox Support

Code Buddy Cowork provides **multi-level sandbox protection** to keep your system safe:

| Level | Platform | Technology | Description |
|-------|----------|------------|-------------|
| **Basic** | All | Path Guard | File operations restricted to workspace folder |
| **Enhanced** | Windows | WSL2 | Commands execute in isolated Linux VM |
| **Enhanced** | macOS | Lima | Commands execute in isolated Linux VM |

- **Windows (WSL2)**: When WSL2 is detected, all Bash commands are automatically routed to a Linux VM. The workspace is synced bidirectionally.
- **macOS (Lima)**: When [Lima](https://lima-vm.io/) is installed (`brew install lima`), commands run in an Ubuntu VM with `/Users` mounted.
- **Fallback**: If no VM is available, commands run natively with path-based restrictions.

**Setup (Optional, Recommended)**

- **Windows**: WSL2 is auto-detected if installed. [Install WSL2](https://docs.microsoft.com/en-us/windows/wsl/install)

- **macOS**:
Lima is auto-detected if installed. Install command:
```bash
brew install lima
# Code Buddy Cowork can automatically create and manage a local sandbox VM
```

---

<a id="quick-start"></a>
## 🚀 Quick Start Guide

### 1. Authenticate a Model

Recommended for flat-fee ChatGPT plans:

```bash
buddy login
buddy whoami
```

Cowork also supports API-key providers through Settings. Use this path for OpenRouter, Anthropic, local OpenAI-compatible gateways, Ollama, LM Studio, and other Code Buddy providers.

| Provider | Get Key / Coding Plan | Base URL (Required) | Recommended Model |
|----------|-----------------------|---------------------|-------------------|
| **ChatGPT OAuth** | `buddy login` | `https://chatgpt.com/backend-api/codex` | `gpt-5.5` |
| **OpenRouter** | [OpenRouter](https://openrouter.ai/) | `https://openrouter.ai/api` | `claude-4-5-sonnet` |
| **Anthropic** | [Anthropic Console](https://console.anthropic.com/) | (Default) | `claude-4-5-sonnet` |
| **Zhipu AI (GLM)** | [GLM Coding Plan](https://bigmodel.cn/glm-coding) | `https://open.bigmodel.cn/api/anthropic` | `glm-4.7`, `glm-4.6` |
| **MiniMax** | [MiniMax Coding Plan](https://platform.minimaxi.com/subscribe/coding-plan) | `https://api.minimaxi.com/anthropic` | `minimax-m2` |
| **Kimi** | [Kimi Coding Plan](https://www.kimi.com/membership/pricing) | `https://api.kimi.com/coding/` | `kimi-k2` |

### 2. Start the Desktop App

```bash
npm run dev:gui
```

For server-backed workflows:

```bash
buddy server --port 3000
```

Then open Settings in Cowork, select the provider/profile, and confirm backend health.

### 3. Start Coworking
1. **Select a Workspace**: Choose a folder where Code Buddy is allowed to work.
2. **Enter a Prompt**:
   > "Read the financial_report.csv in this folder and create a PowerPoint summary with 5 slides."
3. Open **Tests & executions** when you need to prove a flow against real local infrastructure before publishing results.

<a id="core-engine"></a>
## Core Engine Runner

Cowork now runs on the embedded **Code Buddy core engine** by default. This is
the same agentic loop used by the terminal CLI, so Cowork inherits the core
middlewares, transcript repair, output sanitizer, MCP routing, skills reload,
and model hot-swap behavior.

- **Default path**: Auto mode uses the embedded engine when the built bundle is
  available.
- **Fallback path**: the legacy `pi-coding-agent` runner is still available when
  the engine bundle is missing or when `CODEBUDDY_EMBEDDED=0` is set.
- **Visibility**: the titlebar runner badge shows whether the active process is
  using the engine or pi fallback. Settings -> Core engine lets you choose Auto,
  Always on, or Always off.
- **Active turns**: prompts are serialized per session by `SessionManager`.
  The Stop button cancels an active run; normal follow-up prompts can queue
  intentionally, and Cowork does not expose a regenerate action while a turn is
  already active.

See [`RUNNER_AUDIT.md`](./RUNNER_AUDIT.md) for the engine-vs-pi parity matrix
and deprecation notes.

### 📝 Important Notes

1. **macOS installation**: If a packaged DMG is used and macOS shows a security warning, go to **System Settings > Privacy & Security** and click **Open Anyway**.
2. **Network access**: For tools like `WebSearch`, you may need to enable "Virtual Network Interface" (TUN Mode) in your proxy settings to ensure connectivity.
3. **Notion connector**: Besides setting the integration token, you also need to add connections in a root page. See https://www.notion.com/help/add-and-manage-connections-with-the-api for more details.
---

<a id="skills"></a>
## 🧰 Skills Library

Code Buddy Cowork ships with bundled skills through the Code Buddy core and supports user-added custom skills, including:
- `pptx` for PowerPoint generation
- `docx` for Word document processing
- `pdf` for PDF handling and forms
- `xlsx` for Excel spreadsheet support
- `skill-creator` for creating custom skills

---

## 🏗️ Architecture

```
code-buddy/cowork/
├── src/
│   ├── main/                    # Electron Main Process (Node.js)
│   │   ├── index.ts             # Main entry point
│   │   ├── runner/              # Embedded Code Buddy runner integration
│   │   ├── config/              # Configuration management
│   │   │   └── config-store.ts  # Persistent settings storage
│   │   ├── db/                  # Database layer
│   │   │   └── database.ts      # SQLite/data persistence
│   │   ├── ipc/                 # IPC handlers
│   │   ├── memory/              # Memory management
│   │   │   └── memory-manager.ts
│   │   ├── sandbox/             # Security & Path Resolution
│   │   │   └── path-resolver.ts # Sandboxed file access
│   │   ├── session/             # Session management
│   │   │   └── session-manager.ts
│   │   ├── skills/              # Skill Loader & Manager
│   │   │   └── skills-manager.ts
│   │   └── tools/               # Tool execution
│   │       └── tool-executor.ts # Tool call handling
│   ├── preload/                 # Electron preload scripts
│   │   └── index.ts             # Context bridge setup
│   └── renderer/                # Frontend UI (React + Tailwind)
│       ├── App.tsx              # Root component
│       ├── main.tsx             # React entry point
│       ├── components/          # UI Components
│       │   ├── ChatView.tsx     # Main chat interface
│       │   ├── ConfigModal.tsx  # Settings dialog
│       │   ├── ContextPanel.tsx # File context display
│       │   ├── MessageCard.tsx  # Chat message component
│       │   ├── PermissionDialog.tsx
│       │   ├── Sidebar.tsx      # Navigation sidebar
│       │   ├── Titlebar.tsx     # Custom window titlebar
│       │   ├── TracePanel.tsx   # AI reasoning trace
│       │   └── WelcomeView.tsx  # Onboarding screen
│       ├── hooks/               # Custom React hooks
│       │   └── useIPC.ts        # IPC communication hook
│       ├── store/               # State management
│       │   └── index.ts
│       ├── styles/              # CSS styles
│       │   └── globals.css
│       ├── types/               # TypeScript types
│       │   └── index.ts
│       └── utils/               # Utility functions
├── public/                      # Static assets used by Vite/README
├── electron-builder.yml         # Build configuration
├── vite.config.ts               # Vite bundler config
└── package.json                 # Dependencies & scripts
```

---

## 🗺️ Roadmap

- [x] **Core**: Stable Windows & macOS Installers
- [x] **Security**: Full Filesystem Sandboxing
- [x] **Skills**: PPTX, DOCX, PDF, XLSX Support + Custom Skill Management
- [x] **VM Sandbox**: WSL2 (Windows) and Lima (macOS) isolation support
- [x] **MCP Connectors**: Custom connector support for external service integration
- [x] **Rich Input**: File upload and image input in chat
- [x] **Multi-Model**: ChatGPT OAuth and OpenAI-compatible API support
- [x] **UI/UX**: Enhanced interface with English/Chinese localization
- [x] **Memory Optimization**: Improved context management for longer sessions and cross-session memory.
- [x] **Real QA Runner**: desktop launch surface for safe and opt-in real suites
- [ ] **Release Packaging**: keep installers aligned with the current embedded Code Buddy engine

---

## 🛠️ Contributing

We welcome contributions! Whether it's a new Skill, a UI fix, or a security improvement:

1. Fork the repo.
2. Create a branch (`git checkout -b feature/NewSkill`).
3. Submit a PR.

---

## 💬 Community

Use GitHub issues and pull requests in the main repository for support and discussion.

---

## 📄 License

MIT © Code Buddy

---

<p align="center">
  Made by the Code Buddy community.
</p>
