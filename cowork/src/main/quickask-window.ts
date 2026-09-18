/**
 * Frameless always-on-top Quick Ask window.
 */
import type { BrowserWindow as BrowserWindowType } from 'electron';
import { join } from 'node:path';

export interface QuickAskWindowDeps {
  BrowserWindow: typeof import('electron').BrowserWindow;
  screen: {
    getCursorScreenPoint: () => { x: number; y: number };
    getDisplayNearestPoint: (point: { x: number; y: number }) => {
      workArea: { x: number; y: number; width: number; height: number };
    };
  };
  preloadPath: string;
  loadUrl: (win: BrowserWindowType) => Promise<void> | void;
  logWarn: (message: string) => void;
  onShow?: (win: BrowserWindowType) => void;
}

const WIDTH = 440;
const HEIGHT = 400;

export function positionNearCursor(
  cursor: { x: number; y: number },
  workArea: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const x = Math.min(
    Math.max(cursor.x - Math.floor(WIDTH / 2), workArea.x + 8),
    workArea.x + workArea.width - WIDTH - 8,
  );
  const y = Math.min(
    Math.max(cursor.y + 16, workArea.y + 8),
    workArea.y + workArea.height - HEIGHT - 8,
  );
  return { x, y };
}

export class QuickAskWindow {
  private win: BrowserWindowType | null = null;

  constructor(private readonly deps: QuickAskWindowDeps) {}

  getWindow(): BrowserWindowType | null {
    return this.win;
  }

  isOpen(): boolean {
    return Boolean(this.win && !this.win.isDestroyed());
  }

  async toggle(): Promise<void> {
    if (this.isOpen()) {
      this.hide();
      return;
    }
    await this.show();
  }

  async show(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) {
      this.win = new this.deps.BrowserWindow({
        width: WIDTH,
        height: HEIGHT,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        show: false,
        backgroundColor: '#1a1a1a',
        webPreferences: {
          preload: this.deps.preloadPath,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      this.win.setAlwaysOnTop(true, 'floating');
      this.win.on('closed', () => {
        this.win = null;
      });
      await this.deps.loadUrl(this.win);
    }
    const cursor = this.deps.screen.getCursorScreenPoint();
    const display = this.deps.screen.getDisplayNearestPoint(cursor);
    const pos = positionNearCursor(cursor, display.workArea);
    this.win.setPosition(pos.x, pos.y, false);
    this.win.show();
    this.win.focus();
    this.deps.onShow?.(this.win);
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide();
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.close();
    }
    this.win = null;
  }
}

export function quickAskLoadTarget(viteDevServerUrl: string | undefined, distHtml: string): string {
  if (viteDevServerUrl) {
    const base = viteDevServerUrl.replace(/\/$/, '');
    return `${base}/#quickask`;
  }
  return `${distHtml}#quickask`;
}

export function distHtmlPath(dirname: string): string {
  return join(dirname, '../../dist/index.html');
}
