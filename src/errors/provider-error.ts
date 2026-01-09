import { CodeBuddyError } from './base-error.js';

/**
 * API request failed
 */
export class ApiError extends CodeBuddyError {
  public readonly statusCode?: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    options: {
      cause?: Error;
      statusCode?: number;
      endpoint?: string;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super('API_ERROR', message, options);
    this.name = 'ApiError';
    this.statusCode = options.statusCode;
    this.endpoint = options.endpoint;
  }
}

/**
 * API rate limit exceeded
 */
export class RateLimitError extends ApiError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super('Rate limit exceeded', { statusCode: 429 });
    this.name = 'RateLimitError';
    Object.defineProperty(this, 'code', { value: 'RATE_LIMIT_EXCEEDED', writable: false });
    this.retryAfter = retryAfter;
  }
}

/**
 * API authentication failed
 */
export class AuthenticationError extends ApiError {
  constructor(message: string = 'Authentication failed') {
    super(message, { statusCode: 401 });
    this.name = 'AuthenticationError';
    Object.defineProperty(this, 'code', { value: 'AUTHENTICATION_FAILED', writable: false });
  }
}
