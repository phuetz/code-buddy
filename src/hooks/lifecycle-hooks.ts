/**
 * Lifecycle Hooks System
 *
 * Implements pre/post hooks for various operations, similar to Claude Code.
 * Allows users to customize behavior and integrate with their workflows.
 *
 * Hook Types:
 * - pre-edit: Before file is modified
 * - post-edit: After file is modified
 * - pre-bash: Before bash command is executed
 * - post-bash: After bash command completes
 * - pre-commit: Before git commit (lint + test + review)
 * - post-commit: After git commit
 * - pre-prompt: Before LLM prompt is sent
 * - post-response: After LLM response is received
 */

import { spawn, SpawnOptions } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { EventEmitter } from "events";
import { logger } from "../utils/logger.js";

/**
 * Hook types
 */
export type HookType =
  | "pre-edit"
  | "post-edit"
  | "pre-bash"
  | "post-bash"
  | "pre-commit"
  | "post-commit"
  | "pre-prompt"
  | "post-response"
  | "on-error"
  | "on-tool-call"
  | "command:new"
  | "command:reset"
  | "command:stop"
  | "session:compact:before"
  | "session:compact:after"
  | "agent:bootstrap"
  | "gateway:startup"
  | "message:received"
  | "message:transcribed"
  | "message:preprocessed"
  | "message:sent";

/**
 * Hook execution context
 */
export interface HookContext {
  type: HookType;
  timestamp: Date;
  workingDirectory: string;
  // Type-specific data
  file?: string;
  content?: string;
  command?: string;
  output?: string;
  error?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  prompt?: string;
  response?: string;
  // Metadata
  sessionId?: string;
  model?: string;
}

/**
 * Hook definition
 */
export interface HookDefinition {
  name: string;
  type: HookType;
  command?: string;
  script?: string;
  handler?: (context: HookContext) => Promise<HookResult>;
  enabled: boolean;
  timeout: number;
  failOnError: boolean;
  // Filters
  filePatterns?: string[];
  commandPatterns?: string[];
}

/**
 * Hook execution result
 */
export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  modified?: {
    content?: string;
    command?: string;
    prompt?: string;
  };
  abort?: boolean;
}

/**
 * Hooks configuration
 */
export interface HooksConfig {
  enabled: boolean;
  configPath: string;
  timeout: number;
  hooks: HookDefinition[];
}

/**
 * Default hooks configuration
 */
export const DEFAULT_HOOKS_CONFIG: HooksConfig = {
  enabled: true,
  configPath: ".codebuddy/hooks.json",
  timeout: 30000,
  hooks: [],
};

/**
 * Built-in hooks
 */
export const BUILTIN_HOOKS: HookDefinition[] = [
  {
    name: "lint-on-edit",
    type: "post-edit",
    command: "npx eslint --fix ${file}",
    enabled: false,
    timeout: 10000,
    failOnError: false,
    filePatterns: ["*.ts", "*.tsx", "*.js", "*.jsx"],
  },
  {
    name: "format-on-edit",
    type: "post-edit",
    command: "npx prettier --write ${file}",
    enabled: false,
    timeout: 5000,
    failOnError: false,
    filePatterns: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.json", "*.md"],
  },
  {
    name: "test-on-edit",
    type: "post-edit",
    command: "npm test -- --findRelatedTests ${file}",
    enabled: false,
    timeout: 60000,
    failOnError: false,
    filePatterns: ["*.ts", "*.tsx", "*.js", "*.jsx"],
  },
  {
    name: "pre-commit-lint",
    type: "pre-commit",
    command: "npm run lint",
    enabled: false,
    timeout: 30000,
    failOnError: true,
  },
  {
    name: "pre-commit-test",
    type: "pre-commit",
    command: "npm test",
    enabled: false,
    timeout: 120000,
    failOnError: true,
  },
];

/**
 * Lifecycle Hooks Manager
 *
 * Manages hook registration, execution, and configuration.
 */
export class HooksManager extends EventEmitter {
  private config: HooksConfig;
  private hooks: Map<HookType, HookDefinition[]> = new Map();
  private workingDirectory: string;

