/**
 * Built-in Slash Commands
 *
 * Contains all built-in command definitions for the slash command system.
 * Commands are organized by category for maintainability.
 */

import type { SlashCommand } from './types.js';
import { promptCommands } from './prompt-commands.js';

// ============================================================================
// Core Commands
// ============================================================================

const coreCommands: SlashCommand[] = [
  {
    name: 'help',
    description: 'Show available commands and help information',
    prompt: '__HELP__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'shortcuts',
    description: 'Show keyboard shortcuts and key bindings',
    prompt: '__SHORTCUTS__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'clear',
    description: 'Clear the chat history',
    prompt: '__CLEAR_CHAT__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'history',
    description: 'View and search command history (use Ctrl+R for reverse search)',
    prompt: '__HISTORY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list [n], search <pattern>, clear, stats, limit <n>', required: false }
    ]
  },
  {
    name: 'init',
    description: 'Initialize .codebuddy directory with templates',
    prompt: '__INIT_GROK__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'reinit',
    description: 'Reset and re-initialize .codebuddy from scratch (deletes existing config)',
    prompt: '__REINIT_GROK__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'features',
    description: 'Display research-based features implemented in Code Buddy',
    prompt: '__FEATURES__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'reload',
    description: 'Reload configuration without restarting',
    prompt: '__RELOAD__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'log',
    description: 'Show log file path and information',
    prompt: '__LOG__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'compact',
    description: 'Compact/summarize conversation history to free up context',
    prompt: '__COMPACT__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'plan',
    description: 'Enter plan mode (research and design phase)',
    prompt: '__PLAN_MODE__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'ultraplan',
    description: 'Spawn parallel specialized agents to research and synthesize the best execution plan (Best-of-N)',
    prompt: '__ULTRAPLAN__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'prompt', description: 'The task to plan for', required: true }
    ]
  },
  {
    name: 'config',
    description: 'Validate configuration files and environment variables',
    prompt: '__CONFIG__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'validate, show, defaults <schema>, docs <schema>', required: false }
    ]
  },
  {
    name: 'login',
    description: 'Authenticate with a provider (default: chatgpt — uses your ChatGPT subscription)',
    prompt: '__LOGIN__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'provider', description: 'chatgpt (default) | gemini', required: false }
    ]
  },
  {
    name: 'logout',
    description: 'Clear stored credentials for a provider',
    prompt: '__LOGOUT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'provider', description: 'chatgpt (default) | gemini', required: false }
    ]
  },
  {
    name: 'whoami',
    description: 'Show current authentication status (email, plan, account)',
    prompt: '__WHOAMI__',
    filePath: '',
    isBuiltin: true
  }
];

// ============================================================================
// Mode & Model Commands
// ============================================================================

const modeCommands: SlashCommand[] = [
  {
    name: 'fast',
    description: 'Toggle fast mode (switch to low-latency model with service_tier=flex)',
    prompt: '__FAST_MODE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, toggle, status, model <name>', required: false }
    ]
  },
  {
    name: 'model',
    description: 'Change the AI model (use "auto" for automatic routing by task complexity)',
    prompt: '__CHANGE_MODEL__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'model', description: 'Model name to switch to, or "auto" for automatic routing', required: false }
    ]
  },
  {
    name: 'mode',
    description: 'Change agent mode (plan/code/ask)',
    prompt: '__CHANGE_MODE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'mode', description: 'Mode to switch to: plan, code, or ask', required: true }
    ]
  },
  {
    name: 'model-router',
    description: 'Manage model routing for cost optimization (30-70% savings)',
    prompt: '__MODEL_ROUTER__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, on, off, models, compare [tokens], sensitivity <level>, stats', required: false }
    ]
  },
  {
    name: 'switch',
    description: 'Switch model mid-conversation (use "auto" to revert to default)',
    prompt: '__SWITCH__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'model', description: 'Model name or "auto" to revert', required: false }
    ]
  }
];

// ============================================================================
// Checkpoint Commands
// ============================================================================

