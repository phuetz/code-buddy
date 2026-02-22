/**
 * Built-in Slash Commands
 *
 * Contains all built-in command definitions for the slash command system.
 * Commands are organized by category for maintainability.
 */

import type { SlashCommand } from './types.js';

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
  // /shortcuts — removed: no handler implemented (audit 2026-02-22)
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
    name: 'config',
    description: 'Validate configuration files and environment variables',
    prompt: '__CONFIG__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'validate, show, defaults <schema>, docs <schema>', required: false }
    ]
  }
];

// ============================================================================
// Mode & Model Commands
// ============================================================================

const modeCommands: SlashCommand[] = [
  {
    name: 'model',
    description: 'Change the AI model',
    prompt: '__CHANGE_MODEL__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'model', description: 'Model name to switch to', required: false }
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
    description: 'Manage git worktrees for parallel instances (Claude Code-style)',
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
    description: 'Run linter and fix issues',
    prompt: `Run the project's linter and help fix any issues:

1. Detect the linter (eslint, prettier, pylint, etc.)
2. Run the linter
3. If issues are found:
   - List all issues by severity
   - Offer to auto-fix what's possible
   - Suggest manual fixes for complex issues
4. Provide a summary`,
    filePath: '',
    isBuiltin: true
  },
  {
    name: 'fix',
    description: 'Auto-fix lint errors and check for type errors',
    prompt: '__FIX__',
    filePath: '',
    isBuiltin: true
  },
  // /debug — removed: no handler implemented (audit 2026-02-22)
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
      { name: 'action', description: 'list, show <id>, replay <id>, delete <id>', required: false }
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
    description: 'Manage tool permissions and allowlist (Claude Code-style)',
    prompt: '__PERMISSIONS__',
    filePath: '',
    isBuiltin: true,
    arguments: [
      { name: 'action', description: 'list, add <tool>, remove <tool>, categories, save, reset', required: false }
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
  }
];

// ============================================================================
// Tools & Pipeline Commands
// ============================================================================

const toolCommands: SlashCommand[] = [
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
  // /tool-analytics — removed: no handler implemented (audit 2026-02-22)
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
  }
];
// ============================================================================
// Agent Control Commands
// ============================================================================

const agentControlCommands: SlashCommand[] = [
  // Dead slash commands removed during audit (2026-02-22):
  // /think, /queue, /subagents, /new, /reset, /status, /verbose
  // These had __TOKEN__ prompts with no handler implementation.
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
  ...agentControlCommands
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
    agentControl: agentControlCommands
  };
}
