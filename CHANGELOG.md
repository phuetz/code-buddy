# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Phase 4: Enterprise Features (~7,900 lines)
- **Team Collaboration** (`src/collaboration/team-session.ts`)
  - WebSocket-based real-time collaboration
  - Role-based permissions (owner, admin, editor, viewer)
  - Session sharing with invite codes
  - Complete audit trail
  - Annotations and comments on shared code
  - Encrypted session data

- **Analytics Dashboard** (`src/analytics/dashboard.ts`)
  - Usage metrics (sessions, messages, tokens, tool calls)
  - Cost tracking with model pricing
  - Performance metrics (P50, P90, P99)
  - Export to JSON, CSV, Markdown
  - Daily/weekly/monthly reports

- **Plugin Marketplace** (`src/plugins/marketplace.ts`)
  - Plugin discovery and installation
  - Sandboxed plugin execution
  - Plugin API (commands, tools, providers, hooks)
  - Version management with semver
  - Community plugin support

- **Offline Mode** (`src/offline/offline-mode.ts`)
  - Response caching with LRU eviction
  - Local LLM fallback (Ollama, llama.cpp)
  - Request queuing when offline
  - Auto-sync on reconnect
  - Network status monitoring

- **Checkpoint System** (`src/undo/checkpoint-manager.ts`)
  - File state snapshots before changes
  - Undo/redo operations
  - Diff viewing with diff-match-patch
  - Auto-checkpoint on dangerous operations
  - Search and tag checkpoints

- **Custom Personas** (`src/personas/persona-manager.ts`)
  - 7 built-in personas (default, senior-developer, code-reviewer, debugger, teacher, minimalist, security-expert)
  - Trigger-based auto-selection
  - Custom persona creation
  - Import/export personas
  - Style customization

- **Enhanced Memory** (`src/memory/enhanced-memory.ts`)
  - Long-term semantic memory
  - Project context learning
  - User profile and preferences
  - Conversation summaries
  - Memory decay algorithm
  - Embedding-based retrieval

- **Tests for Phase 4 modules** (7 test files)
  - `tests/team-session.test.ts`
  - `tests/analytics-dashboard.test.ts`
  - `tests/plugin-marketplace.test.ts`
  - `tests/offline-mode.test.ts`
  - `tests/checkpoint-manager.test.ts`
  - `tests/persona-manager.test.ts`
  - `tests/enhanced-memory.test.ts`

#### Phase 3: IDE Integrations (~5,450 lines)
- **VS Code Extension** (`src/ide/vscode-extension.ts`)
  - Chat sidebar panel
  - Code actions (explain, refactor, generate tests)
  - Inline completions
  - Problem diagnostics
  - File decorations

- **LSP Server** (`src/ide/lsp-server.ts`)
  - Language Server Protocol implementation
  - Works with Neovim, Sublime, Emacs
  - Hover information
  - Code completions
  - Diagnostics

- **Embedded Browser** (`src/ide/embedded-browser.ts`)
  - Puppeteer-based headless browser
  - DOM element selection and inspection
  - Screenshot capture
  - Console log forwarding
  - Network request interception

- **Voice Control** (`src/ide/voice-control.ts`)
  - Wake word detection ("Hey Grok")
  - Speech-to-text (Web Speech API / Whisper)
  - Text-to-speech responses
  - Voice command recognition
  - Multi-language support

#### Phase 2: Core Features (~3,700 lines)
- **AI Code Review** (`src/tools/ai-code-review.ts`)
  - Security vulnerability detection
  - Bug pattern detection
  - Performance issue detection
  - Code style violations
  - Complexity analysis
  - Auto-fix suggestions

- **Parallel Executor** (`src/agent/parallel/parallel-executor.ts`)
  - Git worktree-based isolation
  - Remote machine support (SSH)
  - Concurrent agent execution (up to 16)
  - Conflict detection and resolution
  - Result aggregation and merging