const checkpointCommands: SlashCommand[] = [
  {
    name: 'checkpoints',
    description: 'List all checkpoints',
    prompt: '__LIST_CHECKPOINTS__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'restore',
    description: 'Restore to a checkpoint',
    prompt: '__RESTORE_CHECKPOINT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'checkpoint', description: 'Checkpoint ID or number', required: false }
    ]
  },
  {
    name: 'undo',
    description: 'Undo last file changes (revert to previous checkpoint)',
    prompt: '__UNDO__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'redo',
    description: 'Redo previously undone changes (restore forward in ghost snapshot timeline)',
    prompt: '__REDO__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'timeline',
    description: 'Show ghost snapshot timeline with current position',
    prompt: '__TIMELINE__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'diff',
    description: 'Show uncommitted git changes, or diff between checkpoints',
    prompt: '__DIFF__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'from', description: 'Checkpoint ID (optional, omit for git diff)', required: false },
      { name: 'to', description: 'Second checkpoint ID', required: false }
    ]
  }
];

// ============================================================================
// Git Commands
// ============================================================================

const gitCommands: SlashCommand[] = [
  {
    name: 'pr',
    description: 'Create a GitHub/GitLab PR from the current branch',
    prompt: '__PR__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'title', description: 'PR title (auto-generated if omitted). Use --draft for draft PR.', required: false }
    ]
  },
  {
    name: 'review',
    description: 'Quick code review of staged/unstaged changes',
    prompt: '__REVIEW__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'commit',
    description: 'Generate commit message and commit changes',
    prompt: `Analyze the current git changes and create an appropriate commit:

1. Run git status to see all changes
2. Run git diff --cached to see staged changes (or git diff if nothing staged)
3. Generate a conventional commit message following the format:
   - type(scope): description
   - Types: feat, fix, docs, style, refactor, test, chore
4. Stage relevant files with git add
5. Create the commit with the generated message

Keep the commit message concise but descriptive.`,
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'worktree',
    description: 'Manage git worktrees for parallel instances (Standard)',
    prompt: '__WORKTREE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, add <path> [branch], remove <path>, prune, lock, unlock', required: false }
    ]
  }
];

// ============================================================================
// Development Commands
// ============================================================================

const devCommands: SlashCommand[] = [
  {
    name: 'test',
    description: 'Run tests directly (optionally specify a file)',
    prompt: '__TEST__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'file', description: 'Test file to run (optional, runs all if omitted)', required: false }
    ]
  },
  {
    name: 'lint',
    description: 'Auto-detect and run project linters (eslint, ruff, clippy, golangci-lint, rubocop, phpstan)',
    prompt: '__LINT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'run (default), fix (auto-correct), detect (show detected linters)', required: false }
    ]
  },
  {
    name: 'fix',
    description: 'Auto-fix lint errors and check for type errors',
    prompt: '__FIX__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'debug',
    description: 'Toggle debug mode for verbose logging',
    prompt: '__DEBUG__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, or status', required: false }
    ]
  },
  {
    name: 'debug-issue',
    description: 'Help debug a code issue',
    prompt: `Help debug the described issue:

1. Gather information about the problem
2. Analyze relevant code and logs
3. Identify potential causes
4. Suggest debugging steps
5. Propose solutions

Be systematic and thorough in your analysis.`,
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'refactor',
    description: 'Suggest refactoring improvements',
    prompt: `Analyze the code and suggest refactoring improvements:

1. Identify code smells and anti-patterns
2. Suggest improvements for:
   - Readability
   - Maintainability
   - Performance
   - Testability
3. Provide specific refactoring recommendations with examples
4. Prioritize suggestions by impact`,
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'file', description: 'File path to refactor', required: false }
    ]
  },
  {
    name: 'generate-tests',
    description: 'Generate tests for a file',
    prompt: '__GENERATE_TESTS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'file', description: 'File to generate tests for', required: false }
    ]
  },
  {
    name: 'tdd',
    description: 'Enter TDD mode - test-first development (45% accuracy improvement)',
    prompt: '__TDD_MODE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'start <requirements>, status, approve, cancel', required: false }
    ]
  },
  {
    name: 'ai-test',
    description: 'Run integration tests on the current AI provider',
    prompt: '__AI_TEST__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'options', description: 'quick (skip expensive), full (all tests), tools (test tool calling), stream (test streaming)', required: false }
    ]
  },
  {
    name: 'watch',
    description: 'Watch source files for changes and trigger actions (lint, test, typecheck)',
    prompt: '__WATCH__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'start [patterns...], stop, status', required: false }
    ]
  },
  {
    name: 'conflicts',
    description: 'Detect and resolve Git merge conflicts',
    prompt: '__CONFLICTS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'scan, show <file>, resolve <file> [ours|theirs|both]', required: false }
    ]
  },
  {
    name: 'vulns',
    description: 'Scan project dependencies for known security vulnerabilities',
    prompt: '__VULNS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'package_manager', description: 'npm, pip, cargo, go (optional, scans all if omitted)', required: false }
    ]
  },
  {
    name: 'bug',
    description: 'Scan files or directories for potential bugs using static analysis',
    prompt: '__BUG__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'path', description: 'File or directory to scan (default: current directory)', required: false },
      { name: '--severity', description: 'Filter by minimum severity: critical, high', required: false }
    ]
  }
];

