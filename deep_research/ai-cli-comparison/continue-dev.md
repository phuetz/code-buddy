# Continue

## Overview

Continue is an open-source AI coding assistant that integrates with VS Code and JetBrains IDEs. It offers both CLI (TUI mode) and headless operation for background agents, with strong emphasis on model flexibility and team configuration.

**Repository:** https://github.com/continuedev/continue
**Stars:** 30.2k | **Forks:** 3.9k | **License:** Apache-2.0
**Primary Language:** TypeScript (83.7%)

---

## Key Unique Features

### 1. Three Deployment Modes
- **Cloud Agents**: Background automation triggered by PR events, schedules, hooks
- **CLI/TUI Mode**: Interactive terminal with step-by-step approval
- **IDE Agents**: Direct VS Code/JetBrains integration

### 2. Three Interaction Modes
- **Chat**: Conversational code assistance
- **Plan**: Refactoring strategy development
- **Agent**: Multi-file autonomous changes

### 3. Model Flexibility
- Switch between AI providers freely
- Run local models for privacy
- No vendor lock-in
- Support for GPT-4o, Claude 3 Opus/Sonnet, Qwen, and more

### 4. Team-Ready Configuration
- Shareable configs for consistent coding standards
- Consistent AI behavior across teams
- Enterprise-focused features

### 5. Battle-Tested Workflows
- Pre-built integrations: GitHub, Sentry, Snyk, Linear
- Customizable prompts, models, MCP tools
- Deploy anywhere: bash scripts, CI/CD, cron

---

## Tool Implementations

### Core Features
- Inline code suggestions (autocomplete)
- Multi-file editing
- Natural language task requests
- Code explanation
- Refactoring assistance

### Automation Tools
- GitHub API integration for PR automation
- Background agent workflows
- CI/CD deployment (GitHub Actions, Jenkins, GitLab CI)
- Scheduled automation via cron

---

## Configuration Options

### Installation
```bash
npm i -g @continuedev/cli
cn  # Launch Continue
```

### Configuration Best Practices
- **Context Awareness**: Configure AI to analyze entire project files
- **AI Preferences**: Adjust verbosity, completion style, debugging level
- **Version Control**: Track AI-generated changes before committing
- **Team Configs**: Share configurations for consistent standards

---

## Security Features

| Feature | Description |
|---------|-------------|
| Local execution | Code never leaves network |
| Air-gapped deployment | Maximum security option |
| Local LLM support | Complete offline operation |
| CODE_OF_CONDUCT.md | Community standards |
| SECURITY.md | Security policies |
| CLA requirement | Contributor agreements |

---

## Integration Capabilities

- **VS Code**: Marketplace extension
- **JetBrains**: Plugin for IntelliJ, PyCharm, WebStorm
- **GitHub**: PR automation, API integration
- **Sentry**: Error monitoring integration
- **Snyk**: Security scanning
- **Linear**: Issue tracking
- **Discord**: Community platform
- **Multiple LLM Providers**: OpenAI, Gemini, Claude, Qwen

---

## UI/UX Patterns

- IDE-native experience
- Chat, Plan, and Agent mode switching
- Step-by-step approval in TUI
- Inline autocomplete suggestions
- Multi-file edit preview
- Independent accept/reject per file

---

## Performance Optimizations

- Local caching of context
- Offline operation with local LLMs
- Efficient autocomplete with tab completion
- Background agent processing
- Multi-platform support

---

## Privacy and Offline Support

- **Air-gapped operation**: Deploy entirely offline
- **Local LLM support**: No internet required for AI
- **Cloud models**: Internet needed only for API requests
- **Local context caching**: Extension works offline

---

## Notable Differentiators

1. **Three deployment modes** - Cloud, CLI, IDE
2. **IDE-first design** - Native VS Code/JetBrains integration
3. **Team configuration** - Shareable, consistent AI behavior
4. **Battle-tested workflows** - GitHub, Sentry, Snyk, Linear
5. **Air-gapped support** - Maximum privacy option
6. **Multi-file approval** - Independent accept/reject per file

---

## Workflow Examples

### Agent Mode Request
```
"Set the @typescript-eslint/naming-convention rule to 'off'
for all eslint configurations in this project."
```

### Multi-File Edit
- Code to Edit shows multiple files/ranges
- Edit model outputs codeblocks per file
- User applies and accepts/rejects independently

---

## Sources
- [GitHub Repository](https://github.com/continuedev/continue)
- [Continue Documentation](https://docs.continue.dev/)
- [Continue Website](https://www.continue.dev/)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Continue.continue)
