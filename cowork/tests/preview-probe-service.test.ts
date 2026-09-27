import { describe, expect, it, vi } from 'vitest';
import {
  PreviewProbeService,
  consoleErrorFrom,
  isLoopbackHttpUrl,
  type ProbeWindowLike,
} from '../src/main/studio/preview-probe-service';

type Listener = (...args: any[]) => void;

function fakeWindow(opts: {
  emit?: (on: (event: string, ...args: unknown[]) => void) => void;
  dom?: unknown;
  loadError?: Error;
}) {
  const listeners = new Map<string, Listener[]>();
  const fire = (event: string, ...args: unknown[]) => (listeners.get(event) ?? []).forEach((l) => l(...args));
  const destroy = vi.fn();
  const win: ProbeWindowLike = {
    loadURL: vi.fn(async () => {
      opts.emit?.(fire);
      if (opts.loadError) throw opts.loadError;
    }),
    webContents: {
      on: (event: string, listener: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      executeJavaScript: vi.fn(async () => opts.dom ?? { overlay: false, placeholder: false, rootChildren: 2, textLength: 100 }),
    },
    destroy,
  };
  return { win, destroy };
}

const noWait = () => Promise.resolve();

describe('PreviewProbeService', () => {
  it('refuses non-loopback URLs without opening a window', async () => {
    const createWindow = vi.fn();
    const svc = new PreviewProbeService({ createWindow, wait: noWait });
    const res = await svc.probe({ cwd: '/p', url: 'https://example.com/' });
    expect(res.ok).toBe(false);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('collects build result, console errors (both Electron signatures) and DOM summary', async () => {
    const { win, destroy } = fakeWindow({
      emit: (fire) => {
        fire('console-message', {}, 3, 'Uncaught ReferenceError: Foo is not defined');
        fire('console-message', {}, 1, 'just info');
        fire('console-message', { level: 'error', message: 'new-style error' });
      },
      dom: { overlay: true, placeholder: false, rootChildren: 0, textLength: 0 },
    });
    const runBuild = vi.fn(async () => ({ code: 1, output: ['error during build'] }));
    const svc = new PreviewProbeService({ createWindow: () => win, runBuild, wait: noWait });
    const res = await svc.probe({ cwd: '/p', url: 'http://127.0.0.1:5173/' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(runBuild).toHaveBeenCalledWith('/p');
    expect(res.data.buildExitCode).toBe(1);
    expect(res.data.consoleErrors).toEqual(['Uncaught ReferenceError: Foo is not defined', 'new-style error']);
    expect(res.data.overlay).toBe(true);
    expect(res.data.rootChildren).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('records a failed main-frame load as navError and still destroys the window', async () => {
    const { win, destroy } = fakeWindow({
      emit: (fire) => fire('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:1/', true),
      loadError: new Error('ERR_CONNECTION_REFUSED (-102)'),
    });
    const svc = new PreviewProbeService({ createWindow: () => win, runBuild: async () => null, wait: noWait });
    const res = await svc.probe({ cwd: '/p', url: 'http://localhost:1/' });
    expect(res.ok && res.data.navError).toContain('ERR_CONNECTION_REFUSED');
    expect(res.ok && res.data.buildExitCode).toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('a failed load returns at once: no settle wait, no DOM read', async () => {
    const { win, destroy } = fakeWindow({ loadError: new Error('ERR_CONNECTION_REFUSED (-102)') });
    // The load-timeout race never fires here; any other wait (the settle) is recorded.
    const wait = vi.fn((ms: number) => (ms === 20_000 ? new Promise<void>(() => {}) : Promise.resolve()));
    const svc = new PreviewProbeService({ createWindow: () => win, runBuild: async () => null, wait });
    const res = await svc.probe({ cwd: '/p', url: 'http://127.0.0.1:1/', settleMs: 3000 });
    expect(res.ok && res.data.navError).toContain('ERR_CONNECTION_REFUSED');
    expect(wait.mock.calls.map(([ms]) => ms)).not.toContain(3000);
    expect(win.webContents.executeJavaScript).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('a successful load still waits settleMs before reading the DOM', async () => {
    const { win } = fakeWindow({});
    const wait = vi.fn((ms: number) => (ms === 20_000 ? new Promise<void>(() => {}) : Promise.resolve()));
    const svc = new PreviewProbeService({ createWindow: () => win, runBuild: async () => null, wait });
    await svc.probe({ cwd: '/p', url: 'http://127.0.0.1:5173/', settleMs: 3000 });
    expect(wait.mock.calls.map(([ms]) => ms)).toContain(3000);
    expect(win.webContents.executeJavaScript).toHaveBeenCalled();
  });

  it('hands the project env (resolveProjectEnv) to the build runner', async () => {
    const { win } = fakeWindow({});
    const runBuild = vi.fn(async () => ({ code: 0, output: [] }));
    const resolveProjectEnv = vi.fn(async () => ({ VITE_API_URL: 'http://127.0.0.1:8787' }));
    const svc = new PreviewProbeService({ createWindow: () => win, runBuild, wait: noWait, resolveProjectEnv });
    await svc.probe({ cwd: '/p', url: 'http://127.0.0.1:5173/' });
    expect(resolveProjectEnv).toHaveBeenCalledWith('/p');
    expect(runBuild).toHaveBeenCalledWith('/p', { VITE_API_URL: 'http://127.0.0.1:8787' });
  });

  it('skips the build when asked', async () => {
    const { win } = fakeWindow({});
    const runBuild = vi.fn();
    const svc = new PreviewProbeService({ createWindow: () => win, runBuild, wait: noWait });
    await svc.probe({ cwd: '/p', url: 'http://[::1]:5173/', build: false });
    expect(runBuild).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('isLoopbackHttpUrl', () => {
    expect(isLoopbackHttpUrl('http://127.0.0.1:5173/')).toBe(true);
    expect(isLoopbackHttpUrl('http://localhost:3000')).toBe(true);
    expect(isLoopbackHttpUrl('http://203.0.113.5:5173/')).toBe(false);
    expect(isLoopbackHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isLoopbackHttpUrl('not a url')).toBe(false);
  });

  it('consoleErrorFrom ignores non-error levels', () => {
    expect(consoleErrorFrom([{}, 2, 'warn'])).toBeNull();
    expect(consoleErrorFrom([{ level: 'warning', message: 'x' }])).toBeNull();
  });
});
