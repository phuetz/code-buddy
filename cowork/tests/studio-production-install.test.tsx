// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { useAppStudio } from '../src/renderer/components/studio/use-app-studio';
import type { AppStudioApis } from '../src/renderer/components/studio/studio-api';

afterEach(cleanup);

it('installs preview build dependencies even when Electron runs in production', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-production-install-'));
  const tool = join(root, 'build-tool');
  await mkdir(tool);
  await writeFile(join(tool, 'package.json'), JSON.stringify({ name: 'qa-build-tool', version: '1.0.0' }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'qa-app', private: true, devDependencies: { 'qa-build-tool': 'file:./build-tool' } }));
  const start = vi.fn(async () => ({ ok: true as const, data: { pid: 1, url: 'http://127.0.0.1:5173/', command: 'npm run dev' } }));
  const apis: Partial<AppStudioApis> = {
    files: {
      list: async () => ({ ok: true, data: [{ name: 'package.json', path: 'package.json', type: 'file' }] }),
      read: async (cwd: string, file: string) => {
        try { return { ok: true as const, data: { content: await readFile(join(cwd, file), 'utf8') } }; }
        catch { return { ok: false as const, error: 'missing' }; }
      },
    } as AppStudioApis['files'],
    commands: {
      runToEnd: async ({ command, id, cwd }) => {
        await promisify(execFile)('npm', [...command.split(' ').slice(1), '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
          cwd, env: { ...process.env, NODE_ENV: 'production' }, timeout: 15_000,
        });
        return { ok: true, data: { id, code: 0 } };
      },
    } as AppStudioApis['commands'],
    devServer: { start } as AppStudioApis['devServer'],
  };
  try {
    const { result } = renderHook(() => useAppStudio({ projectRoot: root, apis }));
    await waitFor(() => expect(result.current.state.tree).toHaveLength(1));
    await act(async () => { await result.current.actions.startDev(); });
    expect(start).toHaveBeenCalledOnce();
    expect(existsSync(join(root, 'node_modules/qa-build-tool/package.json'))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20_000);