  constructor(workingDirectory: string, config: Partial<HooksConfig> = {}) {
    super();
    this.workingDirectory = workingDirectory;
    this.config = { ...DEFAULT_HOOKS_CONFIG, ...config };
    this.loadHooks();
  }

  /**
   * Load hooks from configuration
   */
  private loadHooks(): void {
    // Clear existing hooks
    this.hooks.clear();

    // Load from config file if exists
    const configPath = path.join(this.workingDirectory, this.config.configPath);
    if (fs.existsSync(configPath)) {
      try {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (Array.isArray(fileConfig.hooks)) {
          for (const hook of fileConfig.hooks) {
            this.registerHook(hook);
          }
        }
        logger.debug(`Loaded ${fileConfig.hooks?.length || 0} hooks from ${configPath}`);
      } catch (error) {
        logger.warn(`Failed to load hooks config: ${error}`);
      }
    }

    // Add built-in hooks
    for (const hook of BUILTIN_HOOKS) {
      if (!this.hasHook(hook.name)) {
        this.registerHook(hook);
      }
    }

    // Add hooks from config
    for (const hook of this.config.hooks) {
      this.registerHook(hook);
    }
  }

  /**
   * Check if hook exists
   */
  hasHook(name: string): boolean {
    for (const hooks of this.hooks.values()) {
      if (hooks.some(h => h.name === name)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Register a hook
   */
  registerHook(hook: HookDefinition): void {
    if (!this.hooks.has(hook.type)) {
      this.hooks.set(hook.type, []);
    }
    this.hooks.get(hook.type)!.push(hook);
    this.emit("hook:registered", { name: hook.name, type: hook.type });
  }

  /**
   * Unregister a hook
   */
  unregisterHook(name: string): boolean {
    for (const [type, hooks] of this.hooks) {
      const index = hooks.findIndex(h => h.name === name);
      if (index !== -1) {
        hooks.splice(index, 1);
        this.emit("hook:unregistered", { name, type });
        return true;
      }
    }
    return false;
  }

  /**
   * Enable/disable a hook
   */
  setHookEnabled(name: string, enabled: boolean): boolean {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find(h => h.name === name);
      if (hook) {
        hook.enabled = enabled;
        this.emit("hook:toggled", { name, enabled });
        return true;
      }
    }
    return false;
  }

  /**
   * Execute a shell command
   */
  private async executeCommand(
    command: string,
    context: HookContext,
    timeout: number
  ): Promise<HookResult> {
    const startTime = Date.now();

    // Replace variables in command
    let expandedCommand = command;
    if (context.file) {
      expandedCommand = expandedCommand.replace(/\$\{file\}/g, context.file);
    }
    if (context.command) {
      expandedCommand = expandedCommand.replace(/\$\{command\}/g, context.command);
    }

    return new Promise((resolve) => {
      const options: SpawnOptions = {
        cwd: this.workingDirectory,
        timeout,
        shell: true,
      };

      let stdout = "";
      let stderr = "";

      const proc = spawn(expandedCommand, [], options);

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("error", (error) => {
        resolve({
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
        });
      });

      proc.on("close", (code) => {
        resolve({
          success: code === 0,
          output: stdout,
          error: code !== 0 ? stderr : undefined,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Check if hook matches context
   */
  private matchesContext(hook: HookDefinition, context: HookContext): boolean {
    // Check file patterns
    if (hook.filePatterns && context.file) {
      const filename = path.basename(context.file);
      const matches = hook.filePatterns.some(pattern => {
        if (pattern.startsWith("*")) {
          return filename.endsWith(pattern.slice(1));
        }
        return filename === pattern;
      });
      if (!matches) return false;
    }

    // Check command patterns
    if (hook.commandPatterns && context.command) {
      const matches = hook.commandPatterns.some(pattern =>
        context.command!.includes(pattern)
      );
      if (!matches) return false;
    }

    return true;
  }

  /**
   * Execute hooks for a given type
   */
  async executeHooks(
    type: HookType,
    context: Omit<HookContext, "type" | "timestamp" | "workingDirectory">
  ): Promise<HookResult[]> {
    if (!this.config.enabled) {
      return [];
    }

    const hooks = this.hooks.get(type) || [];
    const enabledHooks = hooks.filter(h => h.enabled);

    if (enabledHooks.length === 0) {
      return [];
    }

    const fullContext: HookContext = {
      type,
      timestamp: new Date(),
      workingDirectory: this.workingDirectory,
      ...context,
    };

    const results: HookResult[] = [];

    for (const hook of enabledHooks) {
      if (!this.matchesContext(hook, fullContext)) {
        continue;
      }

      this.emit("hook:executing", { name: hook.name, type });

      let result: HookResult;

      try {
        if (hook.handler) {
          // Execute custom handler
          result = await hook.handler(fullContext);
        } else if (hook.command) {
          // Execute shell command
          result = await this.executeCommand(
            hook.command,
            fullContext,
            hook.timeout || this.config.timeout
          );
        } else if (hook.script) {
          // Execute script file
          const scriptPath = path.join(this.workingDirectory, hook.script);
          result = await this.executeCommand(
            `node "${scriptPath}"`,
            fullContext,
            hook.timeout || this.config.timeout
          );
        } else {
          result = { success: true, duration: 0 };
        }
      } catch (error) {
        result = {
          success: false,
          error: String(error),
          duration: 0,
        };
      }

      results.push(result);

      this.emit("hook:executed", { name: hook.name, type, result });

      // Stop if hook failed and failOnError is set
      if (!result.success && hook.failOnError) {
        this.emit("hook:failed", { name: hook.name, type, error: result.error });
        break;
      }

      // Stop if hook requests abort
      if (result.abort) {
        this.emit("hook:aborted", { name: hook.name, type });
        break;
      }
    }

    return results;
  }

  /**
   * Get all registered hooks
   */
  getHooks(): Map<HookType, HookDefinition[]> {
    return new Map(this.hooks);
  }

  /**
   * Get hooks by type
   */
  getHooksByType(type: HookType): HookDefinition[] {
    return [...(this.hooks.get(type) || [])];
  }

  /**
   * Format hooks status for display
   */
  formatStatus(): string {
    const lines: string[] = ["🪝 Lifecycle Hooks"];

    if (!this.config.enabled) {
      lines.push("  Status: Disabled");
      return lines.join("\n");
    }

    let totalHooks = 0;
    let enabledHooks = 0;

    for (const [type, hooks] of this.hooks) {
      const enabled = hooks.filter(h => h.enabled);
      totalHooks += hooks.length;
      enabledHooks += enabled.length;

      if (enabled.length > 0) {
        lines.push(`  ${type}: ${enabled.length} enabled`);
        for (const hook of enabled) {
          lines.push(`    • ${hook.name}`);
        }
      }
    }

    if (enabledHooks === 0) {
      lines.push("  No hooks enabled");
    }

    lines.push(`  Total: ${enabledHooks}/${totalHooks} enabled`);

    return lines.join("\n");
  }

  /**
   * Save hooks configuration
   */
  saveConfig(): void {
    const configPath = path.join(this.workingDirectory, this.config.configPath);
    const dir = path.dirname(configPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const allHooks: HookDefinition[] = [];
    for (const hooks of this.hooks.values()) {
      allHooks.push(...hooks);
    }

    const config = {
      enabled: this.config.enabled,
      timeout: this.config.timeout,
      hooks: allHooks.filter(h => !BUILTIN_HOOKS.some(b => b.name === h.name)),
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    logger.debug(`Saved hooks config to ${configPath}`);
  }

  /**
   * Get configuration
   */
  getConfig(): HooksConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<HooksConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.hooks) {
      this.loadHooks();
    }
  }
}

// Singleton instance
let hooksManager: HooksManager | null = null;

/**
 * Get or create hooks manager instance
 */
export function getHooksManager(
  workingDirectory?: string,
  config?: Partial<HooksConfig>
): HooksManager {
  if (!hooksManager || workingDirectory) {
    hooksManager = new HooksManager(
      workingDirectory || process.cwd(),
      config
    );
  }
  return hooksManager;
}

/**
 * Initialize hooks manager
 */
export function initializeHooks(
  workingDirectory: string,
  config?: Partial<HooksConfig>
): HooksManager {
  hooksManager = new HooksManager(workingDirectory, config);
  return hooksManager;
}
