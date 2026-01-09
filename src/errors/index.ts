export * from './base-error.js';
export * from './agent-error.js';
export * from './tool-error.js';
export * from './provider-error.js';

import { CodeBuddyError } from './base-error.js';
import { ApiError, RateLimitError, AuthenticationError } from './provider-error.js';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Check if error is a CodeBuddyError
 */
export function isCodeBuddyError(error: unknown): error is CodeBuddyError {
  return error instanceof CodeBuddyError;
}

/**
 * Check if error is operational (expected, can be handled gracefully)
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof CodeBuddyError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Wrap unknown error in CodeBuddyError
 */
export function wrapError(error: unknown, code: string = 'UNKNOWN_ERROR'): CodeBuddyError {
  if (error instanceof CodeBuddyError) {
    return error;
  }

  const message = getErrorMessage(error);
  const cause = error instanceof Error ? error : undefined;

  return new CodeBuddyError(code, message, { cause, isOperational: false });
}

/**
 * Create error from API response
 */
export function createApiError(
  statusCode: number,
  message: string,
  endpoint?: string
): ApiError {
  if (statusCode === 401) {
    return new AuthenticationError(message);
  }
  if (statusCode === 429) {
    return new RateLimitError();
  }
  return new ApiError(message, { statusCode, endpoint });
}
