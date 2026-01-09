/**
 * Base Error Class
 *
 * Foundation for all application-specific errors.
 */

export class CodeBuddyError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: {
      cause?: Error;
      isOperational?: boolean;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = 'CodeBuddyError';
    this.code = code;
    this.isOperational = options.isOperational ?? true;
    this.timestamp = new Date();
    this.context = options.context;

    if (options.cause) {
      this.cause = options.cause;
    }

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}
