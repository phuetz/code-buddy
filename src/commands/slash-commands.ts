import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Definition of a slash command.
 */
export interface SlashCommand {
  /** The name of the command (without the slash). */
  name: string;
  /** A brief description of what the command does. */
  description: string;
  /** The prompt text or special token associated with the command. */
  prompt: string;
  /** The file path where the command is defined (empty for built-ins). */
  filePath: string;
  /** Whether the command is built-in or custom. */
  isBuiltin: boolean;
  /** List of arguments accepted by the command. */
  arguments?: SlashCommandArgument[];
}

/**
 * Definition of an argument for a slash command.
 */
export interface SlashCommandArgument {
  /** The name of the argument. */
  name: string;
  /** Description of the argument. */
  description: string;
  /** Whether the argument is required. */
  required: boolean;
  /** Default value for the argument if not provided. */
  default?: string;
}

/**
 * Result of executing or parsing a slash command.
 */
export interface SlashCommandResult {
  /** Whether the command execution/parsing was successful. */
  success: boolean;
  /** The generated prompt or context to be sent to the AI (if applicable). */
  prompt?: string;
  /** Error message if the command failed. */
  error?: string;
  /** The command definition that was matched. */
  command?: SlashCommand;
}

/**
 * Slash Commands Manager - Inspired by Claude Code.
 *
 * Manages the registration, parsing, and execution of slash commands.
 * Supports both built-in commands and custom commands loaded from
 * `.codebuddy/commands/*.md` files in the project or home directory.
 */
export class SlashCommandManager {
  private commands: Map<string, SlashCommand> = new Map();
  private workingDirectory: string;
  private commandsDirs: string[];

  /**
   * Creates a new instance of SlashCommandManager.
   *
   * @param workingDirectory - The current working directory (defaults to process.cwd()).
   */
  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
    this.commandsDirs = [
      path.join(workingDirectory, '.codebuddy', 'commands'),
      path.join(os.homedir(), '.codebuddy', 'commands')
    ];

