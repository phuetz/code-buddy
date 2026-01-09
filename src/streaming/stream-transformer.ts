/**
 * Stream Transformer
 *
 * Provides composable stream transformation utilities
 * for mapping, filtering, and aggregating stream data.
 */

export type TransformFunction<T, R> = (chunk: T) => R | Promise<R>;
export type FilterFunction<T> = (chunk: T) => boolean | Promise<boolean>;
export type AggregateFunction<T, R> = (accumulator: R, chunk: T) => R | Promise<R>;

export interface TransformPipeline<T, R> {
  source: AsyncIterable<T>;
  transform: TransformFunction<T, R>;
}

export class StreamTransformer<T = unknown> {
  /**
   * Map each chunk through a transform function
   */
  static async *map<T, R>(
    source: AsyncIterable<T>,
    transform: TransformFunction<T, R>
  ): AsyncGenerator<R, void, unknown> {
    for await (const chunk of source) {
      yield await transform(chunk);
    }
  }

  /**
   * Filter chunks based on a predicate
   */
  static async *filter<T>(
    source: AsyncIterable<T>,
    predicate: FilterFunction<T>
  ): AsyncGenerator<T, void, unknown> {
    for await (const chunk of source) {
      if (await predicate(chunk)) {
        yield chunk;
      }
    }
  }

  /**
   * Take first n chunks
   */
  static async *take<T>(
    source: AsyncIterable<T>,
    count: number
  ): AsyncGenerator<T, void, unknown> {
    let taken = 0;
    for await (const chunk of source) {
      if (taken >= count) return;
      yield chunk;
      taken++;
    }
  }

  /**
   * Skip first n chunks
   */
  static async *skip<T>(
    source: AsyncIterable<T>,
    count: number
  ): AsyncGenerator<T, void, unknown> {
    let skipped = 0;
    for await (const chunk of source) {
      if (skipped < count) {
        skipped++;
        continue;
      }
      yield chunk;
    }
  }

  /**
   * Take chunks while predicate is true
   */
  static async *takeWhile<T>(
    source: AsyncIterable<T>,
    predicate: FilterFunction<T>
  ): AsyncGenerator<T, void, unknown> {
    for await (const chunk of source) {
      if (!(await predicate(chunk))) return;
      yield chunk;
    }
  }

  /**
   * Skip chunks while predicate is true
   */
  static async *skipWhile<T>(
    source: AsyncIterable<T>,
    predicate: FilterFunction<T>
  ): AsyncGenerator<T, void, unknown> {
    let skipping = true;
    for await (const chunk of source) {
      if (skipping) {
        if (await predicate(chunk)) continue;
        skipping = false;
      }
      yield chunk;
    }
  }

  /**
   * Flatten nested async iterables
   */
  static async *flatten<T>(
    source: AsyncIterable<AsyncIterable<T> | T[]>
  ): AsyncGenerator<T, void, unknown> {
    for await (const item of source) {
      if (Symbol.asyncIterator in Object(item) || Symbol.iterator in Object(item)) {
        const iterable = item as AsyncIterable<T> | Iterable<T>;
        for await (const chunk of iterable) {
          yield chunk;
        }
      } else {
        yield item as T;
      }
    }
  }

