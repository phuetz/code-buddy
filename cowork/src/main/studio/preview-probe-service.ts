/**
 * Preview probe for App Studio (main process).
 *
 * Gathers the raw signals the renderer's pure `collectPreviewHealth` needs to
 * tell "the dev server answers" apart from "the app actually renders":
 *  1. a `vite build` pass into a throwaway directory (catches unresolved
 *     imports, syntax errors, missing packages — failures Vite's dev server
 *     only reports lazily in the browser);
 *  2. a load of the LOOPBACK preview URL in a hidden, sandboxed BrowserWindow
 *     (non-persistent partition), collecting console errors (uncaught
 *     exceptions surface there as "Uncaught …"), load failures, a crashed
 *     renderer, and a small DOM summary (mount node children, visible text,
 *     Vite error overlay, starter placeholder).
 *
 * bolt.diy gets the same signals from WebContainer's preview error forwarding;
 * here Electron already ships a browser, so no new dependency is needed.
 * Window creation and the build runner are injected, so the logic is testable
 * without Electron.
 *
 * @module main/studio/preview-probe-service
 */

import { spawn } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export interface PreviewProbeInput {
  cwd: string;
  url: string;
  /** Run the `vite build` pass (default true when the project has a local vite binary). */
  build?: boolean;
  /** Time to let the app mount and throw after `load` (default 3000 ms). */
  settleMs?: number;
  /** Navigation timeout (default 20000 ms). */
  loadTimeoutMs?: number;
}

export interface PreviewProbeSignals {
  buildExitCode?: number | null;
  buildOutput: string[];
  consoleErrors: string[];
  pageErrors: string[];
  overlay: boolean;
  placeholder: boolean;
  rootChildren: number;
  textLength: number;
  navError?: string;
}

export type PreviewProbeResult = { ok: true; data: PreviewProbeSignals } | { ok: false; error: string };

/** Minimal surface of a BrowserWindow used by the probe (injectable for tests). */
export interface ProbeWindowLike {
  loadURL(url: string): Promise<void>;
  webContents: {
    // Electron's listener signatures differ per event; the probe narrows each one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): unknown;
    executeJavaScript(code: string): Promise<unknown>;
  };
  destroy(): void;
  isDestroyed?(): boolean;
}

export interface BuildRunResult {
  code: number | null;
  output: string[];
}

