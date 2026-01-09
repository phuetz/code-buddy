import { CodeBuddyError } from './base-error.js';

/**
 * Error during tool execution
 */
export class ToolExecutionError extends CodeBuddyError {
  public readonly toolName: string;
  public readonly args?: Record<string, unknown>;

  constructor(
    toolName: string,
    message: string,
    options: {
      cause?: Error;
      args?: Record<string, unknown>;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super('TOOL_EXECUTION_ERROR', message, options);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
    this.args = options.args;
  }
}

/**
 * Tool validation failed
 */
export class ToolValidationError extends CodeBuddyError {
  public readonly toolName: string;
  public readonly validationErrors: string[];

  constructor(
    toolName: string,
    validationErrors: string[],
    options: { context?: Record<string, unknown> } = {}
  ) {
    super(
      'TOOL_VALIDATION_ERROR',
      `Validation failed for tool "${toolName}": ${validationErrors.join(', ')}`,
      options
    );
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.validationErrors = validationErrors;
  }
}

/**
 * Tool not found
 */
export class ToolNotFoundError extends CodeBuddyError {
  public readonly toolName: string;

  constructor(toolName: string) {
    super('TOOL_NOT_FOUND', `Tool "${toolName}" not found`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}
