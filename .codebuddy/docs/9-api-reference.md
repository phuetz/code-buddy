# CLI & API Reference

This reference documents the Code Buddy CLI interface and the underlying HTTP API surface. It is intended for developers integrating Code Buddy into existing workflows, managing agent deployments, or extending the platform's capabilities through custom tools and automation.

## CLI Subcommands

The CLI provides a comprehensive interface for interacting with the agent runtime, managing security, and orchestrating multi-agent workflows. Each subcommand maps to specific internal managers, ensuring that operations performed via the terminal are consistent with those executed through the API.

> **Key concept:** The CLI utilizes a modular command pattern where subcommands act as thin wrappers over core managers. This separation ensures that logic, such as `DMPairingManager.requiresPairing` checks, remains consistent whether triggered via CLI or API.

| Command | Description |
|---------|-------------|
| `buddy git` | Git operations with AI assistance |
| `buddy commit-and-push` | Generate AI commit message and push to remote |
| `buddy channels` | Manage channel connections (Telegram, Discord, Slack, etc.) |
| `buddy server` | Start the Code Buddy HTTP/WebSocket API server |
| `buddy mcp-server` | Start Code Buddy as an MCP server over stdio (for VS Code, Cursor, etc.) |
| `buddy provider` | Manage AI providers (Claude, ChatGPT, Grok, Gemini) |
| `buddy mcp` | Manage MCP (Model Context Protocol) servers |
| `buddy pipeline` | Manage and run pipeline workflows |
| `buddy pairing` | Manage DM pairing security (allowlist for messaging channel senders) |
| `buddy knowledge` | Manage agent knowledge bases (Knowledge.md files injected as context) |
| `buddy research` | Wide Research: spawn parallel agent workers to research a topic (Manus AI-inspired) |
| `buddy flow` | Execute a multi-agent planning flow (OpenManus-compatible): plan → execute → synthesize |
| `buddy todo` | Manage persistent task list (todo.md) — injected at end of every agent turn for focus |
| `buddy execpolicy` | Manage execution policy rules (allow/deny/ask/sandbox) for shell commands |
| `buddy lessons` | Manage lessons learned — self-improvement loop for recurring patterns (injected every turn) |
| `buddy update` | Update Code Buddy (switch channels: stable, beta, dev) |
| `buddy daemon` | Manage the Code Buddy daemon (background process) |
| `buddy trigger` | Manage event triggers for automated agent responses |
| `buddy speak` | Synthesize speech using AudioReader TTS |
| `buddy heartbeat` | Manage the heartbeat engine (periodic agent wake) |
| `buddy hub` | Skills marketplace (search, install, publish) |
| `buddy device` | Manage paired device nodes (SSH, ADB, local) |
| `buddy identity` | Manage agent identity files (SOUL.md, USER.md, etc.) |
| `buddy groups` | Manage group chat security |
| `buddy auth-profile` | Manage authentication profiles (API key rotation) |
| `buddy config` | Show environment variable configuration and validation |
| `buddy dev` | Golden-path developer workflows (plan, run, pr, fix-ci, explain) |
| `buddy run` | Inspect and replay agent runs (observability) |
| `buddy nodes` | Manage companion app nodes (macOS, iOS, Android) |
| `buddy secrets` | Manage API keys and credentials (encrypted vault) |
| `buddy approvals` | Manage tool/action approval requests |
| `buddy deploy` | Generate cloud deployment configurations (Fly, Railway, Render, Nix) |

For example, when managing secure communication channels, the `buddy pairing` command interfaces directly with `DMPairingManager.approve` to authorize senders, while `buddy device` leverages `DeviceNodeManager.pairDevice` to establish secure transport connections.

## CLI Options

The CLI options allow for granular control over the agent's runtime environment, security posture, and output formatting. These flags are processed during the initialization phase of the CLI application.

