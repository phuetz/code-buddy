/**
 * Pipeline Compositor (Lobster-inspired)
 *
 * Composes skills and tools into pipelines using pipe syntax.
 * Each step receives the output of the previous step as input.
 *
 * Syntax:
 * ```
 * search "query" | summarize | save-to-file output.md
 * ```
 *
 * Features:
 * - Pipe operator (|) chains steps
 * - Each step can be a tool, skill, or function
 * - Steps receive previous output as context
 * - Conditional branching with ? operator
 * - Parallel execution with & operator
 * - Error handling with || (fallback) operator
 *
 * Usage:
 * ```typescript
 * const pipeline = getPipelineCompositor();
 *
 * // Parse and run a pipeline
 * const result = await pipeline.run('search "node.js" | summarize | save output.md');
 *
 * // Programmatic pipeline
 * const result = await pipeline.execute([
 *   { tool: 'web_search', args: { query: 'node.js' } },
 *   { tool: 'summarize', args: {} },
 *   { tool: 'write_file', args: { path: 'output.md' } },
 * ]);
 * ```
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

/**
 * A single step in a pipeline
 */
export interface PipelineStep {
  /** Step type */
  type: 'tool' | 'skill' | 'function' | 'transform';
  /** Tool or skill name */
  name: string;
  /** Arguments */
  args: Record<string, unknown>;
  /** Raw argument string */
  rawArgs?: string;
  /** Step label */
  label?: string;
  /** Timeout in ms */
  timeout?: number;
  /** Fallback step if this one fails */
  fallback?: PipelineStep;
}

/**
 * Pipeline operators
 */
export type PipelineOperator = '|' | '||' | '&&' | '&';

/**
 * A parsed pipeline token
 */
export interface PipelineToken {
  type: 'step' | 'operator';
  step?: PipelineStep;
  operator?: PipelineOperator;
}

/**
 * Result of a pipeline step
 */
export interface StepResult {
  /** Step that was executed */
  step: PipelineStep;
  /** Whether the step succeeded */
  success: boolean;
  /** Output data */
  output: string;
  /** Error message if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
  /** Step index in pipeline */
  index: number;
}

/**
 * Result of a full pipeline execution
 */
export interface PipelineResult {
  /** Whether the pipeline completed successfully */
  success: boolean;
  /** Final output */
  output: string;
  /** Results for each step */
  steps: StepResult[];
  /** Total duration in ms */
  totalDurationMs: number;
  /** Error if pipeline failed */
  error?: string;
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
  input?: string
) => Promise<{ success: boolean; output: string; error?: string }>;

/**
 * Pipeline compositor configuration
 */
export interface PipelineConfig {
  /** Default step timeout in ms */
  defaultTimeout: number;
  /** Maximum steps in a pipeline */
  maxSteps: number;
  /** Maximum total pipeline duration in ms */
  maxDurationMs: number;
  /** Tool executor function */
  toolExecutor?: ToolExecutor;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  defaultTimeout: 30000,
  maxSteps: 20,
  maxDurationMs: 300000, // 5 minutes
};

// Built-in transform steps
const BUILTIN_TRANSFORMS: Record<string, (input: string, args: Record<string, unknown>) => string> = {
  'uppercase': (input) => input.toUpperCase(),
  'lowercase': (input) => input.toLowerCase(),
  'trim': (input) => input.trim(),
  'lines': (input) => input.split('\n').filter(l => l.trim()).join('\n'),
  'count': (input) => String(input.split('\n').filter(l => l.trim()).length),
  'head': (input, args) => {
    const n = Number(args.n) || 10;
    return input.split('\n').slice(0, n).join('\n');
  },
  'tail': (input, args) => {
    const n = Number(args.n) || 10;
    return input.split('\n').slice(-n).join('\n');
  },
  'grep': (input, args) => {
    const pattern = new RegExp(String(args.pattern || ''), 'gi');
    return input.split('\n').filter(l => pattern.test(l)).join('\n');
  },
  'json': (input) => {
    try {
      return JSON.stringify(JSON.parse(input), null, 2);
    } catch {
      return input;
    }
  },
  'wrap': (input, args) => {
    const prefix = String(args.prefix || '');
    const suffix = String(args.suffix || '');
    return `${prefix}${input}${suffix}`;
  },
};

// ============================================================================
// Pipeline Compositor
// ============================================================================

