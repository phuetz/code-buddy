# Code Buddy VS Code Extension

A VS Code extension that connects to the CodeBuddy HTTP server to provide AI-assisted coding directly in your editor.

## Prerequisites

- CodeBuddy CLI installed and configured
- CodeBuddy server running (`buddy server start` or `buddy daemon start`)

## Features

- **Chat Panel**: Sidebar chat interface connected to CodeBuddy's AI
- **Ask About Selection**: Select code and ask questions about it
- **Review File**: Get an AI review of the current file

## Setup

1. Install the extension
2. Start the CodeBuddy server: `buddy server start`
3. The extension auto-connects to `http://localhost:3000` by default

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `codebuddy.serverUrl` | `http://localhost:3000` | CodeBuddy server URL |
| `codebuddy.autoConnect` | `true` | Auto-connect on startup |

## Commands

- **Code Buddy: Open Chat** - Open the chat panel
- **Code Buddy: Ask About Selection** - Ask a question about selected code
- **Code Buddy: Review Current File** - Request an AI review of the active file

## Development

```bash
cd extensions/vscode
npm install
npm run compile    # Build once
npm run watch      # Watch mode
```

Press `F5` in VS Code to launch an Extension Development Host for testing.