  /**
   * Batch chunks into arrays of specified size
   */
  static async *batch<T>(
    source: AsyncIterable<T>,
    size: number
  ): AsyncGenerator<T[], void, unknown> {
    let batch: T[] = [];
    for await (const chunk of source) {
      batch.push(chunk);
      if (batch.length >= size) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Debounce stream - only emit after specified quiet period
   */
  static async *debounce<T>(
    source: AsyncIterable<T>,
    delayMs: number
  ): AsyncGenerator<T, void, unknown> {
    let lastChunk: T | undefined;
    let lastTime = 0;
    let pending: Promise<void> | null = null;

    for await (const chunk of source) {
      lastChunk = chunk;
      lastTime = Date.now();

      if (pending) continue;

      pending = new Promise<void>((resolve) => {
        setTimeout(() => {
          if (Date.now() - lastTime >= delayMs && lastChunk !== undefined) {
            resolve();
          }
        }, delayMs);
      });

      await pending;
      pending = null;

      if (lastChunk !== undefined) {
        yield lastChunk;
      }
    }
  }

  /**
   * Throttle stream - emit at most once per interval
   */
  static async *throttle<T>(
    source: AsyncIterable<T>,
    intervalMs: number
  ): AsyncGenerator<T, void, unknown> {
    let lastEmit = 0;
    for await (const chunk of source) {
      const now = Date.now();
      if (now - lastEmit >= intervalMs) {
        lastEmit = now;
        yield chunk;
      }
    }
  }

  /**
   * Add delay between chunks
   */
  static async *delay<T>(
    source: AsyncIterable<T>,
    delayMs: number
  ): AsyncGenerator<T, void, unknown> {
    let first = true;
    for await (const chunk of source) {
      if (!first) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      first = false;
      yield chunk;
    }
  }

  /**
   * Buffer chunks until a flush condition is met
   */
  static async *buffer<T>(
    source: AsyncIterable<T>,
    shouldFlush: (buffer: T[], newChunk: T) => boolean
  ): AsyncGenerator<T[], void, unknown> {
    let buffer: T[] = [];
    for await (const chunk of source) {
      if (shouldFlush(buffer, chunk) && buffer.length > 0) {
        yield buffer;
        buffer = [];
      }
      buffer.push(chunk);
    }
    if (buffer.length > 0) {
      yield buffer;
    }
  }

  /**
   * Merge multiple streams into one
   */
  static async *merge<T>(
    ...sources: AsyncIterable<T>[]
  ): AsyncGenerator<T, void, unknown> {
    const iterators = sources.map((s) => s[Symbol.asyncIterator]());
    const results: Promise<{ value: T; done: boolean; index: number }>[] = [];

    // Initialize with first read from each iterator
    iterators.forEach((iter, index) => {
      results[index] = iter.next().then((result) => ({
        value: result.value,
        done: result.done ?? false,
        index,
      }));
    });

    while (results.length > 0) {
      const winner = await Promise.race(results.filter(Boolean));

      if (!winner.done) {
        yield winner.value;
        // Queue next read for this iterator
        results[winner.index] = iterators[winner.index].next().then((result) => ({
          value: result.value,
          done: result.done ?? false,
          index: winner.index,
        }));
      } else {
        // Remove completed iterator
        results.splice(winner.index, 1);
        iterators.splice(winner.index, 1);
        // Re-index remaining iterators
        for (let i = 0; i < results.length; i++) {
          const pending = results[i];
          if (pending) {
            results[i] = pending.then((r) => ({ ...r, index: i }));
          }
        }
      }
    }
  }

  /**
   * Concatenate multiple streams sequentially
   */
  static async *concat<T>(
    ...sources: AsyncIterable<T>[]
  ): AsyncGenerator<T, void, unknown> {
    for (const source of sources) {
      for await (const chunk of source) {
        yield chunk;
      }
    }
  }

  /**
   * Zip multiple streams together
   */
  static async *zip<T>(
    ...sources: AsyncIterable<T>[]
  ): AsyncGenerator<T[], void, unknown> {
    const iterators = sources.map((s) => s[Symbol.asyncIterator]());

    while (true) {
      const results = await Promise.all(iterators.map((iter) => iter.next()));
      if (results.some((r) => r.done)) break;
      yield results.map((r) => r.value);
    }
  }

  /**
   * Create a tee - duplicate stream for multiple consumers
   */
  static tee<T>(source: AsyncIterable<T>, count: number = 2): AsyncIterable<T>[] {
    const buffers: T[][] = Array.from({ length: count }, () => []);
    const doneFlags: boolean[] = Array(count).fill(false);
    let sourceExhausted = false;
    let sourceIterator: AsyncIterator<T> | null = null;
    let sourceError: Error | null = null;

    const readFromSource = async (): Promise<void> => {
      if (!sourceIterator) {
        sourceIterator = source[Symbol.asyncIterator]();
      }

      try {
        const result = await sourceIterator.next();
        if (result.done) {
          sourceExhausted = true;
        } else {
          for (const buffer of buffers) {
            buffer.push(result.value);
          }
        }
      } catch (error) {
        sourceError = error instanceof Error ? error : new Error(String(error));
        sourceExhausted = true;
      }
    };

    const createIterator = (index: number): AsyncIterable<T> => ({
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          async next(): Promise<IteratorResult<T>> {
            if (doneFlags[index]) {
              return { done: true, value: undefined };
            }

            if (sourceError) {
              throw sourceError;
            }

            if (buffers[index].length === 0) {
              if (sourceExhausted) {
                doneFlags[index] = true;
                return { done: true, value: undefined };
              }
              await readFromSource();
              if (sourceError) throw sourceError;
              if (buffers[index].length === 0 && sourceExhausted) {
                doneFlags[index] = true;
                return { done: true, value: undefined };
              }
            }

            return { done: false, value: buffers[index].shift()! };
          },
        };
      },
    });

    return Array.from({ length: count }, (_, i) => createIterator(i));
  }

