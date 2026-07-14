/**
 * Shared timeout race for council LLM calls.
 *
 * The optional controller lets callers that pass its signal to a transport
 * abort real network/model work on timeout. Legacy callers still get the
 * timer race without changing behaviour.
 *
 * @module council/with-timeout
 */

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  controller?: AbortController,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort(`${label} timeout`);
          reject(new Error(`${label} timeout >${Math.round(ms / 1000)}s`));
        }, ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
