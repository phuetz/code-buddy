/**
 * Generic retry utility with exponential backoff
 *
 * Re-exports shared retry logic from @phuetz/ai-providers,
 * plus Code Buddy-specific strategies, predicates, and utilities
 * (withRetry, Retry decorator, cloudStorageError predicate).
 */

// Re-export core retry function and strategies from the shared package
export {
  retry,
  retryWithResult,
  RetryStrategies,
  RetryPredicates,
} from '@phuetz/ai-providers';

// Re-export types
export type {
  RetryOptions,
  RetryResult,
} from '@phuetz/ai-providers';

// ============================================================================
// Code Buddy-specific additions (not in shared package)
// ============================================================================

import type { RetryOptions } from '@phuetz/ai-providers';
import { retry } from '@phuetz/ai-providers';

/**
 * Create a retryable version of a function
 */
export function withRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => retry(() => fn(...args), options);
}

/**
 * Retry decorator for class methods
 */
export function Retry(options: RetryOptions = {}) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    _target: unknown,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) return descriptor;

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      return retry(() => originalMethod.apply(this, args), options);
    } as T;

    return descriptor;
  };
}