// ============================================================================
// Documentation Commands
// ============================================================================

const docCommands: SlashCommand[] = [
  {
    name: 'explain',
    description: 'Explain a file or piece of code',
    prompt: `Provide a detailed explanation of the code or file. Include:
- Overall purpose and functionality
- Key components and their roles
- Important patterns or techniques used
- Dependencies and how they're used
- Potential areas for improvement`,
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'file', description: 'File path to explain', required: false }
    ]
  },
  {
    name: 'docs',
    description: 'Generate documentation',
    prompt: `Generate documentation for the code:

1. Analyze the code structure
2. Generate appropriate documentation:
   - JSDoc/TSDoc comments for functions
   - README sections if needed
   - API documentation
   - Usage examples
3. Follow the project's documentation style`,
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'file', description: 'File to document', required: false }
    ]
  },
  {
    name: 'docs-generate',
    description: 'Generate full project documentation (DeepWiki V2 pipeline)',
    prompt: `__DOCS_GENERATE__`,
    filePath: '',
    isBuiltin: true,
  }
];

// ============================================================================
// Security Commands
// ============================================================================

const securityCommands: SlashCommand[] = [
  {
    name: 'security',
    description: 'Show security dashboard and settings',
    prompt: '__SECURITY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, mode <mode>, reset', required: false }
    ]
  },
  {
    name: 'guardian',
    description: 'Activate Code Guardian for code analysis and review',
    prompt: '__GUARDIAN__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'analyze <path>, security, review, refactor, plan, architecture', required: false },
      { name: 'mode', description: 'Mode: analyze-only, suggest, plan, diff', required: false }
    ]
  },
  {
    name: 'security-review',
    description: 'Run comprehensive security scan (OWASP, secrets, dependencies)',
    prompt: '__SECURITY_REVIEW__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'full-scan, quick-scan, detect-secrets, audit-deps, audit-perms, report [format]', required: false },
      { name: 'path', description: 'Target path to scan (default: cwd)', required: false }
    ]
  },
  {
    name: 'identity',
    description: 'Manage identity linking (SOUL.md, USER.md, AGENTS.md)',
    prompt: '__IDENTITY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'show, link, unlink, status', required: false }
    ]
  },
  {
    name: 'pairing',
    description: 'Manage DM pairing security for messaging channels',
    prompt: '__PAIRING__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, approve <code>, revoke <id>, list, pending', required: false }
    ]
  },
  {
    name: 'elevated',
    description: 'Toggle elevated permission mode (sudo-like for privileged operations)',
    prompt: '__ELEVATED__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on [duration-min], off, status, grants, revoke <id>', required: false }
    ]
  },
  {
    name: 'secrets-scan',
    description: 'Scan project for hardcoded secrets, API keys, and credentials',
    prompt: '__SECRETS_SCAN__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'path', description: 'File or directory path to scan (default: current directory)', required: false }
    ]
  }
];

// ============================================================================
// Context & Session Commands
// ============================================================================

