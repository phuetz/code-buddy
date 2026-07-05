import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoreModule } from '../src/main/utils/core-loader.js';
import { StudioDevServer } from '../src/main/studio/dev-server-service.js';

vi.mock('../src/main/utils/core-loader.js', () => ({
  loadCoreModule: vi.fn(),
}));

const mockedLoadCoreModule = vi.mocked(loadCoreModule);

function makeTool() {
  return {
    start: vi.fn().mockResolvedValue({
      success: true,
      output: 'ready',
      data: { pid: 1234, origin: 'http://127.0.0.1:5173', url: 'http://127.0.0.1:5173/' },
    }),
    stop: vi.fn().mockResolvedValue({ success: true, output: 'stopped' }),
    status: vi.fn().mockResolvedValue({
      success: true,
      output: 'pid 1234 [running, 1s] http://127.0.0.1:5173 - npm run dev',
    }),
    logs: vi.fn().mockResolvedValue({ success: true, output: 'hello\nworld\n' }),
  };
}

beforeEach(() => {
  mockedLoadCoreModule.mockReset();
});

describe('StudioDevServer', () => {
  it('delegates start to the core app_server tool and tracks the instance', async () => {
    const tool = makeTool();
    mockedLoadCoreModule.mockResolvedValue({ getAppServerTool: () => tool });
    const service = new StudioDevServer();

    const result = await service.start({
      cwd: '/tmp/project',
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173/',
    });

    expect(result).toEqual({
      ok: true,
      data: { pid: 1234, origin: 'http://127.0.0.1:5173', url: 'http://127.0.0.1:5173/' },
    });
    expect(tool.start).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173/',
    });
  });

  it('delegates stop, status, and logs without throwing', async () => {
    const tool = makeTool();
    mockedLoadCoreModule.mockResolvedValue({ getAppServerTool: () => tool });
    const service = new StudioDevServer();

    await service.start({ cwd: '/tmp/project', command: 'npm run dev', url: 'http://127.0.0.1:5173/' });
    await expect(service.stop(1234)).resolves.toEqual({ ok: true, data: { pid: 1234, output: 'stopped' } });
    await expect(service.status()).resolves.toMatchObject({
      ok: true,
      data: {
        raw: 'pid 1234 [running, 1s] http://127.0.0.1:5173 - npm run dev',
      },
    });
    await expect(service.logs(1234)).resolves.toEqual({
      ok: true,
      data: { pid: 1234, output: 'hello\nworld\n', lines: ['hello', 'world'] },
    });

    expect(tool.stop).toHaveBeenCalledWith(1234);
    expect(tool.status).toHaveBeenCalledTimes(1);
    expect(tool.logs).toHaveBeenCalledWith(1234, undefined);
  });

  it('returns ok:false instead of throwing when the core module fails', async () => {
    mockedLoadCoreModule.mockRejectedValue(new Error('boom'));
    const service = new StudioDevServer();

    await expect(service.start({
      cwd: '/tmp/project',
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173/',
    })).resolves.toEqual({ ok: false, error: 'Core app_server tool is unavailable' });
  });
});
