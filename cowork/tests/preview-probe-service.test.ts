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
