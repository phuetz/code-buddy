# GitHub Copilot CLI

## Overview

GitHub Copilot in the CLI was a GitHub CLI extension providing terminal-based AI assistance. Note: This tool was **deprecated on October 25, 2025** in favor of a successor tool with expanded agentic capabilities.

**Repository:** https://github.com/github/gh-copilot
**Status:** Deprecated (October 2025)
**Successor:** GitHub Copilot CLI (new agentic version)

---

## Key Features (Deprecated Version)

### Primary Commands
- **`gh copilot suggest`**: Generate command recommendations from natural language
- **`gh copilot explain`**: Break down existing commands for understanding

### Shell Aliases (v1.0.0+)
- `ghcs` - Quick suggest alias
- `ghce` - Quick explain alias
- Support for Bash, Zsh, PowerShell

---

## Configuration Options

### Alias Setup
```bash
# Bash
echo 'eval "$(gh copilot alias -- bash)"' >> ~/.bashrc

# Zsh
echo 'eval "$(gh copilot alias -- zsh)"' >> ~/.zshrc

# PowerShell
# Custom profile configuration
```

### Settings via `gh copilot config`
- Optional usage analytics participation
- Command execution confirmation behavior

### Multi-Account Support
- `--hostname` flag for different GitHub instances
- `GH_HOST` environment variable

---

## Security Features

| Feature | Description |
|---------|-------------|
| Subscription required | Active GitHub Copilot subscription |
| OAuth authentication | `gh auth login --web` |
| Analytics opt-out | User-controllable telemetry |
| No query content transmission | Only aggregate metrics sent |

### Analytics Data (Transmitted)
- Platform
- Architecture
- Version
- Event type
- Thread IDs
- **NOT** query content

---

## Authentication Requirements

- Active GitHub Copilot subscription (Individual, Business, Enterprise)
- GitHub CLI installation
- OAuth app authentication
- Classic and fine-grained PATs not supported

---

## Limitations

- No 32-bit Android distribution support
- Deprecated in favor of new agentic CLI
- Limited to suggest/explain functionality
- Not a full agentic coding tool

---

## Relevance to grok-cli

The deprecated Copilot CLI represents the "previous generation" of AI CLI tools with limited suggest/explain functionality. The industry has moved toward full agentic capabilities that grok-cli already implements.

### Lessons Learned
1. Simple suggest/explain is insufficient for modern needs
2. Shell aliases improve UX significantly
3. Privacy controls (analytics opt-out) are essential
4. Multi-account support matters for enterprise

---

## Sources
- [GitHub Repository](https://github.com/github/gh-copilot)
- GitHub Copilot Documentation
