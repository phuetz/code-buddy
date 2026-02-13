/**
 * JavaScript REPL Runtime
 *
 * Persistent sandboxed JS execution environment using Node.js `vm` module.
 * Variables persist across calls. No access to require(), process, fs, etc.
 *
 * Registered as a tool for the agent to execute JavaScript expressions
 * and inspect results during coding sessions.
 */

import vm from 'vm';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types/index.js';
import type { ITool, ToolSchema, IToolMetadata } from './registry/types.js';

// ============================================================================
// Types
// ============================================================================

export interface JSReplResult {
  result: string;
  error?: string;
}

// ============================================================================
// JSRepl
// ============================================================================

/** Default execution timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

export class JSRepl {
  private context: vm.Context;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
    this.context = this.createSandboxedContext();
  }

  /**
   * Execute JavaScript code in the sandboxed context.
   * Variables persist across calls.
   */
  execute(code: string): JSReplResult {
    try {
      const script = new vm.Script(code, {
        filename: 'repl.js',
      });

      const result = script.runInContext(this.context, {
        timeout: this.timeoutMs,
        displayErrors: true,
      });

      return {
        result: this.formatResult(result),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        result: '',
        error: message,
      };
    }
  }

  /**
   * Reset the execution context, clearing all variables.
   */
  reset(): void {
    this.context = this.createSandboxedContext();
  }

  /**
   * Get all user-defined variables in the context.
   */
  getVariables(): Record<string, unknown> {
    const vars: Record<string, unknown> = {};
    const builtins = new Set([
      'console', 'JSON', 'Math', 'Date', 'Array', 'Object', 'String',
      'Number', 'Boolean', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet',
      'Promise', 'Symbol', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
      'ReferenceError', 'URIError', 'EvalError', 'parseInt', 'parseFloat',
      'isNaN', 'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent',
      'decodeURIComponent', 'undefined', 'NaN', 'Infinity', 'globalThis',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
      'structuredClone', 'atob', 'btoa', 'queueMicrotask',
    ]);

    for (const key of Object.getOwnPropertyNames(this.context)) {
      if (!builtins.has(key)) {
        try {
          vars[key] = this.context[key];
        } catch {
          vars[key] = '[inaccessible]';
        }
      }
    }

    return vars;
  }

  /**
   * Create a sandboxed VM context with safe globals only.
   */
  private createSandboxedContext(): vm.Context {
    const sandbox: Record<string, unknown> = {
      // Safe globals
      console: {
        log: (...args: unknown[]) => args.map(a => String(a)).join(' '),
        warn: (...args: unknown[]) => args.map(a => String(a)).join(' '),
        error: (...args: unknown[]) => args.map(a => String(a)).join(' '),
        info: (...args: unknown[]) => args.map(a => String(a)).join(' '),
      },
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      Symbol,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      ReferenceError,
      URIError,
      EvalError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURI,
      decodeURI,
      encodeURIComponent,
      decodeURIComponent,
      undefined,
      NaN,
      Infinity,
    };

    // Explicitly block dangerous access
    // require, process, fs, child_process, etc. are NOT provided
    return vm.createContext(sandbox, {
      name: 'codebuddy-repl',
    });
  }

  /**
   * Format a value for display.
   */
  private formatResult(value: unknown): string {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'function') {
      return `[Function: ${value.name || 'anonymous'}]`;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}

// ============================================================================
// Tool Adapter
// ============================================================================

export class JSReplTool implements ITool {
  readonly name = 'js_repl';
  readonly description = 'Execute JavaScript code in a persistent sandboxed REPL. Variables persist across calls. No filesystem or network access.';

  private repl: JSRepl;

  constructor() {
    this.repl = new JSRepl();
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = (input['action'] as string) ?? 'execute';

    if (action === 'reset') {
      this.repl.reset();
      return { success: true, output: 'REPL context reset.' };
    }

    if (action === 'variables') {
      const vars = this.repl.getVariables();
      const keys = Object.keys(vars);
      if (keys.length === 0) {
        return { success: true, output: 'No user-defined variables.' };
      }
      const formatted = keys
        .map((k) => `${k} = ${JSON.stringify(vars[k])}`)
        .join('\n');
      return { success: true, output: formatted };
    }

    // Default: execute code
    const code = input['code'] as string;
    if (!code) {
      return { success: false, error: 'No code provided' };
    }

    const result = this.repl.execute(code);
    if (result.error) {
      return { success: false, output: result.result || undefined, error: result.error };
    }
    return { success: true, output: result.result };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'Action to perform: execute (default), reset, variables',
            enum: ['execute', 'reset', 'variables'],
          },
          code: {
            type: 'string',
            description: 'JavaScript code to execute',
          },
        },
      },
    };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      category: 'utility',
      keywords: ['javascript', 'js', 'repl', 'evaluate', 'execute', 'compute', 'calculate'],
      priority: 3,
      description: this.description,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  validate(input: unknown): { valid: boolean; errors?: string[] } {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const obj = input as Record<string, unknown>;
    const action = obj['action'] ?? 'execute';
    if (action === 'execute' && typeof obj['code'] !== 'string') {
      return { valid: false, errors: ['code parameter is required for execute action'] };
    }
    return { valid: true };
  }

  dispose(): void {
    // Context will be GC'd
  }
}

// ============================================================================
// Tool Definition (OpenAI function calling format)
// ============================================================================

export const JS_REPL_TOOL = {
  type: 'function' as const,
  function: {
    name: 'js_repl',
    description: 'Execute JavaScript code in a persistent sandboxed REPL. Variables persist across calls. No filesystem or network access.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['execute', 'reset', 'variables'],
          description: 'Action: execute code (default), reset context, or list variables',
        },
        code: {
          type: 'string',
          description: 'JavaScript code to execute (required for execute action)',
        },
      },
    },
  },
};

// ============================================================================
// Singleton
// ============================================================================

let replInstance: JSRepl | null = null;

export function getJSRepl(): JSRepl {
  if (!replInstance) {
    replInstance = new JSRepl();
  }
  return replInstance;
}

export function resetJSRepl(): void {
  replInstance = null;
}
