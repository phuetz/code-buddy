/**
 * ensureInstalled must run `npm install` again when an auto-fix ADDS a
 * dependency to package.json. The former rule (npm's
 * node_modules/.package-lock.json marker, or "installed once this session")
 * skipped it, so the fix loop retried the same unresolved import.
 */
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppStudio } from './use-app-studio.js';
import type { AppStudioApis } from './studio-api.js';

function setup(disk: Map<string, string>) {
  const runToEnd = vi.fn(async (_req: { cwd: string; command: string; id: string }) => ({ ok: true as const, data: { id: 'x', code: 0 } }));
  const apis: Partial<AppStudioApis> = {
    files: {
      list: async () => ({ ok: true, data: [{ name: 'package.json', path: 'package.json', type: 'file' }] as never }),
      read: async (_root: string, p: string) =>
        disk.has(p) ? { ok: true, data: { path: p, content: disk.get(p)! } } : { ok: false, error: 'ENOENT' },
      write: async () => ({ ok: true, data: { path: '' } }),
      create: async () => ({ ok: true, data: { path: '' } }),
      rename: async () => ({ ok: true, data: { from: '', to: '' } }),
      delete: async () => ({ ok: true, data: { path: '' } }),
    } as unknown as AppStudioApis['files'],
    commands: {
      run: async () => ({ ok: true, data: { id: 'x', pid: 1 } }),
      runToEnd,
      kill: async () => ({ ok: true, data: undefined }),
    } as unknown as AppStudioApis['commands'],
    devServer: {
      start: async () => ({ ok: true, data: { pid: 42, origin: 'http://127.0.0.1:5173', url: 'http://127.0.0.1:5173/' } }),
      stop: async () => ({ ok: true, data: { pid: 42, output: '' } }),
      status: async () => ({ ok: true, data: { instances: [], raw: '' } }),
      logs: async () => ({ ok: true, data: { pid: 42, output: '', lines: [] } }),
    } as unknown as AppStudioApis['devServer'],
  };
  return { apis, runToEnd };
}

describe('useAppStudio ensureInstalled', () => {
  it('reinstalls after package.json gains a dependency, even with the npm marker present', async () => {
    const disk = new Map<string, string>([
      ['package.json', JSON.stringify({ dependencies: { react: '^18' }, scripts: { dev: 'vite' } })],
      ['node_modules/.package-lock.json', '{}'],
      ['node_modules/react/package.json', '{}'],
    ]);
    const { apis, runToEnd } = setup(disk);
    const { result } = renderHook(() => useAppStudio({ apis, projectRoot: '/proj' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // All declared deps present: no install.
    await act(async () => {
      await result.current.actions.startDev({ cwd: '/proj', command: 'npm run dev', url: 'http://127.0.0.1:5173/' });
    });
    await act(async () => {
      await result.current.actions.startDev({ cwd: '/proj' });
    });
    expect(runToEnd).not.toHaveBeenCalled();

    // The fix adds recharts: the next start must install it.
    disk.set('package.json', JSON.stringify({ dependencies: { react: '^18', recharts: '^2' }, scripts: { dev: 'vite' } }));
    let out: { ok: boolean; url?: string } | undefined;
    await act(async () => {
      out = await result.current.actions.startDev({ cwd: '/proj' });
    });
    expect(runToEnd).toHaveBeenCalledTimes(1);
    expect(runToEnd.mock.calls[0]![0]).toMatchObject({ cwd: '/proj', command: 'npm install --include=dev' });
    expect(out).toEqual({ ok: true, url: 'http://127.0.0.1:5173/' });
  });
});