  /**
   * Create a pipeline of transformations
   */
  static pipe<T, R>(
    source: AsyncIterable<T>,
    ...transforms: Array<(input: AsyncIterable<unknown>) => AsyncIterable<unknown>>
  ): AsyncIterable<R> {
    let result: AsyncIterable<unknown> = source;
    for (const transform of transforms) {
      result = transform(result);
    }
    return result as AsyncIterable<R>;
  }

  /**
   * Reduce stream to a single value
   */
  static async reduce<T, R>(
    source: AsyncIterable<T>,
    reducer: AggregateFunction<T, R>,
    initial: R
  ): Promise<R> {
    let accumulator = initial;
    for await (const chunk of source) {
      accumulator = await reducer(accumulator, chunk);
    }
    return accumulator;
  }

  /**
   * Collect all chunks into an array
   */
  static async collect<T>(source: AsyncIterable<T>): Promise<T[]> {
    const chunks: T[] = [];
    for await (const chunk of source) {
      chunks.push(chunk);
    }
    return chunks;
  }

  /**
   * Get first chunk
   */
  static async first<T>(source: AsyncIterable<T>): Promise<T | undefined> {
    for await (const chunk of source) {
      return chunk;
    }
    return undefined;
  }

  /**
   * Get last chunk
   */
  static async last<T>(source: AsyncIterable<T>): Promise<T | undefined> {
    let lastChunk: T | undefined;
    for await (const chunk of source) {
      lastChunk = chunk;
    }
    return lastChunk;
  }

  /**
   * Count chunks
   */
  static async count<T>(source: AsyncIterable<T>): Promise<number> {
    let count = 0;
    for await (const _ of source) {
      count++;
    }
    return count;
  }

  /**
   * Check if any chunk matches predicate
   */
  static async some<T>(
    source: AsyncIterable<T>,
    predicate: FilterFunction<T>
  ): Promise<boolean> {
    for await (const chunk of source) {
      if (await predicate(chunk)) return true;
    }
    return false;
  }

  /**
   * Check if all chunks match predicate
   */
  static async every<T>(
    source: AsyncIterable<T>,
    predicate: FilterFunction<T>
  ): Promise<boolean> {
    for await (const chunk of source) {
      if (!(await predicate(chunk))) return false;
    }
    return true;
  }

  /**
   * Find first chunk matching predicate
   */
  static async find<T>(
    source: AsyncIterable<T>,
    predicate: FilterFunction<T>
  ): Promise<T | undefined> {
    for await (const chunk of source) {
      if (await predicate(chunk)) return chunk;
    }
    return undefined;
  }
}
