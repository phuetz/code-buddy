/** FIFO barriers for mutations, bounded parallelism for explicitly safe reads. */
export class ToolCallScheduler {
  private active = 0;
  private exclusive = false;
  private queue: Array<{ parallel: boolean; run: () => Promise<void> }> = [];

  constructor(private readonly concurrency = 4) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64) throw new Error('Concurrency must be an integer between 1 and 64');
  }

  schedule<T>(parallel: boolean, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Tool call cancelled')); return; }
      const entry = { parallel, run: async (): Promise<void> => {
        signal?.removeEventListener('abort', abort);
        try { resolve(await action()); } catch (error) { reject(error); }
      } };
      const abort = (): void => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        signal?.removeEventListener('abort', abort);
        reject(new Error('Tool call cancelled'));
        this.pump();
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }

  private pump(): void {
    while (!this.exclusive && this.active < this.concurrency && this.queue.length) {
      const next = this.queue[0]!;
      if (!next.parallel && this.active) return;
      this.queue.shift();
      this.active++;
      this.exclusive = !next.parallel;
      void next.run().finally(() => {
        this.active--;
        if (!next.parallel) this.exclusive = false;
        this.pump();
      });
    }
  }
}
