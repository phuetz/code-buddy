# Cody (Sourcegraph) - Code Intelligence

## Overview

Cody is Sourcegraph's AI coding assistant that leverages their powerful code graph and context-aware search capabilities. It provides whole-codebase intelligence rather than just single-file context.

## Key Features

### Context-Aware Search

Cody's distinguishing feature is its deep codebase understanding:

- Uses Sourcegraph's Search API for local and remote codebases
- Understands entire codebase, not just current file
- Combines code graph with advanced AI models
- Provides accurate, relevant suggestions based on full context

### Search Capabilities

| Feature | Description |
|---------|-------------|
| Filters | Narrow search by various criteria |
| Keywords | Search specific terms |
| Operators | Boolean logic for complex queries |
| Pattern Matching | Regex support |
| Cross-Repository | Search across all local and remote codebases |
| Research Queries | Deep pattern and usage discovery |

### Code Intelligence Features

| Feature | Description |
|---------|-------------|
| Code Completion | Context-aware using semantic search |
| Code Explanation | Detailed explanations of selected snippets |
| Automated Refactoring | Multi-file modifications |
| Documentation Generation | Auto-generate docs |
| Unit Test Generation | Create tests for code |
| Code Navigation | Jump to definitions, references |
| Batch Changes | Apply changes across multiple files |

### IDE Integration

- VS Code
- IntelliJ
- Neovim
- Visual Studio
- Sourcegraph web app

### Model Support

Multiple LLM options:
- Claude (Anthropic)
- Gemini Pro (Google)
- GPT models (OpenAI)
- User-selected per chat

## Enterprise Features

| Feature | Description |
|---------|-------------|
| Zero Code Retention | No code stored on servers |
| Audit Logs | Complete activity tracking |
| Guardrails | Policy enforcement |
| SOC 2/GDPR/CCPA | Compliance certifications |
| SSO/SAML | Enterprise authentication |
| Self-Hosted | On-premises deployment |
| Single-Tenant | Dedicated infrastructure |
| BYOK | Bring your own LLM key |

## Code Graph Technology

### How It Works

1. **Indexing**: Sourcegraph indexes repositories
2. **Graph Building**: Creates relationships between code elements
3. **Semantic Search**: Uses graph for intelligent retrieval
4. **Context Assembly**: Gathers relevant code for LLM

### Benefits

- Repository-level understanding
- Cross-file dependency awareness
- Historical code pattern recognition
- Accurate code navigation

## Unique Features for Grok CLI

| Feature | Implementation Priority | Complexity |
|---------|------------------------|------------|
| Semantic Code Search | Already Implemented | - |
| Cross-Repository Search | Low | High |
| Code Graph/Dependency Analysis | Already Implemented | - |
| Multi-File Batch Changes | Already Implemented | - |
| Model Selection UI | Medium | Low |
| Code Explanation Command | Medium | Low |

## Implementation Notes

### Search API Pattern

```typescript
interface CodeSearch {
  query: string;
  filters: {
    repo?: string[];
    lang?: string[];
    file?: string;
    type?: 'symbol' | 'content' | 'path';
  };
  options: {
    caseSensitive?: boolean;
    regex?: boolean;
    structural?: boolean;
  };
}
```

### Context Assembly

```typescript
interface ContextAssembly {
  // Gather relevant context from search
  searchResults: SearchResult[];
  // Current file context
  currentFile: FileContext;
  // Related files from dependency graph
  relatedFiles: FileContext[];
  // Conversation history
  history: Message[];
}
```

## Sources

- [Cody Documentation](https://sourcegraph.com/docs/cody)
- [Sourcegraph Platform](https://sourcegraph.com)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=sourcegraph.cody-ai)
- [Cody AI Review 2025](https://sider.ai/blog/ai-tools/ai-cody-review-is-sourcegraph-s-ai-pair-programmer-worth-it-in-2025)
