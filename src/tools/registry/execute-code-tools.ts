import { getToolWorkingDirectory } from '../../utils/tool-execution-context.js';
import type { ToolResult } from '../../types/index.js';
import { EXECUTE_CODE_TOOL } from '../../codebuddy/tool-definitions/advanced-tools.js';
import {
  executeCode,
  type ExecuteCodeInput,
  type ExecuteCodeLanguage,
  type ExecuteCodeRunnerOptions,
} from '../execute-code-runner.js';
import { createExecuteCodeRpcInvoker } from '../execute-code-rpc-invoker.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolSchema,
} from './types.js';

export class ExecuteCodeTool implements ITool {
  readonly name = EXECUTE_CODE_TOOL.function.name;
  readonly description = EXECUTE_CODE_TOOL.function.description;

  constructor(private readonly options: ExecuteCodeRunnerOptions = {}) {}

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const rootDir = this.options.rootDir ?? context?.cwd ?? getToolWorkingDirectory();
      const result = await executeCode(parseInput(input), {
        ...this.options,
        rootDir,
        // Always wire the invoker; the runner keeps the channel OFF unless
        // the master flag (CODEBUDDY_EXECUTE_CODE_TOOL_RPC) is enabled.
        rpcInvoke: this.options.rpcInvoke ?? createExecuteCodeRpcInvoker({ workspaceRoot: rootDir }),
      });
      return {
        success: result.ok,
        output: JSON.stringify(result, null, 2),
        data: result,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: EXECUTE_CODE_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof data.code !== 'string' || !data.code.trim()) {
      errors.push('code is required');
    }
    if (data.language !== undefined && !isLanguage(data.language)) {
      errors.push('language must be one of javascript, typescript, python, shell');
    }
    if (data.args !== undefined && !Array.isArray(data.args)) {
      errors.push('args must be an array of strings');
    }
    if (data.env !== undefined && (typeof data.env !== 'object' || data.env === null || Array.isArray(data.env))) {
      errors.push('env must be an object');
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'system',
      keywords: ['execute_code', 'hermes', 'code', 'script', 'runtime', 'subprocess', 'artifact'],
      priority: 8,
      requiresConfirmation: true,
      modifiesFiles: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createExecuteCodeTools(options: ExecuteCodeRunnerOptions = {}): ITool[] {
  return [new ExecuteCodeTool(options)];
}

function parseInput(input: Record<string, unknown>): ExecuteCodeInput {
  const language = input.language === undefined ? undefined : parseLanguage(input.language);
  return {
    code: requiredString(input, 'code'),
    ...(language ? { language } : {}),
    ...(input.args !== undefined ? { args: parseStringArray(input.args, 'args') } : {}),
    ...(input.env !== undefined ? { env: parseEnv(input.env) } : {}),
    ...(typeof input.timeout_ms === 'number' ? { timeoutMs: input.timeout_ms } : {}),
  };
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function parseLanguage(value: unknown): ExecuteCodeLanguage {
  if (!isLanguage(value)) {
    throw new Error('language must be one of javascript, typescript, python, shell');
  }
  return value;
}

function isLanguage(value: unknown): value is ExecuteCodeLanguage {
  return value === 'javascript' || value === 'typescript' || value === 'python' || value === 'shell';
}

function parseStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`${key}[${index}] must be a string`);
    }
    return entry;
  });
}

function parseEnv(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('env must be an object of string values');
  }
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      throw new Error(`env.${key} must be a string`);
    }
    env[key] = entry;
  }
  return env;
}