    this.loadBuiltinCommands();
    this.loadCustomCommands();
  }

  /**
   * Loads the set of built-in slash commands.
   * These commands are hardcoded and always available.
   */
  private loadBuiltinCommands(): void {
    const builtinCommands: SlashCommand[] = [
      {
        name: 'help',
        description: 'Show available commands and help information',
        prompt: '__HELP__',
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
        name: 'diff',
        description: 'Show diff between two checkpoints',
        prompt: '__DIFF_CHECKPOINTS__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'from', description: 'First checkpoint ID (or "last" for last two)', required: false },
          { name: 'to', description: 'Second checkpoint ID', required: false }
        ]
      },
      {
        name: 'review',
        description: 'Review code changes before commit',
        prompt: `You are a code reviewer. Analyze the current git changes and provide a detailed code review.

1. First, run git diff to see all unstaged changes
2. Run git diff --cached to see staged changes
3. Analyze the changes for:
   - Code quality and best practices
   - Potential bugs or issues
   - Security vulnerabilities
   - Performance concerns
   - Missing tests
   - Code style consistency

Provide a structured review with:
- Summary of changes
- Issues found (critical, warnings, suggestions)
- Recommendations
- Overall assessment (approve/request changes)`,
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
        name: 'test',
        description: 'Run tests and analyze results',
        prompt: `Run the project's test suite and analyze the results:

1. Detect the test framework (jest, vitest, mocha, pytest, etc.)
2. Run the tests with verbose output
3. If tests fail:
   - Analyze the failures
   - Suggest fixes for failing tests
   - Offer to fix them if appropriate
4. Provide a summary of test results`,
        filePath: '',
        isBuiltin: true
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
        name: 'debug',
        description: 'Help debug an issue',
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
        name: 'security',
        description: 'Security audit of the code',
        prompt: `Perform a security audit of the code:

1. Scan for common vulnerabilities:
   - SQL injection
   - XSS
   - CSRF
   - Command injection
   - Path traversal
   - Insecure dependencies
2. Check for sensitive data exposure
3. Review authentication/authorization
4. Provide severity ratings and remediation steps`,
        filePath: '',
        isBuiltin: true
      },
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
        name: 'init',
        description: 'Initialize .grok directory with templates',
        prompt: '__INIT_GROK__',
        filePath: '',
        isBuiltin: true
      },
      {
        name: 'features',
        description: 'Display research-based features implemented in Grok CLI',
        prompt: '__FEATURES__',
        filePath: '',
        isBuiltin: true
      },
      // ==========================================
      // New Enhanced Commands (Competitor Features)
      // ==========================================
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
        name: 'pipeline',
        description: 'Run agent pipeline workflow',
        prompt: '__PIPELINE__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'name', description: 'Pipeline name: code-review, bug-fix, feature-development, security-audit, documentation', required: false }
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
        name: 'security',
        description: 'Show security dashboard and settings',
        prompt: '__SECURITY__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'action', description: 'status, mode <mode>, reset', required: false }
        ]
      },
      // Session Management (Mistral Vibe-style)
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
        name: 'workspace',
        description: 'Detect and show workspace configuration',
        prompt: '__WORKSPACE__',
        filePath: '',
        isBuiltin: true
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
        name: 'model-router',
        description: 'Configure multi-model routing',
        prompt: '__MODEL_ROUTER__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'action', description: 'status, auto, manual, set <task> <model>', required: false }
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
        name: 'autonomy',
        description: 'Set autonomy level (suggest, confirm, auto, full, yolo)',
        prompt: '__AUTONOMY__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'level', description: 'Autonomy level', required: false }
        ]
      },
      // ==========================================
      // Context & Session Management Commands
      // ==========================================
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
        name: 'context',
        description: 'View or manage loaded context files',
        prompt: '__CONTEXT__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'action', description: 'list, clear, or summary', required: false }
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
      // ==========================================
      // Theme & Customization Commands
      // ==========================================
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
      // ==========================================
      // Voice Input Commands
      // ==========================================
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
      },
      // ==========================================
      // AI Testing Command
      // ==========================================
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
      // ==========================================
      // Code Guardian - CodeBuddynette
      // ==========================================
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
      // ==========================================
      // Custom Agents (Mistral Vibe-style)
      // ==========================================
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
      // ==========================================
      // Mistral Vibe-inspired Commands
      // ==========================================
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
        name: 'vim',
        description: 'Toggle Vim keybindings mode',
        prompt: '__VIM_MODE__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'action', description: 'on, off, status', required: false }
        ]
      },
      // ==========================================
      // Claude Code-inspired Commands
      // ==========================================
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
        name: 'worktree',
        description: 'Manage git worktrees for parallel instances (Claude Code-style)',
        prompt: '__WORKTREE__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'action', description: 'list, add <path> [branch], remove <path>, prune, lock, unlock', required: false }
        ]
      },
      // ==========================================
      // FileCommander Enhanced-inspired Commands
      // ==========================================
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
      // ==========================================
      // Research-Based Improvements (2024-2025)
      // TDD, CI/CD, Hooks - Based on scientific publications
      // ==========================================
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
        name: 'prompt-cache',
        description: 'Manage prompt caching (up to 90% cost reduction)',
        prompt: '__PROMPT_CACHE__',
        filePath: '',
        isBuiltin: true,
        arguments: [
          { name: 'action', description: 'status, on, off, clear, warm', required: false }
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
      // ==========================================
      // Track System (Conductor-inspired)
      // Context-driven development: spec → plan → implement
      // ==========================================
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
      // ==========================================
      // AI Collaboration Commands
      // Multi-AI collaboration workflow management
      // ==========================================
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

    for (const cmd of builtinCommands) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /**
   * Loads custom commands from `.codebuddy/commands/*.md` files.
   * Scans both the project directory and the user's home directory.
   */
  private loadCustomCommands(): void {
    for (const commandsDir of this.commandsDirs) {
      if (!fs.existsSync(commandsDir)) {
        continue;
      }

      try {
        const files = fs.readdirSync(commandsDir);

        for (const file of files) {
          if (!file.endsWith('.md')) continue;

          const filePath = path.join(commandsDir, file);
          const commandName = path.basename(file, '.md');

          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const { description, prompt, arguments: args } = this.parseCommandFile(content);

            // Custom commands override builtin commands
            this.commands.set(commandName, {
              name: commandName,
              description: description || `Custom command: ${commandName}`,
              prompt,
              filePath,
              isBuiltin: false,
              arguments: args
            });
          } catch (error) {
            console.warn(`Failed to load custom command ${commandName}:`, error);
          }
        }
      } catch (_error) {
        // Directory doesn't exist or can't be read
      }
    }
  }

  /**
   * Parses the content of a command markdown file.
   * Extracts YAML frontmatter for metadata and uses the rest as the prompt.
   *
   * @param content - The raw content of the markdown file.
   * @returns An object containing description, prompt, and optional arguments.
   */
  private parseCommandFile(content: string): {
    description: string;
    prompt: string;
    arguments?: SlashCommandArgument[];
  } {
    const lines = content.split('\n');
    let description = '';
    let prompt = '';
    const args: SlashCommandArgument[] = [];

    let inFrontmatter = false;
    let frontmatterDone = false;
    const promptLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle YAML frontmatter
      if (line.trim() === '---') {
        if (!frontmatterDone) {
          inFrontmatter = !inFrontmatter;
          if (!inFrontmatter) {
            frontmatterDone = true;
          }
          continue;
        }
      }

      if (inFrontmatter) {
        // Parse frontmatter
        const descMatch = line.match(/^description:\s*(.+)$/);
        if (descMatch) {
          description = descMatch[1].trim().replace(/^["']|["']$/g, '');
        }

        const argMatch = line.match(/^argument:\s*(.+)$/);
        if (argMatch) {
          const argParts = argMatch[1].split(',').map(s => s.trim());
          args.push({
            name: argParts[0] || 'arg',
            description: argParts[1] || '',
            required: argParts[2] === 'required'
          });
        }
      } else {
        // Everything after frontmatter is the prompt
        promptLines.push(line);
      }
    }

    prompt = promptLines.join('\n').trim();

    // If no frontmatter, first line starting with # is description
    if (!description && prompt.startsWith('#')) {
      const firstLineEnd = prompt.indexOf('\n');
      if (firstLineEnd > 0) {
        description = prompt.substring(1, firstLineEnd).trim();
        prompt = prompt.substring(firstLineEnd + 1).trim();
      }
    }

    return { description, prompt, arguments: args.length > 0 ? args : undefined };
  }

  /**
   * Retrieves all available slash commands.
   *
   * @returns An array of all registered commands.
   */
  getCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Retrieves a specific command by name.
   *
   * @param name - The name of the command to retrieve.
   * @returns The command definition or undefined if not found.
   */
  getCommand(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Retrieves all registered commands.
   * Alias for `getCommands()`.
   *
   * @returns An array of all registered commands.
   */
  getAllCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Executes a slash command string.
   * Handles argument substitution and checks for command existence.
   *
   * @param input - The full command string (e.g., "/help", "/mode code").
   * @returns The result of the execution, including the prompt to send or an error.
   */
  execute(input: string): SlashCommandResult {
    // Parse command and arguments
    const parts = input.trim().split(/\s+/);
    const commandName = parts[0].replace(/^\//, '');
    const args = parts.slice(1);

    const command = this.commands.get(commandName);

    if (!command) {
      // Check for partial matches
      const matches = Array.from(this.commands.keys())
        .filter(name => name.startsWith(commandName));

      if (matches.length === 1) {
        return this.execute(`/${matches[0]} ${args.join(' ')}`);
      }

      return {
        success: false,
        error: `Unknown command: /${commandName}. Use /help to see available commands.`
      };
    }

    // Handle special built-in commands
    if (command.prompt.startsWith('__')) {
      return {
        success: true,
        prompt: command.prompt,
        command
      };
    }

    // Replace argument placeholders in prompt
    let prompt = command.prompt;

    if (args.length > 0) {
      // Replace $1, $2, etc. with arguments
      args.forEach((arg, index) => {
        prompt = prompt.replace(new RegExp(`\\$${index + 1}`, 'g'), arg);
      });

      // Replace $@ with all arguments
      prompt = prompt.replace(/\$@/g, args.join(' '));

      // Append arguments if no placeholders
      if (!command.prompt.includes('$')) {
        prompt = `${prompt}\n\nContext: ${args.join(' ')}`;
      }
    }

    return {
      success: true,
      prompt,
      command
    };
  }

  /**
   * Formats a user-friendly list of all available commands.
   * Separates built-in commands from custom commands.
   *
   * @returns A formatted string ready for display.
   */
  formatCommandsList(): string {
    const builtinCmds = Array.from(this.commands.values())
      .filter(cmd => cmd.isBuiltin);
    const customCmds = Array.from(this.commands.values())
      .filter(cmd => !cmd.isBuiltin);

    let output = '📚 Available Slash Commands\n' + '═'.repeat(50) + '\n\n';

    output += '🔧 Built-in Commands:\n' + '─'.repeat(30) + '\n';
    for (const cmd of builtinCmds) {
      const argsStr = cmd.arguments
        ? cmd.arguments.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')
        : '';
      output += `  /${cmd.name}${argsStr ? ' ' + argsStr : ''}\n`;
      output += `    ${cmd.description}\n\n`;
    }

    if (customCmds.length > 0) {
      output += '\n📁 Custom Commands:\n' + '─'.repeat(30) + '\n';
      for (const cmd of customCmds) {
        const argsStr = cmd.arguments
          ? cmd.arguments.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')
          : '';
        output += `  /${cmd.name}${argsStr ? ' ' + argsStr : ''}\n`;
        output += `    ${cmd.description}\n`;
        output += `    📄 ${cmd.filePath}\n\n`;
      }
    }

    output += '\n💡 Create custom commands in .codebuddy/commands/*.md';

    return output;
  }

  /**
   * Reloads all commands from disk.
   * Useful after adding or editing custom command files.
   */
  reload(): void {
    this.commands.clear();
    this.loadBuiltinCommands();
    this.loadCustomCommands();
  }

  /**
   * Creates a new custom command template file.
   *
   * @param name - The name of the new command.
   * @param description - The description of the new command.
   * @returns The file path of the created command template.
   */
  createCommandTemplate(name: string, description: string): string {
    const commandsDir = path.join(this.workingDirectory, '.codebuddy', 'commands');

    // Ensure directory exists
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }

    const filePath = path.join(commandsDir, `${name}.md`);

    const template = `--- 
description: ${description}
---

# ${name}

Your prompt instructions here.

You can use $1, $2, etc. for arguments, or $@ for all arguments.

Example usage: /${name} argument1 argument2
`;

    fs.writeFileSync(filePath, template);
    this.reload();

    return filePath;
  }
}

// Singleton instance
let slashCommandManagerInstance: SlashCommandManager | null = null;

/**
 * Gets the singleton instance of SlashCommandManager.
 *
 * @param workingDirectory - Optional working directory to initialize with.
 * @returns The singleton instance.
 */
export function getSlashCommandManager(workingDirectory?: string): SlashCommandManager {
  if (!slashCommandManagerInstance || workingDirectory) {
    slashCommandManagerInstance = new SlashCommandManager(workingDirectory);
  }
  return slashCommandManagerInstance;
}

/**
 * Resets the singleton instance of SlashCommandManager.
 * Primarily used for testing.
 */
export function resetSlashCommandManager(): void {
  slashCommandManagerInstance = null;
}