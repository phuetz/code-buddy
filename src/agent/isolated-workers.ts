/**
 * Bounded isolated workers for Ralph / swarm work.
 * Not 218 concurrent Hermes agents — a local cap with separate session keys
 * and optional git worktrees so two workers do not share a dirty tree.
 */

import { logger } from '../utils/logger.js';

export interface IsolatedWorkerJob<T> {
  id: string;
  run: () => Promise<T>;
}

export interface IsolatedWorkerResult<T> {
  id: string;
  ok: boolean;
  value?: T;
  error?: string;
  sessionKey: string;
  ms: number;
}

export interface IsolatedWorkerPoolOptions {
  concurrency?: number;
  sessionPrefix?: string;
  env?: NodeJS.ProcessEnv;
}

function cap(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.CODEBUDDY_ISOLATED_WORKERS ?? env.CODEBUDDY_GOAL_WORKERS ?? 4);
  if (!Number.isFinite(raw) || raw < 1) return 4;
  return Math.min(32, Math.floor(raw));
}

export function isolatedSessionKey(prefix: string, id: string): string {
  return `${prefix.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40)}:${id}`;
}

export async function runIsolatedWorkers<T>(
  jobs: IsolatedWorkerJob<T>[],
  options: IsolatedWorkerPoolOptions = {},
): Promise<IsolatedWorkerResult<T>[]> {
  const env = options.env ?? process.env;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? cap(env), jobs.length || 1));
  const prefix = options.sessionPrefix ?? 'worker';
  const results: IsolatedWorkerResult<T>[] = new Array(jobs.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      const job = jobs[index];
      if (!job) return;
      const started = Date.now();
      const sessionKey = isolatedSessionKey(prefix, job.id);
      try {
        const value = await job.run();
        results[index] = {
          id: job.id,
          ok: true,
          value,
          sessionKey,
          ms: Date.now() - started,
        };
      } catch (error) {
        logger.warn('[isolated-workers] job failed', { id: job.id, error: String(error) });
        results[index] = {
          id: job.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          sessionKey,
          ms: Date.now() - started,
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}