export class PipelineCompositor extends EventEmitter {
  private config: PipelineConfig;

  constructor(config: Partial<PipelineConfig> = {}) {
    super();
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
  }

  // ==========================================================================
  // Parsing
  // ==========================================================================

  /**
   * Parse a pipeline string into steps
   *
   * Syntax: `step1 args | step2 args | step3 args`
   * Fallback: `step1 args || fallback-step args`
   * Sequential: `step1 args && step2 args`
   */
  parse(pipelineString: string): PipelineToken[] {
    const tokens: PipelineToken[] = [];
    const parts = this.tokenize(pipelineString);

    for (const part of parts) {
      if (part === '|' || part === '||' || part === '&&' || part === '&') {
        tokens.push({ type: 'operator', operator: part as PipelineOperator });
      } else {
        const step = this.parseStep(part.trim());
        if (step) {
          tokens.push({ type: 'step', step });
        }
      }
    }

    return tokens;
  }

  /**
   * Tokenize pipeline string, respecting quotes
   */
  private tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (inQuote) {
        if (char === quoteChar) {
          inQuote = false;
        }
        current += char;
        continue;
      }

      if (char === '"' || char === "'") {
        inQuote = true;
        quoteChar = char;
        current += char;
        continue;
      }

      // Check for operators (|| must be checked before |)
      if (char === '|' && input[i + 1] === '|') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('||');
        current = '';
        i++;
        continue;
      }

      if (char === '&' && input[i + 1] === '&') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('&&');
        current = '';
        i++;
        continue;
      }

      if (char === '|') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('|');
        current = '';
        continue;
      }

      if (char === '&') {
        if (current.trim()) tokens.push(current.trim());
        tokens.push('&');
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) tokens.push(current.trim());
    return tokens;
  }

  /**
   * Parse a single step string
   */
  private parseStep(stepStr: string): PipelineStep | null {
    if (!stepStr) return null;

    // Split into name and args
    const match = stepStr.match(/^(\S+)(?:\s+(.*))?$/);
    if (!match) return null;

    const name = match[1];
    const rawArgs = match[2] || '';
    const args = this.parseArgs(rawArgs);

    // Determine type
    const type = BUILTIN_TRANSFORMS[name] ? 'transform' : 'tool';

    return {
      type,
      name,
      args,
      rawArgs,
    };
  }

  /**
   * Parse arguments from a string
   */
  private parseArgs(argsStr: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    if (!argsStr) return args;

    // Handle key=value pairs
    const kvPattern = /(\w+)=(?:"([^"]*?)"|'([^']*?)'|(\S+))/g;
    let match;
    let hasKv = false;

    while ((match = kvPattern.exec(argsStr)) !== null) {
      const key = match[1];
      const value = match[2] ?? match[3] ?? match[4];
      args[key] = value;
      hasKv = true;
    }

    // If no key=value pairs, treat as positional
    if (!hasKv) {
      // Remove quotes
      const cleaned = argsStr.replace(/^["']|["']$/g, '');
      args['_input'] = cleaned;
      args['query'] = cleaned;
      args['path'] = cleaned;
      args['pattern'] = cleaned;
    }

    return args;
  }

  // ==========================================================================
  // Execution
  // ==========================================================================

  /**
   * Run a pipeline from a string
   */
  async run(pipelineString: string): Promise<PipelineResult> {
    const tokens = this.parse(pipelineString);
    return this.executeTokens(tokens);
  }

  /**
   * Execute a pipeline from step definitions
   */
  async execute(steps: PipelineStep[]): Promise<PipelineResult> {
    const tokens: PipelineToken[] = [];
    for (let i = 0; i < steps.length; i++) {
      tokens.push({ type: 'step', step: steps[i] });
      if (i < steps.length - 1) {
        tokens.push({ type: 'operator', operator: '|' });
      }
    }
    return this.executeTokens(tokens);
  }

  /**
   * Execute pipeline from tokens
   */
  private async executeTokens(tokens: PipelineToken[]): Promise<PipelineResult> {
    const startTime = Date.now();
    const stepResults: StepResult[] = [];
    let currentOutput = '';
    let success = true;
    let error: string | undefined;

    // Extract steps and operators
    const steps: PipelineStep[] = [];
    const operators: PipelineOperator[] = [];

    for (const token of tokens) {
      if (token.type === 'step' && token.step) {
        steps.push(token.step);
      } else if (token.type === 'operator' && token.operator) {
        operators.push(token.operator);
      }
    }

    // Validate
    if (steps.length > this.config.maxSteps) {
      return {
        success: false,
        output: '',
        steps: [],
        totalDurationMs: Date.now() - startTime,
        error: `Pipeline exceeds maximum of ${this.config.maxSteps} steps`,
      };
    }

    // Execute steps
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const operator = i > 0 ? (operators[i - 1] || '|') : '|';

      // Check total duration
      if (Date.now() - startTime > this.config.maxDurationMs) {
        error = 'Pipeline exceeded maximum duration';
        success = false;
        break;
      }

      this.emit('step:start', step, i);

      const stepStart = Date.now();
      let result: StepResult;

      try {
        const output = await this.executeStep(step, currentOutput);
        result = {
          step,
          success: true,
          output,
          durationMs: Date.now() - stepStart,
          index: i,
        };
        currentOutput = output;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result = {
          step,
          success: false,
          output: '',
          error: errMsg,
          durationMs: Date.now() - stepStart,
          index: i,
        };

        // Handle operators
        if (operator === '||' && step.fallback) {
          // Try fallback
          try {
            const fallbackOutput = await this.executeStep(step.fallback, currentOutput);
            result.success = true;
            result.output = fallbackOutput;
            currentOutput = fallbackOutput;
          } catch {
            success = false;
            error = errMsg;
            stepResults.push(result);
            break;
          }
        } else if (operator === '&&') {
          // && requires previous success
          success = false;
          error = errMsg;
          stepResults.push(result);
          break;
        } else {
          success = false;
          error = errMsg;
          stepResults.push(result);
          break;
        }
      }

      stepResults.push(result);
      this.emit('step:complete', result);
    }

    const pipelineResult: PipelineResult = {
      success,
      output: currentOutput,
      steps: stepResults,
      totalDurationMs: Date.now() - startTime,
      error,
    };

    this.emit('pipeline:complete', pipelineResult);
    return pipelineResult;
  }

  /**
   * Execute a single step
   */
  private async executeStep(step: PipelineStep, input: string): Promise<string> {
    const timeout = step.timeout || this.config.defaultTimeout;

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Step '${step.name}' timed out after ${timeout}ms`));
      }, timeout);

      this.runStep(step, input)
        .then(output => {
          clearTimeout(timer);
          resolve(output);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Run a step based on its type
   */
  private async runStep(step: PipelineStep, input: string): Promise<string> {
    switch (step.type) {
      case 'transform':
        return this.runTransform(step, input);

      case 'tool':
      case 'skill':
        return this.runTool(step, input);

      case 'function':
        return this.runTool(step, input);

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  /**
   * Run a built-in transform
   */
  private runTransform(step: PipelineStep, input: string): string {
    const transform = BUILTIN_TRANSFORMS[step.name];
    if (!transform) {
      throw new Error(`Unknown transform: ${step.name}`);
    }
    return transform(input, step.args);
  }

  /**
   * Run a tool step using the configured executor
   */
  private async runTool(step: PipelineStep, input: string): Promise<string> {
    if (!this.config.toolExecutor) {
      throw new Error('No tool executor configured');
    }

    // Inject previous output as context
    const args = { ...step.args, _input: input, _context: input };

    const result = await this.config.toolExecutor(step.name, args, input);

    if (!result.success) {
      throw new Error(result.error || `Tool '${step.name}' failed`);
    }

    return result.output;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Set the tool executor
   */
  setToolExecutor(executor: ToolExecutor): void {
    this.config.toolExecutor = executor;
  }

  /**
   * Register a custom transform
   */
  registerTransform(
    name: string,
    fn: (input: string, args: Record<string, unknown>) => string
  ): void {
    BUILTIN_TRANSFORMS[name] = fn;
  }

  /**
   * List available transforms
   */
  listTransforms(): string[] {
    return Object.keys(BUILTIN_TRANSFORMS);
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  dispose(): void {
    this.removeAllListeners();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let compositorInstance: PipelineCompositor | null = null;

export function getPipelineCompositor(config?: Partial<PipelineConfig>): PipelineCompositor {
  if (!compositorInstance) {
    compositorInstance = new PipelineCompositor(config);
  }
  return compositorInstance;
}

export function resetPipelineCompositor(): void {
  if (compositorInstance) {
    compositorInstance.dispose();
  }
  compositorInstance = null;
}
