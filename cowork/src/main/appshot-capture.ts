/**
 * Foreground-window capture for Appshots.
 * Capture is always staged; nothing is sent until confirm().
 */
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface NativeImageLike {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface DesktopSourceLike {
  id: string;
  name: string;
  thumbnail: NativeImageLike;
}

export interface PendingAppshot {
  filePath: string;
  dataUrl: string;
  windowName: string;
  sessionId: string;
}

export function sessionAppshotDir(userData: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unattached';
  return join(userData, 'sessions', safe, 'appshots');
}

export function pickForegroundSource(
  sources: DesktopSourceLike[],
  activeName?: string,
): DesktopSourceLike | null {
  if (sources.length === 0) return null;
  if (activeName) {
    const exact = sources.find((s) => s.name === activeName);
    if (exact) return exact;
    const partial = sources.find(
      (s) => activeName.includes(s.name) || s.name.includes(activeName),
    );
    if (partial) return partial;
  }
  const notSelf = sources.find((s) => !/cowork|code.?buddy/i.test(s.name));
  return notSelf ?? sources[0] ?? null;
}

export function pngToDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export class AppshotStaging {
  private pending: PendingAppshot | null = null;

  constructor(
    private readonly deps: {
      getSources: (opts: {
        types: Array<'window' | 'screen'>;
        thumbnailSize: { width: number; height: number };
      }) => Promise<DesktopSourceLike[]>;
      resolveActiveWindowName?: () => string | undefined;
      userData: string;
      now?: () => number;
    },
  ) {}

  getPending(): PendingAppshot | null {
    return this.pending;
  }

  async capture(sessionId: string): Promise<PendingAppshot> {
    this.cancel();
    const sources = await this.deps.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    });
    const activeName = this.deps.resolveActiveWindowName?.();
    const source = pickForegroundSource(sources, activeName);
    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('No foreground window capture available');
    }
    const png = source.thumbnail.toPNG();
    const dir = sessionAppshotDir(this.deps.userData, sessionId);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${this.deps.now?.() ?? Date.now()}.png`);
    writeFileSync(filePath, png);
    this.pending = {
      filePath,
      dataUrl: pngToDataUrl(png),
      windowName: source.name,
      sessionId,
    };
    return this.pending;
  }

  confirm(): PendingAppshot {
    if (!this.pending) {
      throw new Error('No capture to send: confirmation required');
    }
    const sent = this.pending;
    this.pending = null;
    return sent;
  }

  cancel(): void {
    if (this.pending && existsSync(this.pending.filePath)) {
      try {
        unlinkSync(this.pending.filePath);
      } catch {
        /* best-effort */
      }
    }
    this.pending = null;
  }
}