const contextCommands: SlashCommand[] = [
  {
    name: 'add',
    description: 'Add files to the current context',
    prompt: '__ADD_CONTEXT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'pattern', description: 'File path or glob pattern (e.g., src/**/*.ts)', required: true }
    ]
  },
  {
    name: 'context',
    description: 'View or manage loaded context files, or show stats',
    prompt: '__CONTEXT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, clear, summary, or stats', required: false }
    ]
  },
  {
    name: 'workspace',
    description: 'Detect and show workspace configuration',
    prompt: '__WORKSPACE__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'cache',
    description: 'Manage response cache',
    prompt: '__CACHE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, clear, or stats', required: false }
    ]
  },
  {
    name: 'dry-run',
    description: 'Toggle dry-run mode (preview changes without applying)',
    prompt: '__DRY_RUN__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, or status', required: false }
    ]
  },
  {
    name: 'prompt-cache',
    description: 'Manage prompt caching (up to 90% cost reduction)',
    prompt: '__PROMPT_CACHE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, on, off, clear, warm', required: false }
    ]
  }
];

// ============================================================================
// Session Management Commands
// ============================================================================

const sessionCommands: SlashCommand[] = [
  {
    name: 'sessions',
    description: 'List recent sessions with interaction history',
    prompt: '__SESSIONS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, show <id>, replay <id>, delete <id>, cleanup [--days N] [--keep N] [--dry-run]', required: false }
    ]
  },
  {
    name: 'copy',
    description: 'Copy to clipboard: last response, last code block, or specified text',
    prompt: '__COPY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'target', description: '"code" for last code block, or text to copy. Empty copies last response.', required: false }
    ]
  },
  {
    name: 'branch',
    description: 'Manage conversation branches (create, switch, list, merge, diff, delete)',
    prompt: '__BRANCH__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'create [name], switch <id>, list, merge <id>, diff <id>, delete <id>, rename <id> <name>, tree, history [id]', required: false }
    ]
  },
  {
    name: 'fork',
    description: 'Fork conversation into a new branch',
    prompt: '__FORK__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'name', description: 'Name for the new branch', required: false }
    ]
  },
  {
    name: 'branches',
    description: 'List all conversation branches',
    prompt: '__BRANCHES__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'checkout',
    description: 'Switch to a different conversation branch',
    prompt: '__CHECKOUT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'branch', description: 'Branch ID or name to switch to', required: true }
    ]
  },
  {
    name: 'merge',
    description: 'Merge a branch into current conversation',
    prompt: '__MERGE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'branch', description: 'Branch ID to merge', required: true }
    ]
  },
  {
    name: 'save',
    description: 'Save the current conversation to a markdown file',
    prompt: '__SAVE_CONVERSATION__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'filename', description: 'Output filename (optional, defaults to timestamp)', required: false }
    ]
  },
  {
    name: 'export',
    description: 'Export session to various formats (JSON, Markdown, HTML, Text)',
    prompt: '__EXPORT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'format', description: 'Export format: json, markdown, html, text (default: markdown)', required: false },
      { name: 'session', description: 'session:<id> to export specific session', required: false }
    ]
  },
  {
    name: 'export-list',
    description: 'List all exported files',
    prompt: '__EXPORT_LIST__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'export-formats',
    description: 'Show available export formats and options',
    prompt: '__EXPORT_FORMATS__',
    filePath: '',
    isBuiltin: true
  }
];

// ============================================================================
// Memory Commands
// ============================================================================

const memoryCommands: SlashCommand[] = [
  {
    name: 'memory',
    description: 'Manage persistent memory',
    prompt: '__MEMORY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, remember <key> <value>, recall <key>, forget <key>', required: false }
    ]
  },
  {
    name: 'remember',
    description: 'Store something in persistent memory',
    prompt: '__REMEMBER__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'key', description: 'Key for the memory', required: true },
      { name: 'value', description: 'Value to remember', required: true }
    ]
  },
  {
    name: 'lessons',
    description: 'Manage lessons learned (list|add <content>|search <query>|stats)',
    prompt: '__LESSONS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, add <content>, search <query>, stats', required: false }
    ]
  },
  {
    name: 'knowledge-graph',
    description: 'View and manage the persistent knowledge graph (memU-style memory)',
    prompt: '__KNOWLEDGE_GRAPH__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'stats, entities [type], relations [entity], query <name>, decay, clear', required: false }
    ]
  }
];

