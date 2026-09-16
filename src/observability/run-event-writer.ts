import type { WriteStream } from 'node:fs';

export interface RunPersistenceStatus {
  state: 'pending' | 'flushed' | 'failed';
  received: number;
  written: number;
  error?: string;
}

/** Tracks stream acknowledgements separately from in-memory observability. */
export class RunEventWriter {
  private received = 0;
  private written = 0;
  private failure?: Error;

  constructor(private readonly stream: WriteStream, private readonly onFailure: (error: Error) => void) {
    stream.on('error', error => this.fail(error));
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.onFailure(error);
  }

  write(line: string): void {
    this.received++;
    if (this.failure) return;
    if (this.stream.writableLength + Buffer.byteLength(line) > 1024 * 1024) {
      this.fail(new Error('Run event queue exceeded 1 MiB; journal is incomplete'));
      return;
    }
    try {
      this.stream.write(line, error => {
        if (error) this.fail(error);
        else this.written++;
      });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  status(): RunPersistenceStatus {
    return {
      state: this.failure ? 'failed' : this.received === this.written ? 'flushed' : 'pending',
      received: this.received,
      written: this.written,
      ...(this.failure ? { error: this.failure.message } : {}),
    };
  }

  /** A stream flush, not an fsync guarantee. Rejects on any prior lost event. */
  async flush(): Promise<RunPersistenceStatus> {
    if (this.failure) throw this.failure;
    if (!this.stream.writableFinished) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          this.stream.removeListener('error', failed);
          this.stream.removeListener('finish', finished);
          this.stream.removeListener('close', closed);
        };
        const failed = (error: Error): void => { cleanup(); reject(error); };
        const finished = (): void => { cleanup(); resolve(); };
        const closed = (): void => {
          if (this.stream.writableFinished) finished();
          else failed(new Error('Run event stream closed before flush'));
        };
        this.stream.once('error', failed);
        this.stream.once('close', closed);
        if (this.stream.destroyed) closed();
        else if (this.stream.writableEnded) this.stream.once('finish', finished);
        else this.stream.write('', error => error ? failed(error) : finished());
      }).catch(error => { this.fail(error); throw error; });
    }
    if (this.failure) throw this.failure;
    return this.status();
  }
}
