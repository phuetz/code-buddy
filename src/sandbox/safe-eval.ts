/**
 * Safe Expression Evaluator
 *
 * Replaces unsafe `new Function()` and `eval()` calls with sandboxed
 * evaluation using Node.js `vm.runInNewContext()`.
 *
 * Security features:
 * - Runs code in an isolated V8 context (no access to global scope)
 * - Configurable timeout to prevent infinite loops
 * - Allowlisted globals only (no process, require, fs, etc.)
 * - No access to the module system
 */

import vm from 'node:vm';

export interface SafeEvalOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number;
  /** Additional context variables available to the expression */
  context?: Record<string, unknown>;
  /** Whether to wrap the code in an async IIFE (default: false) */
  async?: boolean;
}

const DEFAULT_TIMEOUT = 5000;

/**
 * Safely evaluate a JavaScript expression in an isolated V8 context.
 *
 * @param code - The JavaScript expression or code to evaluate
 * @param options - Evaluation options (timeout, context, async)
 * @returns The result of the evaluation
 * @throws Error if the code times out, throws, or is otherwise invalid
 */
export function safeEval(code: string, options: SafeEvalOptions = {}): unknown {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // Build sandbox with safe globals only
  const sandbox: Record<string, unknown> = {
    // Safe built-ins
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
    Promise,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    undefined,
  };

  // Safely copy user context, blocking prototype pollution keys
  if (options.context) {
    for (const [key, value] of Object.entries(options.context)) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        sandbox[key] = value;
      }
    }
  }

  const vmContext = vm.createContext(sandbox);

  return vm.runInNewContext(code, vmContext, {
    timeout,
    displayErrors: true,
  });
}

/**
 * Safely evaluate an async JavaScript expression in an isolated V8 context.
 *
 * The code is wrapped in an async IIFE so `await` can be used.
 * Note: The code cannot import modules or access the file system.
 *
 * @param code - The async JavaScript code to evaluate
 * @param options - Evaluation options (timeout, context)
 * @returns A promise resolving to the result of the evaluation
 */
export async function safeEvalAsync(
  code: string,
  options: SafeEvalOptions = {}
): Promise<unknown> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  const sandbox: Record<string, unknown> = {
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
    Promise,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    undefined,
  };

  // Safely copy user context, blocking prototype pollution keys
  if (options.context) {
    for (const [key, value] of Object.entries(options.context)) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        sandbox[key] = value;
      }
    }
  }

  const vmContext = vm.createContext(sandbox);

  // Wrap in async IIFE
  const wrappedCode = `(async () => { ${code} })()`;

  const result = vm.runInNewContext(wrappedCode, vmContext, {
    timeout,
    displayErrors: true,
  });

  // The async IIFE returns a Promise; await it
  return result;
}

/**
 * Safely evaluate a condition expression.
 *
 * Returns a boolean result. If evaluation fails, returns false.
 *
 * @param condition - The condition expression to evaluate
 * @param context - Variables available to the expression
 * @returns boolean result of the condition
 */
export function safeEvalCondition(
  condition: string,
  context: Record<string, unknown> = {}
): boolean {
  try {
    const result = safeEval(condition, { context, timeout: 2000 });
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Safely interpolate template expressions within `{{...}}` markers.
 *
 * Each expression is evaluated in a sandboxed context with the
 * provided variables. If an expression fails, the original
 * `{{expression}}` is preserved.
 *
 * @param template - The template string with `{{expr}}` placeholders
 * @param context - Variables available to expressions
 * @returns The interpolated string
 */
export function safeInterpolate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, expr: string) => {
    try {
      const result = safeEval(expr.trim(), { context, timeout: 1000 });
      return String(result);
    } catch {
      return match;
    }
  });
}