export interface PreviewProbeDeps {
  createWindow: () => ProbeWindowLike;
  runBuild?: (cwd: string) => Promise<BuildRunResult | null>;
  wait?: (ms: number) => Promise<void>;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The probe only ever loads the local dev server App Studio started. */
export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export const DOM_SUMMARY_SCRIPT = `(() => {
  const root = document.getElementById('root') || document.getElementById('app') || document.body;
  // textContent, not innerText: innerText needs layout and reads 0 in a
  // hidden window (observed on Electron 35 under Xvfb).
  const text = (root && root.textContent || '').trim();
  return {
    overlay: Boolean(document.querySelector('vite-error-overlay')),
    placeholder: Boolean(document.querySelector('[data-studio-starter]')),
    rootChildren: root ? root.children.length : 0,
    textLength: text.length,
  };
})()`;

/**
 * Electron's `console-message` listener changed shape across versions:
 * (event, level:number, message) up to 35, then a single details object with
 * `level: 'error'|…`. Accept both.
 */
export function consoleErrorFrom(args: unknown[]): string | null {
  const [first, level, message] = args as [Record<string, unknown> | undefined, unknown, unknown];
  const lvl = typeof level === 'number' ? level : first?.level;
  const msg = typeof message === 'string' ? message : first?.message;
  if (typeof msg !== 'string') return null;
  if (lvl === 3 || lvl === 'error') return msg.slice(0, 2000);
  return null;
}

function localViteBinary(cwd: string): string | null {
  const bin = path.join(cwd, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  return existsSync(bin) ? bin : null;
}

/** Default build runner: the project's own vite, output to a temp dir that is removed afterwards. */
export async function runViteBuild(cwd: string, timeoutMs = 120_000): Promise<BuildRunResult | null> {
  const vite = localViteBinary(cwd);
  if (!vite) return null;
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-probe-'));
  try {
    return await new Promise<BuildRunResult>((resolve) => {
      const output: string[] = [];
      const child = spawn(vite, ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
        cwd,
        shell: process.platform === 'win32',
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });
      const push = (chunk: Buffer) => {
        output.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
        if (output.length > 400) output.splice(0, output.length - 400);
      };
      child.stdout?.on('data', push);
      child.stderr?.on('data', push);
      const timer = setTimeout(() => {
        output.push(`vite build timed out after ${timeoutMs} ms`);
        child.kill();
      }, timeoutMs);
      child.once('error', (error) => {
        clearTimeout(timer);
        resolve({ code: 1, output: [...output, String(error)] });
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        resolve({ code, output });
      });
    });
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export class PreviewProbeService {
  constructor(private readonly deps: PreviewProbeDeps) {}

  async probe(input: PreviewProbeInput): Promise<PreviewProbeResult> {
    const cwd = input.cwd?.trim();
    const url = input.url?.trim();
    if (!cwd) return { ok: false, error: 'cwd is required' };
    if (!url || !isLoopbackHttpUrl(url)) return { ok: false, error: 'preview probe only loads loopback http(s) URLs' };

    const wait = this.deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const signals: PreviewProbeSignals = {
      buildOutput: [],
      consoleErrors: [],
      pageErrors: [],
      overlay: false,
      placeholder: false,
      rootChildren: 0,
      textLength: 0,
    };

    if (input.build !== false) {
      const build = await (this.deps.runBuild ?? runViteBuild)(cwd).catch((error: unknown) => ({
        code: 1,
        output: [String(error)],
      }));
      if (build) {
        signals.buildExitCode = build.code;
        signals.buildOutput = build.output.slice(-200);
      }
    }

    let win: ProbeWindowLike | null = null;
    try {
      win = this.deps.createWindow();
      win.webContents.on('console-message', (...args: unknown[]) => {
        const msg = consoleErrorFrom(args);
        if (msg && signals.consoleErrors.length < 50) signals.consoleErrors.push(msg);
      });
      win.webContents.on('render-process-gone', (_event: unknown, details: { reason?: string } | undefined) => {
        signals.pageErrors.push(`renderer process gone: ${details?.reason ?? 'unknown'}`);
      });
      win.webContents.on(
        'did-fail-load',
        (_event: unknown, code: number, description: string, _url: string, isMainFrame?: boolean) => {
          if (isMainFrame !== false) signals.navError = `load failed (${code}): ${description}`;
        },
      );
      const timeoutMs = input.loadTimeoutMs ?? 20_000;
      await Promise.race([
        win.loadURL(url),
        wait(timeoutMs).then(() => {
          throw new Error(`preview load timed out after ${timeoutMs} ms`);
        }),
      ]).catch((error: unknown) => {
        signals.navError = signals.navError ?? (error instanceof Error ? error.message : String(error));
      });
      await wait(input.settleMs ?? 3000);
      const dom = (await win.webContents.executeJavaScript(DOM_SUMMARY_SCRIPT).catch(() => null)) as
        | Partial<Pick<PreviewProbeSignals, 'overlay' | 'placeholder' | 'rootChildren' | 'textLength'>>
        | null;
      if (dom) {
        signals.overlay = Boolean(dom.overlay);
        signals.placeholder = Boolean(dom.placeholder);
        signals.rootChildren = Number(dom.rootChildren) || 0;
        signals.textLength = Number(dom.textLength) || 0;
      }
      return { ok: true, data: signals };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (win && !(win.isDestroyed?.() ?? false)) win.destroy();
    }
  }
}
