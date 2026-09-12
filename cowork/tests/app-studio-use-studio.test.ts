/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAppStudio } from '../src/renderer/components/studio/use-app-studio';
import type { AppStudioApis } from '../src/renderer/components/studio/studio-api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useAppStudio (B2 & B3)', () => {
  it('B3: updates viewProps.workingDir to scaffolded project root after scaffold generate', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      ok: true,
      data: { projectDir: '/path/to/new-app', files: ['package.json', 'src/App.tsx'] },
    });
    const mockList = vi.fn().mockResolvedValue({ ok: true, data: [] });

    const apis: Partial<AppStudioApis> = {
      scaffold: {
        list: async () => [],
        generate: mockGenerate,
      },
      files: {
        list: mockList,
        read: vi.fn().mockResolvedValue({ ok: false, error: 'not found' }),
        write: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
        create: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
        rename: vi.fn().mockResolvedValue({ ok: true, data: { from: 'a', to: 'b' } }),
        delete: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
      },
    };

    const { result } = renderHook(() =>
      useAppStudio({
        apis,
        projectRoot: '', // initial empty
      })
    );

    expect(result.current.viewProps.workingDir).toBe('');

    await act(async () => {
      await result.current.actions.scaffold({
        template: 'react-tailwind',
        targetDir: '/path/to/target',
      });
    });

    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(result.current.state.projectRoot).toBe('/path/to/new-app');
    expect(result.current.viewProps.workingDir).toBe('/path/to/new-app');
  });

  it('B3: reports error in terminal if runCommand or openFile is called without project directory', async () => {
    const apis: Partial<AppStudioApis> = {
      commands: {
        run: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', pid: 100 } }),
        runToEnd: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', code: 0 } }),
        kill: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', killed: true } }),
      },
      files: {
        list: vi.fn().mockResolvedValue({ ok: true, data: [] }),
        read: vi.fn().mockResolvedValue({ ok: true, data: { path: 'f', content: '' } }),
        write: vi.fn().mockResolvedValue({ ok: true, data: { path: 'f' } }),
        create: vi.fn().mockResolvedValue({ ok: true, data: { path: 'f' } }),
        rename: vi.fn().mockResolvedValue({ ok: true, data: { from: 'a', to: 'b' } }),
        delete: vi.fn().mockResolvedValue({ ok: true, data: { path: 'f' } }),
      },
    };

    const { result } = renderHook(() =>
      useAppStudio({
        apis,
        projectRoot: '',
      })
    );

    await act(async () => {
      await result.current.actions.runCommand('ls');
    });

    expect(result.current.state.buildError).toContain('No project directory');
    expect(result.current.viewProps.terminalOutput).toContain('No project directory to run command.');

    await act(async () => {
      await result.current.actions.openFile('index.html');
    });

    expect(result.current.viewProps.terminalOutput).toContain('No project directory to open file.');
  });

  it('B2: ensureInstalled runs npm install with --include=dev and NODE_ENV=development', async () => {
    const runToEndMock = vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', code: 0 } });
    const pkgContent = JSON.stringify({
      name: 'test-app',
      dependencies: { react: '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.7.0', vite: '^6.0.0' },
    });

    const readMock = vi.fn().mockImplementation(async (_root: string, filePath: string) => {
      if (filePath === 'package.json') return { ok: true, data: { path: filePath, content: pkgContent } };
      if (filePath === 'node_modules/.package-lock.json') return { ok: false, error: 'no lock' };
      if (filePath === 'node_modules/react/package.json') return { ok: true, data: { path: filePath, content: '{}' } };
      if (filePath === 'node_modules/@vitejs/plugin-react/package.json') return { ok: true, data: { path: filePath, content: '{}' } };
      if (filePath === 'node_modules/vite/package.json') return { ok: true, data: { path: filePath, content: '{}' } };
      return { ok: false, error: 'not found' };
    });

    const apis: Partial<AppStudioApis> = {
      commands: {
        run: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', pid: 100 } }),
        runToEnd: runToEndMock,
        kill: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', killed: true } }),
      },
      files: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: [{ name: 'package.json', path: 'package.json', isDirectory: false }],
        }),
        read: readMock,
        write: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
        create: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
        rename: vi.fn().mockResolvedValue({ ok: true, data: { from: 'a', to: 'b' } }),
        delete: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
      },
      devServer: {
        start: vi.fn().mockResolvedValue({ ok: true, data: { pid: 999, origin: 'http://localhost:5173', url: 'http://localhost:5173/' } }),
        stop: vi.fn().mockResolvedValue({ ok: true, data: { pid: 999, output: '' } }),
        status: vi.fn().mockResolvedValue({ ok: true, data: { instances: [], raw: '' } }),
        logs: vi.fn().mockResolvedValue({ ok: true, data: { pid: 999, output: '', lines: [] } }),
      },
    };

    const { result } = renderHook(() =>
      useAppStudio({
        apis,
        projectRoot: '/test/react-app',
      })
    );

    await act(async () => {
      const devRes = await result.current.actions.startDev();
      expect(devRes.ok).toBe(true);
    });

    expect(runToEndMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test/react-app',
        command: 'npm install --include=dev',
        env: { NODE_ENV: 'development' },
      })
    );
  });

  it('B2: does not skip install if lock marker exists but devDependencies are missing in node_modules', async () => {
    const runToEndMock = vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', code: 0 } });
    const pkgContent = JSON.stringify({
      name: 'test-app',
      dependencies: { react: '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.7.0' },
    });

    let installRan = false;
    const readMock = vi.fn().mockImplementation(async (_root: string, filePath: string) => {
      if (filePath === 'package.json') return { ok: true, data: { path: filePath, content: pkgContent } };
      // Lock exists
      if (filePath === 'node_modules/.package-lock.json') return { ok: true, data: { path: filePath, content: '{}' } };
      if (filePath === 'node_modules/react/package.json') return { ok: true, data: { path: filePath, content: '{}' } };
      // @vitejs/plugin-react is missing before install, present after install
      if (filePath === 'node_modules/@vitejs/plugin-react/package.json') {
        return installRan ? { ok: true, data: { path: filePath, content: '{}' } } : { ok: false, error: 'missing' };
      }
      return { ok: false, error: 'not found' };
    });

    runToEndMock.mockImplementation(async () => {
      installRan = true;
      return { ok: true, data: { id: 'c1', code: 0 } };
    });

    const apis: Partial<AppStudioApis> = {
      commands: {
        run: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', pid: 100 } }),
        runToEnd: runToEndMock,
        kill: vi.fn().mockResolvedValue({ ok: true, data: { id: 'c1', killed: true } }),
      },
      files: {
        list: vi.fn().mockResolvedValue({
          ok: true,
          data: [{ name: 'package.json', path: 'package.json', isDirectory: false }],
        }),
        read: readMock,
        write: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
        create: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
        rename: vi.fn().mockResolvedValue({ ok: true, data: { from: 'a', to: 'b' } }),
        delete: vi.fn().mockResolvedValue({ ok: true, data: { path: 'a' } }),
      },
      devServer: {
        start: vi.fn().mockResolvedValue({ ok: true, data: { pid: 999, origin: 'http://localhost:5173', url: 'http://localhost:5173/' } }),
        stop: vi.fn().mockResolvedValue({ ok: true, data: { pid: 999, output: '' } }),
        status: vi.fn().mockResolvedValue({ ok: true, data: { instances: [], raw: '' } }),
        logs: vi.fn().mockResolvedValue({ ok: true, data: { pid: 999, output: '', lines: [] } }),
      },
    };

    const { result } = renderHook(() =>
      useAppStudio({
        apis,
        projectRoot: '/test/react-app',
      })
    );

    await act(async () => {
      const devRes = await result.current.actions.startDev();
      expect(devRes.ok).toBe(true);
    });

    // Because devDependencies were missing, install was NOT skipped despite the lock marker
    expect(runToEndMock).toHaveBeenCalledTimes(1);
  });
});
