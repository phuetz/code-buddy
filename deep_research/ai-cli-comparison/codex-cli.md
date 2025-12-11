# Codex CLI (OpenAI)

## Overview

Codex CLI is OpenAI's local, terminal-based coding agent that enables developers to execute tasks through natural language prompts. It features a sophisticated sandboxing system with configurable approval policies.

**Repository:** https://github.com/openai/codex
**Stars:** 52.3k | **Forks:** 6.7k | **License:** Apache-2.0
**Primary Language:** Rust (97.5%)

---

## Key Unique Features

### 1. Three-Tier Sandbox System
- **Read-only**: Only permits reading files
- **Workspace-write**: Write limited to active workspace, no network access
- **Danger-full-access**: No filesystem sandboxing

### 2. Execpolicy Framework
- Granular command authorization rules
- TUI can whitelist command prefixes after approval
- Sandbox denials propose amendments users can accept
- Shell MCP follows same execpolicy rules

### 3. Approval Policy Modes
- **Untrusted**: Escalates most commands for approval (limited allowlist)
- **On-failure**: Commands run in sandbox, failures escalated
- **On-request**: Sandbox by default, tool calls can request escalation

### 4. Platform-Specific Sandboxing
- **macOS**: Seatbelt policies
- **Linux**: seccomp + Landlock (v5.13+) for filesystem access control

### 5. Enterprise Management
- Managed configuration layer
- Organizational policies override user settings
- Settings reapplied on restart

---

## Tool Implementations

### Core Tools
- File read/write operations
- Shell command execution with sandboxing
- Non-interactive mode via `codex exec`

### Integration Tools
- GitHub Actions (codex-action)
- TypeScript SDK for programmatic usage
- Slack integration
- MCP server integration

---

## Configuration Options

### Config File: `~/.codex/config.toml`

```toml
[approval_policy]
# Options: untrusted, on-failure, on-request

[network_access]
# Options: restricted, enabled

[sandbox]
# --add-dir flag for additional writable directories
```

### Key Configuration Areas
- MCP server definitions
- Custom prompt definitions
- Execution policy rules
- Model selection preferences
- Workspace-specific settings

---

## Security Features

| Feature | Description |
|---------|-------------|
| Sandbox modes | Read-only, workspace-write, full-access |
| Execpolicy | Granular command authorization |
| Landlock | Linux filesystem access control |
| Seatbelt | macOS sandbox policies |
| seccomp | Linux system call filtering |
| Network sandboxing | Controlled network access |
| ZDR (Zero Data Retention) | Optional data non-storage |

---

## Integration Capabilities

- **IDE Extensions**: VS Code, Cursor, Windsurf
- **GitHub Actions**: codex-action for CI/CD
- **MCP Protocol**: External tool connections
- **TypeScript SDK**: Programmatic access
- **Multi-account support**: `--hostname` flag / `GH_HOST` env

---

## UI/UX Patterns

- Interactive terminal interface
- Non-interactive mode (`codex exec`)
- TUI whitelisting after approvals
- Amendment proposals for sandbox denials
- Verbose logging and tracing

---

## Performance Optimizations

- Rust implementation (97.5% of codebase)
- Multi-workspace project structure
- Efficient sandbox enforcement at OS level
- Binary downloads for multiple platforms

---

## Authentication Options

1. **ChatGPT Account**: Primary method for Plus/Pro/Team/Edu/Enterprise
2. **API Key**: Alternative with separate configuration
3. **OAuth**: "Sign in with ChatGPT" option

---

## Notable Differentiators

1. **Most sophisticated approval system** with three policy modes
2. **Execpolicy framework** for granular command control
3. **Rust implementation** for performance
4. **Enterprise managed config** layer
5. **Zero Data Retention** option
6. **Landlock + seccomp** on Linux for defense-in-depth

---

## Recent Updates (December 2025)

- Version 0.66.0 (December 9, 2025)
- TUI command prefix whitelisting
- Sandbox denial amendment proposals
- Shell MCP execpolicy enforcement

---

## Sources
- [GitHub Repository](https://github.com/openai/codex)
- [Codex Security Guide](https://developers.openai.com/codex/security/)
- [Sandboxing and Security Policies](https://deepwiki.com/openai/codex/6.3-configuration-management)
- [Configuring Codex](https://developers.openai.com/codex/local-config/)
