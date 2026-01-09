import { CodeBuddyError } from './base-error.js';

/**
 * Context token limit exceeded
 */
export class ContextLimitExceededError extends CodeBuddyError {
  public readonly currentTokens: number;
  public readonly maxTokens: number;
  public readonly overflow: number;

  constructor(currentTokens: number, maxTokens: number) {
    super(
      'CONTEXT_LIMIT_EXCEEDED',
      `Context limit exceeded: ${currentTokens} tokens (max: ${maxTokens})`
    );
    this.name = 'ContextLimitExceededError';
    this.currentTokens = currentTokens;
    this.maxTokens = maxTokens;
    this.overflow = currentTokens - maxTokens;
  }
}

/**
 * Operation blocked by security sandbox
 */
export class SandboxViolationError extends CodeBuddyError {
  public readonly operation: string;
  public readonly reason: string;

  constructor(operation: string, reason: string) {
    super('SANDBOX_VIOLATION', `Sandbox blocked operation: ${operation}. Reason: ${reason}`);
    this.name = 'SandboxViolationError';
    this.operation = operation;
    this.reason = reason;
  }
}

/**
 * User denied confirmation for an operation
 */
export class ConfirmationDeniedError extends CodeBuddyError {
  public readonly operation: string;
  public readonly target?: string;

  constructor(operation: string, target?: string) {
    super(
      'CONFIRMATION_DENIED',
      `User denied confirmation for operation: ${operation}${target ? ` on ${target}` : ''}`
    );
    this.name = 'ConfirmationDeniedError';
    this.operation = operation;
    this.target = target;
  }
}