// ============================================================================
// Persona Commands
// ============================================================================

const personaCommands: SlashCommand[] = [
  {
    name: 'persona',
    description: 'Switch or manage agent personas (list|use <name>|info [name]|reset)',
    prompt: '__PERSONA__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, use <name>, info [name], reset', required: false }
    ]
  }
];

// ============================================================================
// Autonomy & Permissions Commands
// ============================================================================

const autonomyCommands: SlashCommand[] = [
  {
    name: 'yolo',
    description: 'Toggle YOLO mode (full auto-execution with guardrails)',
    prompt: '__YOLO_MODE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, safe, status, allow, deny', required: false }
    ]
  },
  {
    name: 'autonomy',
    description: 'Set autonomy level (suggest, confirm, auto, full, yolo)',
    prompt: '__AUTONOMY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'level', description: 'Autonomy level', required: false }
    ]
  },
  {
    name: 'permissions',
    description: 'Manage tool permissions and allowlist (Standard)',
    prompt: '__PERMISSIONS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, add <tool>, remove <tool>, categories, save, reset', required: false }
    ]
  },
  {
    name: 'approvals',
    description: 'Manage approval pattern learning (patterns, clear, threshold)',
    prompt: '__APPROVALS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'patterns (list), clear (reset all), threshold <n>', required: false }
    ]
  },
  {
    name: 'heal',
    description: 'Configure self-healing auto-correction',
    prompt: '__SELF_HEALING__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, status, or stats', required: false }
    ]
  },
  {
    name: 'batch-review',
    description: 'Toggle batch review mode for multi-file changes (consolidate approve/reject)',
    prompt: '__BATCH_REVIEW__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, status, show (view pending)', required: false }
    ]
  }
];

// ============================================================================
// Tools & Pipeline Commands
// ============================================================================

const toolCommands: SlashCommand[] = [
  {
    name: 'starter',
    description: 'Browse and activate starter pack skills for new projects',
    prompt: '__STARTER__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'name_or_action', description: 'list, search <query>, or <starter-name>', required: false }
    ]
  },
  {
    name: 'tools',
    description: 'List and filter available tools',
    prompt: '__TOOLS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, filter <pattern>, reset', required: false }
    ]
  },
  {
    name: 'pipeline',
    description: 'Run or manage pipeline workflows (pipe syntax or file-based)',
    prompt: '__PIPELINE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'run <file|pipe-syntax>, list, validate <file>, status, or pipeline name (code-review, bug-fix, feature-development, security-audit, documentation)', required: false }
    ]
  },
  {
    name: 'skill',
    description: 'Manage and activate specialized skills',
    prompt: '__SKILL__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, activate <name>, deactivate, or skill name', required: false }
    ]
  },
  {
    name: 'parallel',
    description: 'Run multiple subagents in parallel',
    prompt: '__PARALLEL__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'task', description: 'Task to run with parallel agents', required: false }
    ]
  },
  {
    name: 'agent',
    description: 'Manage and activate custom agents',
    prompt: '__AGENT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, <id>, create <name>, info <id>, reload', required: false }
    ]
  },
  {
    name: 'subagent',
    description: 'List and inspect predefined conversational subagents (Explore, code-reviewer, debugger, etc.) — read-only discovery, complements /agent (custom) and /agents (MultiAgentSystem)',
    prompt: '__SUBAGENT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list (default), info <name>, help', required: false }
    ]
  },
  {
    name: 'swarm',
    description: 'Spawn a swarm of specialized agents to work in parallel on a task (UX wrapper around /agents run with strategy=parallel; inspired by Korben\'s Claude Code Swarms article)',
    prompt: '__SWARM__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'task', description: 'task description, OR: stop | status | help', required: false }
    ]
  }
];

// ============================================================================
// Stats & Cost Commands
// ============================================================================

