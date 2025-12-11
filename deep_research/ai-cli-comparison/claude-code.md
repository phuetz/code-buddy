# Claude Code (Anthropic)

## Overview

Claude Code is Anthropic's official agentic coding tool that operates in the terminal. It enables developers to delegate coding tasks through natural language commands, understanding entire codebases without manual context selection.

**Repository:** https://github.com/anthropics/claude-code
**Stars:** 45.4k | **Forks:** 3.2k | **License:** MIT

---

## Key Unique Features

### 1. Advanced Sandboxing System
- **OS-level enforcement** using Linux bubblewrap and macOS seatbelt
- **Filesystem isolation**: Read/write access limited to current working directory
- **Network isolation**: Internet access only through Unix domain socket proxy
- **Permission prompt reduction**: 84% fewer prompts with sandboxing enabled
- **Prompt injection protection**: Compromised sessions cannot steal SSH keys or contact attacker servers

### 2. Security Review Integration
- `/security-review` command for ad-hoc security analysis before commits
- GitHub Action for automated security vulnerability detection
- Used internally by Anthropic to secure production code

### 3. Plugin System (Public Beta)
- Install via `/plugin` command
- Works across terminal and VS Code
- Example plugins: PR reviews, security guidance, SDK development
- Meta-plugin for creating new plugins

### 4. Multi-Interface Support
- Terminal CLI (primary)
- IDE integration (VS Code, JetBrains)
- GitHub integration (tag @claude in issues/PRs)
- Web version with session sharing via URL

### 5. Conversation Checkpointing
- Save and resume complex sessions
- Session sharing for team collaboration

---

## Tool Implementations

### Core Tools
- File operations (read, write, search)
- Shell command execution
- Git operations with natural language
- Multi-file coordinated changes
- Code explanation and analysis

### Built-in Commands
- `/bug` - Report issues directly
- `/security-review` - Run security analysis
- `/plugin` - Manage plugins

---

## Configuration Options

### Project Configuration
- `.claude/` directory for project settings
- `.claude/commands/` for custom commands
- `.claude-plugin/` for plugin configuration

### Privacy Settings
- 30-day data retention (configurable for Enterprise)
- Data never used for model training
- Zero-log options for sensitive environments

---

## Security Features

| Feature | Description |
|---------|-------------|
| OS-level sandboxing | bubblewrap (Linux) / seatbelt (macOS) |
| Network proxy | Controlled domain access with approval |
| Filesystem isolation | Working directory restrictions |
| Prompt injection protection | Isolated session execution |
| Data retention controls | Enterprise-configurable retention |
| Security scanning | Built-in vulnerability detection |

---

## Integration Capabilities

- **VS Code**: Native extension
- **JetBrains IDEs**: Plugin support
- **GitHub**: @claude mentions in issues/PRs
- **MCP (Model Context Protocol)**: External tool integration
- **Discord**: Community support

---

## UI/UX Patterns

- Natural language interface
- Real-time streaming responses
- Permission confirmation dialogs (reduced by sandboxing)
- Session sharing URLs
- Cross-platform consistency (CLI/Web/IDE)

---

## Performance Optimizations

- Codebase understanding without manual context selection
- Intelligent context compression
- Session caching and checkpointing
- Sandbox-enabled autonomous operation

---

## Notable Differentiators

1. **Industry-leading sandboxing** with 84% permission prompt reduction
2. **GitHub Action integration** for automated security reviews
3. **Plugin ecosystem** with public beta access
4. **Web version** with zero-setup collaboration
5. **Enterprise-grade privacy** with configurable retention

---

## Sources
- [GitHub Repository](https://github.com/anthropics/claude-code)
- [Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Security Reviews with Claude Code](https://claude.com/blog/automate-security-reviews-with-claude-code)
- [Claude Code Plugins](https://www.anthropic.com/news/claude-code-plugins)