```mermaid
graph TD
    A[CLI / API Entry] --> B[Agent Core]
    B --> C[Memory Manager]
    B --> D[Tool Registry]
    B --> E[Device Manager]
    B --> F[Session Store]
    C --> F
    D --> G[MCP Servers]
    E --> H[Transport Layer]
```

When configuring the runtime, users can modify behavior using the following flags. Notably, when the `--probe-tools` flag is invoked, the system executes `CodeBuddyClient.probeToolSupport` to verify that the selected model can handle the required function calling capabilities before the agent starts.

| Flag | Description |
|------|-------------|
| `-d, --directory <dir>` | set working directory |
| `-k, --api-key <key>` | CodeBuddy API key (or set GROK_API_KEY env var) |
| `-u, --base-url <url>` | CodeBuddy API base URL (or set GROK_BASE_URL env var) |
| `-m, --model <model>` | AI model to use (e.g., grok-code-fast-1, grok-4-latest) (or set GROK_MODEL env var) |
| `-p, --prompt <prompt>` | process a single prompt and exit (headless mode, alias: --print) |
| `--print <prompt>` | alias for --prompt: process a single prompt and exit (headless mode) |
| `-b, --browser` | launch browser UI instead of terminal interface |
| `--max-tool-rounds <rounds>` | maximum number of tool execution rounds (default: 400) |
| `-s, --security-mode <mode>` | security mode: suggest (default), auto-edit, or full-auto |
| `-o, --output-format <format>` | output format for headless mode: json, stream-json, text, markdown |
| `--init` | initialize .codebuddy directory with templates and exit |
| `--dry-run` | preview changes without applying them (simulation mode) |
| `-c, --context <patterns>` | load specific files into context using glob patterns (e.g.,  |
| `--no-cache` | disable response caching |
| `--no-self-heal` | disable self-healing auto-correction |
| `--force-tools` | enable tools/function calling for local models (LM Studio) |
| `--probe-tools` | auto-detect tool support by testing the model at startup |
| `--plain` | use plain text output (minimal formatting) |
| `--no-color` | disable colored output |
| `--no-emoji` | disable emoji in output |

Beyond standard CLI flags, the system supports an extensible slash command architecture for in-chat interactions.

## Slash Commands

Slash commands provide a shortcut mechanism for common agent tasks, documentation generation, and system configuration. These commands are parsed by the input handler and routed to the appropriate internal module.

| File | Purpose |
|------|---------|
| `/builtins` | Built-in Slash Commands |
| `/docs` | /docs slash command — Generate DeepWiki-style documentation |
| `/index` | Slash Command Module |
| `/prompts` | /prompt Slash Commands |
| `/types` | Slash Command Types |

The slash command system is tightly integrated with the HTTP API, allowing for consistent behavior across both terminal and web-based interfaces.

## HTTP API Routes

The HTTP API exposes the core functionality of Code Buddy, enabling programmatic access to agent sessions, memory, and tool execution. This API is designed for high-concurrency environments and supports stateful session management.

The `sessions.ts` route is particularly critical for maintaining conversation state, as it utilizes `SessionStore.loadSession` and `SessionStore.saveSession` to ensure that context is persisted correctly across API requests.

| Route File | Endpoints |
|------------|----------|
| `a2a-protocol.ts` | GET /.well-known/agent.json, GET /agents, POST /tasks/send, GET /tasks/:id |
| `canvas.ts` | N/A |
| `chat.ts` | POST / |
| `health.ts` | N/A |
| `index.ts` | N/A |
| `memory.ts` | GET /, POST / |
| `metrics.ts` | GET /, GET /json, GET /snapshot, GET /history, GET /dashboard |
| `sessions.ts` | GET / |
| `tools.ts` | GET /, GET /categories |
| `workflow-builder.ts` | N/A |

---

**See also:** [Architecture](./2-architecture.md) · [Subsystems](./3-subsystems.md) · [Tool System](./5-tools.md) · [Security](./6-security.md)

--- END ---