const statsCommands: SlashCommand[] = [
  {
    name: 'cost',
    description: 'Show cost tracking dashboard',
    prompt: '__COST__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, budget <amount>, daily <amount>, export, reset', required: false }
    ]
  },
  {
    name: 'stats',
    description: 'Show performance statistics',
    prompt: '__STATS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'summary, cache, requests, reset', required: false }
    ]
  },
  {
    name: 'tool-analytics',
    description: 'Show tool usage analytics and performance metrics',
    prompt: '__TOOL_ANALYTICS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'tool-name', description: 'Specific tool to analyze (optional)', required: false }
    ]
  },
];

// ============================================================================
// Voice Commands
// ============================================================================

const voiceCommands: SlashCommand[] = [
  {
    name: 'voice',
    description: 'Control voice input (speech-to-text)',
    prompt: '__VOICE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, toggle, status, or config', required: false }
    ]
  },
  {
    name: 'speak',
    description: 'Speak text aloud using text-to-speech',
    prompt: '__SPEAK__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'text', description: 'Text to speak (or "stop" to stop speaking)', required: false }
    ]
  },
  {
    name: 'tts',
    description: 'Control text-to-speech settings',
    prompt: '__TTS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, auto, status, voices, or voice <name>', required: false }
    ]
  }
];

// ============================================================================
// Theme & UI Commands
// ============================================================================

const themeCommands: SlashCommand[] = [
  {
    name: 'theme',
    description: 'Change the UI color theme',
    prompt: '__THEME__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'name', description: 'Theme name (default, dark, neon, pastel, matrix, ocean, sunset, minimal, high-contrast) or "list" to see all', required: false }
    ]
  },
  {
    name: 'avatar',
    description: 'Change chat avatars',
    prompt: '__AVATAR__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'preset', description: 'Avatar preset (default, emoji, minimal, fun, hacker, space, animal) or "list" to see all', required: false }
    ]
  },
  {
    name: 'vim',
    description: 'Toggle Vim keybindings mode',
    prompt: '__VIM_MODE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, status', required: false }
    ]
  }
];

// ============================================================================
// Advanced Workflow Commands
// ============================================================================

const searchCommands: SlashCommand[] = [
  {
    name: 'search',
    description: 'Search codebase for a text pattern (uses ripgrep)',
    prompt: '__SEARCH__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'query', description: 'Search pattern (text or regex)', required: true }
    ]
  }
];

const workflowCommands: SlashCommand[] = [
  {
    name: 'todo',
    description: 'Find and list TODO comments in code',
    prompt: `Search for TODO, FIXME, HACK, and XXX comments in the codebase:

1. Use search to find all TODO-style comments
2. Categorize them by type and priority
3. List them with file locations
4. Suggest which ones should be addressed first`,
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'scan-todos',
    description: 'Scan for AI-directed comments (// AI: fix this)',
    prompt: '__SCAN_TODOS__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'address-todo',
    description: 'Address a specific AI-directed comment',
    prompt: '__ADDRESS_TODO__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'index', description: 'Index of the TODO to address', required: true }
    ]
  },
  {
    name: 'workflow',
    description: 'Manage CI/CD workflows (GitHub Actions, GitLab CI)',
    prompt: '__WORKFLOW__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, status, create <template>, run <name>, validate <file>', required: false }
    ]
  },
  {
    name: 'hooks',
    description: 'Manage lifecycle hooks (pre/post edit, commit, etc.)',
    prompt: '__HOOKS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, enable <name>, disable <name>, add, status', required: false }
    ]
  },
  {
    name: 'track',
    description: 'Manage development tracks (features, bugs) with spec-driven workflow',
    prompt: '__TRACK__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'new, implement, status, list, complete, setup, context, update', required: false }
    ]
  },
  {
    name: 'colab',
    description: 'Manage AI collaboration workflow (multi-AI development)',
    prompt: '__COLAB__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'status, tasks, start <id>, complete, log, handoff, init, instructions', required: false }
    ]
  },
  {
    name: 'script',
    description: 'Run Buddy Script automation files (.bs)',
    prompt: '__SCRIPT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'run <file>, new <name>, validate <file>, list, history', required: false }
    ]
  },
  {
    name: 'fcs',
    description: 'Run FileCommander Script files (.fcs) - 100% compatible',
    prompt: '__FCS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'run <file>, validate <file>, parse <code>, list, repl', required: false }
    ]
  },
  {
    name: 'plugins',
    description: 'Manage plugin marketplace and installed plugins',
    prompt: '__PLUGINS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, search <query>, install <id>, uninstall <id>, update <id>, status', required: false }
    ]
  },
  {
    name: 'plugin',
    description: 'Manage a single plugin (owner-gated, singular alias for /plugins)',
    prompt: '__PLUGIN__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'install <id>, uninstall <id>, enable <id>, disable <id>, status', required: false }
    ]
  }
];