- **GitHub Integration** (`src/tools/github-integration.ts`)
  - PR creation and review
  - Issue management
  - CI/CD integration
  - Webhook handling

#### Phase 1: Quality & Security
- Comprehensive test infrastructure with Jest
  - Unit tests for cache system
  - Unit tests for error utilities
  - Unit tests for model utilities
  - Test coverage reporting
  - Watch mode and coverage scripts
- **Sandboxed Terminal** (`src/tools/sandboxed-terminal.ts`)
  - Namespace isolation (PID, NET, IPC, UTS, USER)
  - Filesystem restrictions with chroot
  - Resource limits (memory, CPU, file descriptors)
  - Timeout enforcement
  - Audit logging
- **Rate Limiter** (`src/utils/rate-limiter.ts`)
  - Token bucket algorithm
  - Exponential backoff (configurable)
  - Request queue with priority
  - Per-user/session quotas
  - Graceful degradation
- **Config Validator** (`src/utils/config-validator.ts`)
  - JSON Schema validation
  - Descriptive error messages
  - Auto-migration support
- Input sanitization utilities
  - File path sanitization (prevent directory traversal)
  - Command argument sanitization (prevent injection)
  - HTML/XSS sanitization
  - Email and URL validation
  - JSON parsing with validation
- Performance monitoring system
  - PerformanceMonitor class for timing operations
  - Async and sync function measurement
  - Performance reports and summaries
  - Metric export to JSON
  - Global monitor instance
- Centralized configuration management
  - Cascading config priority (CLI > ENV > User > Defaults)
  - Configuration validation
  - Help text generation
- Custom error class hierarchy
  - GrokError base class
  - Specialized errors (APIError, FileError, NetworkError, etc.)
  - withTimeout and withRetry utilities
- Model validation and utilities
  - Support for multiple providers (Grok, Claude, Gemini)
  - Model information and token limits
  - Fuzzy model suggestions
- Search result caching
  - 60-second TTL cache for search operations
  - Automatic expiration and cleanup
- Resource cleanup
  - dispose() method for GrokAgent
  - Proper cleanup in token counter
- GitHub Actions workflows
  - CI workflow for automated testing
  - Release workflow for automated publishing
- Contribution guidelines (CONTRIBUTING.md)
- Example configuration files
- Comprehensive documentation

### Changed
- Improved error handling across all tools
- Enhanced bash command validation
  - Dangerous command detection
  - Blocked command list
  - Command injection prevention
- Refactored configuration loading
  - Removed code duplication in index.ts
  - Unified config resolution
- Updated README with
  - Architecture section
  - Troubleshooting guide
  - Contributing guidelines
  - Roadmap
- Improved .npmignore to exclude development files

### Fixed
- Security improvements in bash command execution
- Better error messages throughout the application

## [0.0.12] - Previous Release

### Features
- Git commands support
- Model selection and persistence
- Improved UI components

## [0.0.11] - Previous Release

### Features
- Search tool with ripgrep integration
- Todo list management
- Confirmation dialogs

## [0.0.10] - Previous Release

### Features
- Basic file editing capabilities
- Bash command execution
- Initial release of Grok CLI

---

## Version History Guidelines

### Types of Changes

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes

### Semantic Versioning

- **Major version (X.0.0)**: Breaking changes
- **Minor version (0.X.0)**: New features, backward compatible
- **Patch version (0.0.X)**: Bug fixes, backward compatible

### Release Process

1. Update this CHANGELOG with all changes since last release
2. Update version in package.json
3. Create git tag: `git tag v0.0.13`
4. Push tag: `git push origin v0.0.13`
5. GitHub Actions will automatically publish to npm

---

[Unreleased]: https://github.com/phuetz/grok-cli/compare/v0.0.12...HEAD
[0.0.12]: https://github.com/phuetz/grok-cli/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/phuetz/grok-cli/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/phuetz/grok-cli/releases/tag/v0.0.10
