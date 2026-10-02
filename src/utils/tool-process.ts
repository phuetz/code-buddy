/** Node subprocess API with the calling tool's cwd and cancellation signal. */
import * as childProcess from 'node:child_process';
import { promisify } from 'node:util';
import { combineAbortSignals } from '../codebuddy/abort-signal.js';
import { getToolExecutionContext, ownToolProcess, resolveToolPath, throwIfToolCancelled } from './tool-execution-context.js';
import type { ChildProcess } from 'node:child_process';

export type { ChildProcess, SpawnOptions } from 'node:child_process';

function options(value: unknown, asynchronous: boolean): Record<string, unknown> {
  const scoped = getToolExecutionContext();
  const configured = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const signal = scoped?.signal && configured.signal instanceof AbortSignal
    ? combineAbortSignals(scoped.signal, configured.signal) : scoped?.signal;
  return {
    ...(scoped ? { cwd: scoped.cwd } : {}), ...configured,
    ...(typeof configured.cwd === 'string' ? { cwd: resolveToolPath(configured.cwd) } : {}),
    ...(asynchronous && signal ? { signal, detached: process.platform !== 'win32' } : {}),
  };
}
function argumentsWithOptions(args: unknown[], name: string, asynchronous: boolean): unknown[] {
  if (!getToolExecutionContext()) return args;
  const copy = [...args];
  // spawn/execFile accept an optional argv array; exec accepts only options.
  const index = name.startsWith('execFile') || name.startsWith('spawn')
    ? Array.isArray(copy[1]) ? 2 : 1 : 1;
  if (typeof copy[index] === 'function') copy.splice(index, 0, options(undefined, asynchronous));
  else copy[index] = options(copy[index], asynchronous);
  return copy;
}
function wrap(name: 'spawn' | 'exec' | 'execFile' | 'execSync' | 'execFileSync' | 'spawnSync'): (...args: unknown[]) => unknown {
  const asynchronous = !name.endsWith('Sync');
  const invoke = (...args: unknown[]): unknown => {
    throwIfToolCancelled();
    const original = childProcess[name];
    const adjusted = argumentsWithOptions(args, name, asynchronous);
    const configured = adjusted.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg)) as { signal?: AbortSignal } | undefined;
    return ownToolProcess(() => Reflect.apply(original, undefined, adjusted), (result) => result as ChildProcess,
      name === 'spawn' && process.platform !== 'win32', asynchronous ? configured?.signal : undefined);
  };
  if (name === 'exec' || name === 'execFile') {
    Object.defineProperty(invoke, promisify.custom, { value: (...args: unknown[]) => {
      throwIfToolCancelled();
      const adjusted = argumentsWithOptions(args, name, true);
      const configured = adjusted.find((arg) => arg && typeof arg === 'object' && !Array.isArray(arg)) as { signal?: AbortSignal } | undefined;
      return ownToolProcess(() => Reflect.apply(promisify(childProcess[name]), undefined, adjusted), (result) => result.child,
        false, configured?.signal);
    } });
  }
  return invoke;
}

export const spawn = wrap('spawn') as typeof childProcess.spawn;
export const exec = wrap('exec') as typeof childProcess.exec;
export const execFile = wrap('execFile') as typeof childProcess.execFile;
export const execSync = wrap('execSync') as typeof childProcess.execSync;
export const execFileSync = wrap('execFileSync') as typeof childProcess.execFileSync;
export const spawnSync = wrap('spawnSync') as typeof childProcess.spawnSync;