// ============================================================================
// Golden-Path Dev Commands (slash)
// ============================================================================

const goldenPathCommands: SlashCommand[] = [
  {
    name: 'dev',
    description: 'Golden-path developer workflows (plan, run, pr, fix-ci, status)',
    prompt: '__DEV__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'plan <objective>, run <objective>, pr <objective>, fix-ci, status', required: false }
    ]
  },
  {
    name: 'replace',
    description: 'Codebase-wide find & replace across files',
    prompt: '__REPLACE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'search', description: 'Search pattern (text or /regex/)', required: true },
      { name: 'replacement', description: 'Replacement string', required: true }
    ]
  },
  {
    name: 'cloud',
    description: 'Manage cloud background agent tasks (submit, status, list, cancel, logs)',
    prompt: '__CLOUD__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'submit "<goal>", status <taskId>, list, cancel <taskId>, logs <taskId>, delete <taskId>', required: false }
    ]
  },
  {
    name: 'trigger',
    description: 'Manage event-driven webhook triggers (GitHub, GitLab, Slack, Linear, PagerDuty)',
    prompt: '__TRIGGER__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'add --source <s> --events <e> --action <a>, list, remove <id>, test <id>', required: false }
    ]
  },
];

// ============================================================================
// Agent Control Commands
// ============================================================================

const agentControlCommands: SlashCommand[] = [
  // Dead slash commands removed during audit (2026-02-22):
  // /queue, /subagents, /reset, /verbose
  // These had __TOKEN__ prompts with no handler implementation.
  // /think was re-implemented with full Tree-of-Thought reasoning (2026-02-23).
  // /status and /new were re-implemented with proper handlers (2026-02-26).
  // /team was reactivated from archived multi-agent code (2026-02-26).
  {
    name: 'team',
    description: 'Manage Agent Teams for multi-agent coordination (start, add, status, stop)',
    prompt: '__TEAM__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'start [goal], add <role>, remove <id>, status, stop, task [title], assign <task> <member>, complete <task>, send <to> <msg>, inbox', required: false }
    ]
  },
  // CC13: /batch command for parallel task decomposition
  {
    name: 'batch',
    description: 'Decompose a goal into parallel units and execute with separate agents',
    prompt: '__BATCH__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'instruction', description: 'The goal to decompose and execute in parallel', required: true }
    ]
  },
  {
    name: 'think',
    description: 'Enable Tree-of-Thought reasoning: /think [shallow|medium|deep|exhaustive] [problem]',
    prompt: '__THINK__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'mode_or_problem', description: 'Thinking mode (shallow/medium/deep/exhaustive) or problem text', required: false }
    ]
  },
  {
    name: 'status',
    description: 'Show key configuration info at a glance (model, mode, cost, context, persona, security, YOLO)',
    prompt: '__STATUS__',
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'new',
    description: 'Start a new conversation, optionally switching to a different model',
    prompt: '__NEW__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'model', description: 'Model to switch to (optional)', required: false }
    ]
  },
  {
    name: 'btw',
    description: 'Ask a quick side question without modifying conversation context',
    prompt: '__BTW__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'question', description: 'Your side question', required: true }
    ]
  },
  {
    name: 'heartbeat',
    description: 'Manage the heartbeat engine (enable/disable/status) — periodic HEARTBEAT.md review',
    prompt: '__HEARTBEAT__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'enable | disable | status (default: status)', required: false }
    ]
  },
  {
    name: 'daily-reset',
    description: 'Manage the daily reset scheduler (enable/disable/status/run) — clear conversation at configured time',
    prompt: '__DAILY_RESET__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'enable | disable | status | run (default: status)', required: false }
    ]
  },
  {
    name: 'share',
    description: 'Share a coding session with team members (enable/disable/status/create/join/list/leave) — local-first V0.1, WS sync V0.2',
    prompt: '__SHARE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'enable | disable | status | create <name> | join <id> | list | leave', required: false }
    ]
  },
  {
    name: 'agents',
    description: 'Multi-agent orchestration (run/plan/status/stop/strategy) — 4 specialised agents, 5 strategies. Uses the active Code Buddy provider.',
    prompt: '__AGENTS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'enable | disable | status | run <goal> | plan <goal> | stop | strategy <name>', required: false }
    ]
  },
  {
    name: 'fleet',
    description: 'Inter-Claude live streaming receiver (listen/stop/status) — connects to a peer Code Buddy WS and streams fleet:* events. Requires apiKey with fleet:listen scope.',
    prompt: '__FLEET__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'listen <ws-url> [--api-key <key>] | stop | status', required: false }
    ]
  },
  {
    name: 'suggest',
    description: 'Get proactive suggestions for the current project context',
    prompt: '__SUGGEST__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'category', description: 'all, code, perf, security, git, testing, docs, workflow', required: false }
    ]
  },
  {
    name: 'telemetry',
    description: 'Control telemetry data collection (Sentry, OpenTelemetry)',
    prompt: '__TELEMETRY__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, errors-only, full, status', required: false }
    ]
  },
];

