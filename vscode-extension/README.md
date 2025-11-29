# Grok CLI VS Code Extension

Bring the power of Grok CLI directly into Visual Studio Code.

## Features

### 🤖 AI Chat Sidebar
- Chat with Grok directly in VS Code
- Streaming responses for real-time feedback
- Context-aware conversations

### 💡 Code Actions
- **Explain**: Select code and ask Grok to explain it
- **Refactor**: Get AI-powered refactoring suggestions
- **Fix**: Automatically fix issues in your code
- **Generate Tests**: Create unit tests for selected code
- **Optimize**: Get performance optimization suggestions
- **Add Documentation**: Generate documentation for functions

### 🔍 AI Code Review
- Automatic code review on save (optional)
- Issues appear in the Problems panel
- Quick fixes for detected issues
- Covers bugs, security, and best practices

### ✨ Inline Completions
- Context-aware code completions
- Works as you type
- Intelligent caching for performance

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Grok CLI"
4. Click Install

### From Source
```bash
cd vscode-extension
npm install
npm run compile
# Press F5 to launch extension development host
```

## Configuration

### API Key
Set your Grok API key in one of these ways:
1. VS Code Settings: `grok.apiKey`
2. Environment variable: `GROK_API_KEY`

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `grok.apiKey` | Grok API key | `""` |
| `grok.model` | Model to use | `"grok-3-latest"` |
| `grok.autoReview` | Auto-review on save | `false` |
| `grok.inlineCompletions` | Enable inline completions | `true` |
| `grok.maxTokens` | Max tokens per request | `4096` |
| `grok.autonomyLevel` | Autonomy level | `"confirm"` |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+G` / `Cmd+Shift+G` | Open Grok Chat |
| `Ctrl+K` / `Cmd+K` | Inline Edit |
| `Ctrl+Shift+E` / `Cmd+Shift+E` | Explain Selection |

## Context Menu

Right-click on selected code to access:
- Explain with Grok
- Refactor with Grok
- Fix with Grok
- Generate Tests with Grok

## Requirements

- VS Code 1.85.0 or higher
- Grok API key from [X.AI](https://x.ai)

## Known Issues

- Large files may take longer to review
- Inline completions require stable network connection

## Release Notes

### 0.1.0
- Initial release
- Chat sidebar
- Code actions (explain, refactor, fix, generate tests)
- AI code review
- Inline completions

## License

MIT License - see [LICENSE](../LICENSE) for details.
