import { AsyncLocalStorage } from 'node:async_hooks';

const toolAbortStorage = new AsyncLocalStorage<AbortSignal>();

/**
 * Propagate a turn abort signal through the normal tool-dispatch stack without
 * changing every registry and handler signature. AsyncLocalStorage keeps
 * concurrent turns isolated from one another.
 */
export function runWithToolAbortSignal<T>(
  signal: AbortSignal | undefined,
  operation: () => T,
): T {
  return signal ? toolAbortStorage.run(signal, operation) : operation();
}

/** Return the abort signal associated with the current tool execution. */
export function getToolAbortSignal(): AbortSignal | undefined {
  return toolAbortStorage.getStore();
}
