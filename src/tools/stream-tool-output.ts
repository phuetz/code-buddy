import type { ToolResult } from '../types/index.js';
import { BoundedOutput } from '../utils/bounded-output.js';

/** Adapt a callback-based guarded tool invocation without bypassing its dispatch pipeline. */
export async function* streamToolOutput(
  run: (signal: AbortSignal, emit: (delta: string) => void) => Promise<ToolResult>,
  signal?: AbortSignal,
): AsyncGenerator<string, ToolResult, undefined> {
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const pending = new BoundedOutput(64 * 1024);
  let result: ToolResult | undefined;
  let wake: (() => void) | undefined;
  const notify = (): void => { wake?.(); wake = undefined; };
  const completion = Promise.resolve().then(() => run(controller.signal, delta => { pending.append(delta); notify(); }))
    .then(value => { result = value; })
    .catch(error => { result = { success: false, error: error instanceof Error ? error.message : String(error) }; })
    .finally(notify);
  try {
    while (!result || pending.retainedBytes) {
      if (pending.retainedBytes) yield pending.drain();
      else await new Promise<void>(resolve => { wake = resolve; });
    }
    return result;
  } finally {
    abort();
    signal?.removeEventListener('abort', abort);
    // Observe completion without blocking a consumer that intentionally stops.
    void completion;
  }
}
