// Base error
export { CodeBuddyError } from './base-error.js';

// Agent errors
export {
  ContextLimitExceededError,
  SandboxViolationError,
  ConfirmationDeniedError,
} from './agent-error.js';

// Tool errors
export {
  ToolExecutionError,
  ToolValidationError,
  ToolNotFoundError,
} from './tool-error.js';

// Provider errors
export {
  ApiError,
  RateLimitError,
  AuthenticationError,
} from './provider-error.js';

// Circuit breaker errors
export { CircuitOpenError } from '../providers/circuit-breaker.js';

// Crash recovery
export {
  checkCrashRecovery,
  clearRecoveryFiles,
  saveRecoveryCheckpoint,
  recordRecoveryAttempt,
} from './crash-recovery.js';
export type { RecoveryInfo as CrashRecoveryInfo } from './crash-recovery.js';

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
  if (error === null || error === undefined) {
    return 'An unknown error occurred';
  }
  // Objects with a message property (e.g. { message: "..." })
  if (typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  const str = String(error);
  return str === '[object Object]' ? 'An unknown error occurred' : str;
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

/**
 * Map a raw LLM provider error into an actionable, user-friendly message.
 *
 * Upstream providers (OpenAI, Anthropic, Gemini, xAI, OpenRouter, …) throw
 * errors with messages like `"401 Unauthorized"` or `"Request failed with
 * status 429"`. Without mapping, these surface to the user as generic
 * `"CodeBuddy API error: 401 Unauthorized"` with no hint on how to fix
 * them. This helper classifies the error and appends guidance that tells
 * the user what to actually do next (update key, wait, compact context,
 * switch model).
 *
 * We intentionally preserve the `"CodeBuddy API error: "` prefix and the
 * original raw message at the start of the returned string so downstream
 * error handlers and tests that grep for substrings of the raw error
 * keep working; the actionable guidance is appended via " — Hint: …".
 *
 * Pass `provider` when known (e.g. `"grok"`, `"anthropic"`) so the config
 * command is specific.
 */
export function mapProviderError(rawMessage: string, provider?: string): string {
  const msg = rawMessage || 'Unknown provider error';
  const lower = msg.toLowerCase();
  const configKey = provider ? `${provider}_api_key` : 'api_key';
  const prefix = `CodeBuddy API error: ${msg}`;

  // Authentication / authorization
  if (/\b401\b/.test(lower) || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('authentication')) {
    return `${prefix} — Hint: API key invalid or revoked. Run: buddy config set ${configKey} <your-key>`;
  }
  if (/\b403\b/.test(lower) || lower.includes('forbidden') || lower.includes('permission denied')) {
    return `${prefix} — Hint: API access forbidden; your key may lack permissions for this model. Run: buddy config set ${configKey} <key-with-access>`;
  }

  // Rate limiting
  if (/\b429\b/.test(lower) || lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('quota')) {
    return `${prefix} — Hint: rate limit hit. Wait 30–60s, upgrade your plan, or run /switch to another model.`;
  }

  // Context length
  if (
    lower.includes('context length') ||
    lower.includes('context window') ||
    lower.includes('maximum context') ||
    lower.includes('context_length_exceeded') ||
    lower.includes('token limit') ||
    lower.includes('too many tokens')
  ) {
    return `${prefix} — Hint: context too large for this model. Run /compact to shrink the conversation, or /switch to a larger model.`;
  }

  // Timeouts and network
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return `${prefix} — Hint: request timed out. Retry in a few seconds or run /switch to a different provider.`;
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch failed')) {
    return `${prefix} — Hint: network error reaching the provider. Check your connection, proxy, or base URL (buddy config get ${provider ?? 'base_url'}).`;
  }

  // Server errors
  if (/\b500\b/.test(lower) || /\b502\b/.test(lower) || /\b503\b/.test(lower) || /\b504\b/.test(lower) || lower.includes('server error')) {
    return `${prefix} — Hint: service is currently unavailable. Try again in a few minutes or run /switch.`;
  }

  // Model not found / unsupported
  if (lower.includes('model not found') || lower.includes('model does not exist') || lower.includes('unsupported model') || lower.includes('invalid model')) {
    return `${prefix} — Hint: model not available for your account. Run /switch or buddy config set model <supported-model>.`;
  }

  // Fallback: just the prefix (raw message) — no actionable hint available.
  return prefix;
}
