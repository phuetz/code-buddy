/**
 * CodeAct Mode
 *
 * Mode where the LLM writes Python/TypeScript/shell as the universal action
 * instead of calling discrete tools. Only `run_script` is exposed as a tool.
 *
 * Based on the CodeAct paradigm: "Code as Action"
 * - Paper: https://arxiv.org/abs/2402.01030
 * - Manus AI uses this as their primary execution model
 *
 * When enabled:
 * 1. System prompt changes to encourage code generation
 * 2. Only `run_script` + `view_file` + `search` tools are available
 * 3. The LLM is instructed to solve tasks by writing executable scripts
 * 4. Results from script execution feed back into the conversation
 */

import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface CodeActConfig {
  /** Primary language for code generation */
  language: 'python' | 'typescript' | 'javascript' | 'shell';
  /** Whether to allow the LLM to install packages */
  allowPackageInstall: boolean;
  /** Maximum script execution time in ms */
  scriptTimeout: number;
  /** Use E2B cloud sandbox instead of Docker (if available) */
  preferE2B: boolean;
  /** Auto-persist scripts to workspace */
  persistScripts: boolean;
}

export interface CodeActState {
  enabled: boolean;
  config: CodeActConfig;
  executedScripts: number;
  totalDuration: number;
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_CODEACT_CONFIG: CodeActConfig = {
  language: 'python',
  allowPackageInstall: true,
  scriptTimeout: 120000,
  preferE2B: false,
  persistScripts: true,
};

/**
 * Tools allowed in CodeAct mode.
 * All other tools are filtered out.
 */
const CODEACT_ALLOWED_TOOLS = new Set([
  'run_script',
  'view_file',
  'search',
  'list_directory',
  'create_file',
  'str_replace_editor',
  'bash',
]);

// ============================================================================
// CodeAct System Prompt
// ============================================================================

const CODEACT_SYSTEM_PROMPT = `You are operating in CodeAct mode. In this mode, you solve tasks by writing and executing code rather than using individual tool calls.

## Rules
1. Write complete, self-contained scripts to accomplish tasks
2. Use the \`run_script\` tool to execute your code
3. Read script output to verify results and iterate if needed
4. You may use \`view_file\` and \`search\` to understand the codebase first
5. For file modifications, write a script that reads, transforms, and writes the file

## Preferred Language: {{LANGUAGE}}

## Tips
- Break complex tasks into sequential scripts
- Print clear output to verify each step
- Handle errors in your scripts
- Use the filesystem as working memory (write intermediate results to files)
- You can install packages if needed (pip install / npm install)

## Example
Instead of calling a "grep" tool, write:
\`\`\`python
import subprocess
result = subprocess.run(["grep", "-r", "TODO", "src/"], capture_output=True, text=True)
print(result.stdout)
\`\`\`
`;

// ============================================================================
// CodeAct Mode Manager (Singleton)
// ============================================================================

export class CodeActMode {
  private static instance: CodeActMode | null = null;

  private enabled = false;
  private config: CodeActConfig;
  private executedScripts = 0;
  private totalDuration = 0;

  private constructor(config?: Partial<CodeActConfig>) {
    this.config = { ...DEFAULT_CODEACT_CONFIG, ...config };
  }

  static getInstance(): CodeActMode {
    if (!CodeActMode.instance) {
      CodeActMode.instance = new CodeActMode();
    }
    return CodeActMode.instance;
  }

  static resetInstance(): void {
    CodeActMode.instance = null;
  }

  /**
   * Enable CodeAct mode
   */
  enable(config?: Partial<CodeActConfig>): void {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    this.enabled = true;
    this.executedScripts = 0;
    this.totalDuration = 0;
    logger.info(`CodeAct mode enabled (language: ${this.config.language})`);
  }

  /**
   * Disable CodeAct mode
   */
  disable(): void {
    this.enabled = false;
    logger.info('CodeAct mode disabled');
  }

  /**
   * Toggle CodeAct mode
   */
  toggle(): boolean {
    if (this.enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this.enabled;
  }

  /**
   * Check if CodeAct mode is active
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): CodeActConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<CodeActConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the CodeAct system prompt supplement
   */
  getSystemPrompt(): string {
    if (!this.enabled) return '';

    return CODEACT_SYSTEM_PROMPT.replace('{{LANGUAGE}}', this.config.language);
  }

  /**
   * Filter tools for CodeAct mode — only allow script execution + file reading
   */
  filterTools<T extends { function: { name: string } }>(tools: T[]): T[] {
    if (!this.enabled) return tools;

    return tools.filter(t => CODEACT_ALLOWED_TOOLS.has(t.function.name));
  }

  /**
   * Record a script execution for stats
   */
  recordExecution(durationMs: number): void {
    this.executedScripts++;
    this.totalDuration += durationMs;
  }

  /**
   * Get current state
   */
  getState(): CodeActState {
    return {
      enabled: this.enabled,
      config: { ...this.config },
      executedScripts: this.executedScripts,
      totalDuration: this.totalDuration,
    };
  }

  /**
   * Get allowed tool names in CodeAct mode
   */
  getAllowedTools(): string[] {
    return [...CODEACT_ALLOWED_TOOLS];
  }
}

/**
 * Convenience accessor
 */
export function getCodeActMode(): CodeActMode {
  return CodeActMode.getInstance();
}