// ============================================================================
// New Feature Commands (quota, coverage, voice-code, transform)
// ============================================================================

const newFeatureCommands: SlashCommand[] = [
  {
    name: 'quota',
    description: 'Show remaining API rate limit capacity per provider',
    prompt: '__QUOTA__',
    filePath: '',
    isBuiltin: true,
  },
  {
    name: 'coverage',
    description: 'Check test coverage against configured targets',
    prompt: '__COVERAGE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'check (default), targets', required: false }
    ]
  },
  {
    name: 'voice-code',
    description: 'Control voice-to-code pipeline (speech to commands/code)',
    prompt: '__VOICE_CODE__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'on, off, status', required: false }
    ]
  },
  {
    name: 'transform',
    description: 'Transform code: modernize, typescript, async, functional, es-modules',
    prompt: '__TRANSFORM__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'type', description: 'modernize, typescript, async, functional, es-modules', required: false },
      { name: 'file', description: 'File or directory to transform', required: false }
    ]
  },
  {
    name: 'infra',
    description: 'Show infrastructure health dashboard (Ollama, vLLM, TurboQuant routing stats)',
    prompt: '__INFRA__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'subcommand', description: 'status (default), stats, health', required: false }
    ]
  },
];

// ============================================================================
// All Built-in Commands (Combined)
// ============================================================================

/**
 * All built-in slash commands.
 * Combined from all category arrays.
 */
export const builtinCommands: SlashCommand[] = [
  ...coreCommands,
  ...modeCommands,
  ...checkpointCommands,
  ...gitCommands,
  ...devCommands,
  ...docCommands,
  ...securityCommands,
  ...contextCommands,
  ...sessionCommands,
  ...memoryCommands,
  ...personaCommands,
  ...autonomyCommands,
  ...toolCommands,
  ...statsCommands,
  ...voiceCommands,
  ...themeCommands,
  ...searchCommands,
  ...workflowCommands,
  ...agentControlCommands,
  ...promptCommands,
  ...newFeatureCommands,
  ...goldenPathCommands,
];

/**
 * Get builtin commands by category.
 */
export function getCommandsByCategory(): Record<string, SlashCommand[]> {
  return {
    core: coreCommands,
    mode: modeCommands,
    checkpoint: checkpointCommands,
    git: gitCommands,
    dev: devCommands,
    docs: docCommands,
    security: securityCommands,
    context: contextCommands,
    session: sessionCommands,
    memory: memoryCommands,
    persona: personaCommands,
    autonomy: autonomyCommands,
    tools: toolCommands,
    stats: statsCommands,
    voice: voiceCommands,
    theme: themeCommands,
    search: searchCommands,
    workflow: workflowCommands,
    agentControl: agentControlCommands,
    prompt: promptCommands,
    newFeatures: newFeatureCommands,
    goldenPath: goldenPathCommands,
  };
}
