import { describe, expect, it, vi } from 'vitest';
import { positionNearCursor, QuickAskWindow } from '../src/main/quickask-window';

describe('QuickAskWindow lifecycle', () => {
  it('keeps the popup inside the display work area', () => {
    const pos = positionNearCursor({ x: 10, y: 10 }, { x: 0, y: 0, width: 1920, height: 1080 });
    expect(pos.x).toBeGreaterThanOrEqual(8);
    expect(pos.y).toBeGreaterThanOrEqual(8);
  });

  it('creates a frameless always-on-top window and hides it on toggle', async () => {
    const created: Array<Record<string, unknown>> = [];
    class FakeWindow {
      opts: Record<string, unknown>;
      destroyed = false;
      shown = false;
      constructor(opts: Record<string, unknown>) {
        this.opts = opts;
        created.push(opts);
      }
      setAlwaysOnTop() {}
      on() {}
      setPosition() {}
      show() {
        this.shown = true;
      }
      hide() {
        this.shown = false;
      }
      focus() {}
      isDestroyed() {
        return this.destroyed;
      }
      close() {
        this.destroyed = true;
      }
    }
    const loadUrl = vi.fn(async () => undefined);
    const qa = new QuickAskWindow({
      BrowserWindow: FakeWindow as never,
      screen: {
        getCursorScreenPoint: () => ({ x: 400, y: 200 }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      },
      preloadPath: '/tmp/preload.js',
      loadUrl,
      logWarn: vi.fn(),
    });
    expect(qa.isOpen()).toBe(false);
    await qa.show();
    expect(qa.isOpen()).toBe(true);
    expect(created[0]).toMatchObject({ frame: false, alwaysOnTop: true, skipTaskbar: true });
    expect(loadUrl).toHaveBeenCalledTimes(1);
    await qa.toggle();
    expect((qa.getWindow() as unknown as FakeWindow).shown).toBe(false);
    qa.destroy();
    expect(qa.isOpen()).toBe(false);
  });

  it('triggers onShow callback whenever the window is shown', async () => {
    class FakeWindow {
      setAlwaysOnTop() {}
      on() {}
      setPosition() {}
      show() {}
      focus() {}
      isDestroyed() {
        return false;
      }
    }
    const onShow = vi.fn();
    const qa = new QuickAskWindow({
      BrowserWindow: FakeWindow as never,
      screen: {
        getCursorScreenPoint: () => ({ x: 100, y: 100 }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      },
      preloadPath: '/tmp/preload.js',
      loadUrl: vi.fn(),
      logWarn: vi.fn(),
      onShow,
    });
    await qa.show();
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith(qa.getWindow());
  });
});
