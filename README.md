<div align="center">

# Grok CLI

### AI-Powered Development Agent for Your Terminal

[![npm version](https://img.shields.io/npm/v/@phuetz/grok-cli.svg?style=flat-square)](https://www.npmjs.com/package/@phuetz/grok-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![npm downloads](https://img.shields.io/npm/dm/@phuetz/grok-cli.svg?style=flat-square)](https://www.npmjs.com/package/@phuetz/grok-cli)

**A powerful CLI tool that brings Grok AI directly to your terminal with Claude Code-level intelligence, advanced code analysis, and comprehensive development capabilities.**

[Installation](#-installation) •
[Features](#-features) •
[Usage](#-usage) •
[Code Intelligence](#-code-intelligence) •
[Contributing](#-contributing)

</div>

---

## Overview

Grok CLI is a conversational AI development agent that transforms your terminal into an intelligent coding assistant. It combines the power of Grok AI with sophisticated code intelligence tools, enabling developers to analyze, refactor, and manage codebases with unprecedented efficiency.

---

## Quick Start

```bash
# Run without installing
npx @phuetz/grok-cli@latest

# Or install globally
npm install -g @phuetz/grok-cli

# Start interactive mode
grok

# Or run a single command (headless mode)
grok --prompt "analyze the project structure"
```

---

## Features

### AI Agent Capabilities

| Feature | Description |
|---------|-------------|
| **Agentic Loop** | Up to 30 rounds of autonomous tool usage for complex tasks |
| **Real-time Streaming** | Progressive response generation with instant feedback |
| **Multi-Model Support** | Grok-4, Grok-3, Gemini, Claude via custom endpoints |
| **Token Tracking** | Real-time token counting with tiktoken |

### Code Intelligence

Grok CLI includes a comprehensive code intelligence suite inspired by Claude Code:

| Tool | Capabilities |
|------|--------------|
| **AST Parser** | Multi-language parsing (TypeScript, JavaScript, Python, Go) with caching |
| **Symbol Search** | Fuzzy search with Levenshtein distance matching across codebases |
| **Dependency Analyzer** | Circular dependency detection, unreachable file finder, dependency graphs |
| **Code Context** | Semantic analysis, quality metrics, design pattern detection |
| **Refactoring Assistant** | Safe rename, extract function/variable, inline, move operations |

### Advanced Tools

| Tool | Description |
|------|-------------|
| **Multi-File Editor** | Atomic transactional editing with automatic rollback |
| **Operation History** | Full undo/redo with persistence to disk |
| **Plan Generator** | Structured planning with phases and validation |
| **Codebase Explorer** | Project analysis, statistics, tree visualization |

### Core Tools

| Tool | Description |
|------|-------------|
| **view_file** | View files and directories with line ranges |
| **create_file** | Create files with automatic parent directory creation |
| **str_replace_editor** | Intelligent text editing with fuzzy matching and visual diffs |
| **bash** | Execute shell commands with persistent cd and timeout |
| **search** | Ultra-fast search with ripgrep backend |
| **todo_list** | Task management with priorities and status tracking |

### UI Components

Enhanced terminal UI with professional styling:

- 10 animated spinner styles (dots, braille, moon, earth, etc.)
- Progress bars with percentage display
- Step progress indicators
- Status indicators (success, error, warning, info)
- Info panels and tooltips
- Data tables and badges
- Countdown timers

---

## Code Intelligence

### AST Parser

Multi-language Abstract Syntax Tree parsing with intelligent caching:

```typescript
import { getASTParser } from '@phuetz/grok-cli';

const parser = getASTParser();
const result = await parser.parseFile('src/index.ts');

// Access symbols, imports, exports
console.log(result.symbols);  // Functions, classes, variables
console.log(result.imports);  // All import statements
console.log(result.exports);  // All exports
```

**Supported Languages:**
- TypeScript (.ts, .tsx)
- JavaScript (.js, .jsx)
- Python (.py)
- Go (.go)

### Symbol Search

Fuzzy symbol search across your entire codebase:

```typescript
import { getSymbolSearch } from '@phuetz/grok-cli';

const search = getSymbolSearch();
await search.buildIndex('src/');

// Find symbols matching a query
const results = search.search('handleUser', {
  fuzzyThreshold: 0.6,
  maxResults: 10,
  types: ['function', 'class']
});

// Find all usages of a symbol
const usages = await search.findUsages('UserService');
```

### Dependency Analyzer

Detect circular dependencies and analyze project structure:

```typescript
import { getDependencyAnalyzer } from '@phuetz/grok-cli';

const analyzer = getDependencyAnalyzer();
const result = await analyzer.analyze('src/');

// Check for circular dependencies
console.log(result.circularDependencies);

// Find unreachable files
console.log(result.unreachableFiles);

// Get dependency graph
console.log(result.graph);
```

### Code Context Builder

Build semantic understanding of your code:

```typescript
import { getCodeContextBuilder } from '@phuetz/grok-cli';

const builder = getCodeContextBuilder();
const context = await builder.buildFileContext('src/utils.ts');

// Quality metrics
console.log(context.metrics.complexity);
console.log(context.metrics.maintainabilityIndex);

// Detected patterns
console.log(context.patterns); // Singleton, Factory, Observer, etc.

// Semantic tags
console.log(context.tags); // test, utility, api, ui, model, controller
```

### Refactoring Assistant

Safe automated refactoring operations:

```typescript
import { getRefactoringAssistant } from '@phuetz/grok-cli';

const assistant = getRefactoringAssistant();

// Preview changes before applying
const preview = await assistant.preview({
  type: 'rename',
  target: 'oldFunctionName',
  newName: 'newFunctionName',
  scope: 'src/'
});

// Apply refactoring
const result = await assistant.refactor({
  type: 'extractFunction',
  filePath: 'src/utils.ts',
  startLine: 10,
  endLine: 25,
  newName: 'extractedFunction'
});
```

**Supported Operations:**
- `rename` - Rename symbols across files
- `extractFunction` - Extract code to a new function
- `extractVariable` - Extract expression to a variable
- `extractInterface` - Extract type to interface
- `inlineFunction` - Inline function calls
- `moveToFile` - Move code to another file

---

## Advanced Features

### Plan Mode

Structured planning for complex tasks:

```typescript
import { getPlanGenerator } from '@phuetz/grok-cli';

const planner = getPlanGenerator();

// Create a new plan
const plan = planner.createPlan(
  'Implement Authentication',
  'Add user authentication to the application',
  'Complete auth flow with login, logout, and session management'
);

// Add steps
planner.addStep({
  title: 'Create User Model',
  description: 'Define user schema and database model',
  priority: 'high',
  risk: 'low',
  estimatedComplexity: 2,
  dependencies: [],
  affectedFiles: ['src/models/user.ts'],
  actions: [{ type: 'create_file', target: 'src/models/user.ts', description: 'User model' }]
});

// Generate summary
console.log(planner.generateSummary());
```

### Codebase Explorer

Comprehensive project analysis:

```typescript
import { exploreCodebase } from '@phuetz/grok-cli';

const { stats, project, tree, report } = await exploreCodebase('./');

console.log(stats.totalFiles);        // Total file count
console.log(stats.filesByLanguage);   // Files per language
console.log(stats.totalLines);        // Total lines of code
console.log(project.type);            // nodejs, python, go, rust, etc.
console.log(tree);                    // ASCII tree view
console.log(report);                  // Full analysis report
```

### Multi-File Editor

Atomic multi-file operations with rollback:

```typescript
import { getMultiFileEditor } from '@phuetz/grok-cli';

const editor = getMultiFileEditor();

// Start a transaction
const txId = editor.beginTransaction('Refactor auth module');

// Add operations
editor.addOperation(txId, {
  type: 'edit',
  filePath: 'src/auth.ts',
  edit: { type: 'replace', search: 'oldCode', replace: 'newCode' }
});

editor.addOperation(txId, {
  type: 'create',
  filePath: 'src/auth-utils.ts',
  content: '// New utility file'
});

// Commit or rollback
try {
  await editor.commit(txId);
} catch (error) {
  await editor.rollback(txId); // Automatic rollback on failure
}
```

### Operation History

Undo/redo with persistent storage:

```typescript
import { getOperationHistory } from '@phuetz/grok-cli';

const history = getOperationHistory();

// Undo last operation
await history.undo();

// Redo
await history.redo();

// Go to specific point
await history.goToHistoryPoint('operation-id');

// List history
const entries = history.getHistory();
```

---

## Installation

### Prerequisites

- **Node.js** 18.0.0 or higher
- **ripgrep** (optional, recommended for optimal search performance)
  ```bash
  # macOS
  brew install ripgrep

  # Ubuntu/Debian
  sudo apt-get install ripgrep

  # Windows
  choco install ripgrep
  ```

### Install Methods

```bash
# npm
npm install -g @phuetz/grok-cli

# yarn
yarn global add @phuetz/grok-cli

# pnpm
pnpm add -g @phuetz/grok-cli

# bun
bun add -g @phuetz/grok-cli
```

### Development Setup

```bash
git clone https://github.com/phuetz/grok-cli.git
cd grok-cli
npm install
npm run build
npm link
```

---

## Configuration

### API Key Setup

Get your API key from [X.AI](https://x.ai)

**Method 1: Environment Variable (Recommended)**
```bash
export GROK_API_KEY=your_api_key_here
```

**Method 2: .env File**
```bash
GROK_API_KEY=your_api_key_here
```

**Method 3: Command Line**
```bash
grok --api-key your_api_key_here
```

**Method 4: User Settings**
Create `~/.grok/user-settings.json`:
```json
{
  "apiKey": "your_api_key_here",
  "baseURL": "https://api.x.ai/v1",
  "defaultModel": "grok-4-latest"
}
```

### Custom Base URL

Use alternative AI providers:
```bash
grok --base-url https://your-endpoint.com/v1
```

---

## Usage

### Interactive Mode

```bash
# Start in current directory
grok

# Specify working directory
grok -d /path/to/project

# Use specific model
grok --model grok-4-latest
```

### Headless Mode

Perfect for CI/CD and scripting:

```bash
grok --prompt "analyze package.json and suggest optimizations"
grok -p "run tests and fix any failures" -d /path/to/project
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift+Tab` | Toggle auto-edit mode |
| `Ctrl+C` | Clear input / Interrupt |
| `Esc` | Cancel current operation |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/clear` | Clear conversation |
| `/model` | Change AI model |
| `/yolo` | Toggle auto-execution mode |
| `/pipeline` | Run automated workflows |
| `/skill` | Activate specialized skills |
| `/cost` | Show cost dashboard |
| `/fork` | Create conversation branch |
| `/memory` | Manage persistent memory |
| `/parallel` | Execute tasks in parallel |
| `/generate-tests` | Generate unit tests |
| `/scan-todos` | Scan for AI comments |

---

## Project Structure

```
grok-cli/
├── src/
│   ├── agent/                  # AI agent core
│   │   ├── parallel/           # Parallel execution
│   │   ├── reasoning/          # Tree-of-thought reasoning
│   │   └── thinking/           # Extended thinking
│   │
│   ├── tools/                  # Tool implementations
│   │   ├── intelligence/       # Code intelligence suite
│   │   │   ├── ast-parser.ts
│   │   │   ├── symbol-search.ts
│   │   │   ├── dependency-analyzer.ts
│   │   │   ├── code-context.ts
│   │   │   └── refactoring-assistant.ts
│   │   │
│   │   ├── advanced/           # Advanced tools
│   │   │   ├── multi-file-editor.ts
│   │   │   └── operation-history.ts
│   │   │
│   │   └── ...                 # Core tools
│   │
│   ├── services/               # Services
│   │   ├── plan-generator.ts
│   │   └── codebase-explorer.ts
│   │
│   ├── ui/                     # Terminal UI (Ink/React)
│   │   └── components/
│   │       └── enhanced-spinners.tsx
│   │
│   ├── context/                # Context management
│   │   └── codebase-rag/       # RAG for codebase
│   │
│   └── utils/                  # Utilities
│
├── dist/                       # Compiled output
└── package.json
```

---

## Tech Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Node.js 18+ |
| **Language** | TypeScript 5.3 |
| **UI** | React 18 + Ink 4 |
| **CLI** | Commander.js 12 |
| **AI Client** | OpenAI SDK 5.10 |
| **Search** | ripgrep-node |
| **Tokens** | tiktoken |

---

## Security

- **Confirmation before destructive actions** - All file and bash operations require approval
- **Visual diff preview** - See changes before applying
- **Automated security scanning** - npm audit and TruffleHog
- **Input validation** - Timeouts, buffer limits, round limits
- **No hardcoded secrets** - Environment variables and settings files

---

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development

```bash
npm install          # Install dependencies
npm run dev          # Development mode
npm run build        # Build project
npm run lint         # Run linter
npm run typecheck    # Type checking
npm test             # Run tests
```

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- **X.AI** for the Grok API
- **OpenAI** for the compatible SDK
- **Vadim Demedes** for [Ink](https://github.com/vadimdemedes/ink)
- **BurntSushi** for [ripgrep](https://github.com/BurntSushi/ripgrep)
- The open-source community

---

<div align="center">

**Built with passion by the Grok CLI community**

[Report Bug](https://github.com/phuetz/grok-cli/issues) •
[Request Feature](https://github.com/phuetz/grok-cli/discussions)

</div>
