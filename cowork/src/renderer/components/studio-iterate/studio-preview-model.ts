/**
 * Pure model for the App Studio live preview (bolt.new-style): infer the dev
 * command/URL for a generated project, resolve which running dev-server instance
 * belongs to us, and map that to a PreviewToolbar status. No React, no IPC — the
 * StudioPreviewPane wires these to the real `devServer.*` bridge.
 */
import type { PreviewStatus, PreviewDevice } from './iterate-model.js';

export interface DevCommand {
  /** npm script invocation, e.g. `npm run dev`. */
  command: string;
  /** Loopback URL the dev server is expected to serve on. */
  url: string;
}

interface PackageJsonLike {
  scripts?: Record<string, string>;
}

const DEFAULT_DEV: DevCommand = { command: 'npm run dev', url: 'http://localhost:5173' };

/**
 * Infer the dev command + URL from a project's package.json scripts. Recognises
 * the frameworks App Studio scaffolds (Vite, Next, Astro, CRA); falls back to
 * `npm run dev` on :5173 (Vite's default, our most common scaffold).
 */
export function detectDevCommand(pkg: PackageJsonLike | null | undefined): DevCommand {
  const scripts = pkg?.scripts ?? {};
  const dev = scripts.dev ?? '';
  const start = scripts.start ?? '';

  if (/\bnext\b/.test(dev)) return { command: 'npm run dev', url: 'http://localhost:3000' };
  if (/\bnext\b/.test(start)) return { command: 'npm start', url: 'http://localhost:3000' };
  if (/\bastro\b/.test(dev)) return { command: 'npm run dev', url: 'http://localhost:4321' };
  if (/\bexpo\b/.test(dev) || /\bexpo\b/.test(start) || /\bexpo\b/.test(scripts.web ?? '')) {
    if (scripts.web) return { command: 'npm run web', url: 'http://localhost:8081' };
    if (dev.trim()) return { command: 'npm run dev', url: 'http://localhost:8081' };
    return { command: 'npm start', url: 'http://localhost:8081' };
  }
  if (/\bvite\b/.test(dev)) return { command: 'npm run dev', url: 'http://localhost:5173' };
  if (/react-scripts\s+start/.test(start)) return { command: 'npm start', url: 'http://localhost:3000' };
  if (dev.trim()) return { command: 'npm run dev', url: 'http://localhost:5173' };
  if (start.trim()) return { command: 'npm start', url: 'http://localhost:3000' };
  return DEFAULT_DEV;
}

export interface DevInstanceLike {
  pid: number;
  url: string;
  cwd: string;
  state: 'running' | 'dead' | 'unknown';
}

export interface DevStatusLike {
  instances: DevInstanceLike[];
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/[/\\]+$/, '');
}

/**
 * Pick the dev-server instance that belongs to `cwd`. Prefers an exact-cwd
 * running instance; otherwise falls back to any single running instance so the
 * pane recovers a server started out-of-band.
 */
export function pickInstance(
  status: DevStatusLike | null | undefined,
  cwd: string,
): DevInstanceLike | null {
  const instances = status?.instances ?? [];
  const target = normalizeCwd(cwd);
  const exact = instances.find((i) => normalizeCwd(i.cwd) === target && i.state === 'running');
  if (exact) return exact;
  const running = instances.filter((i) => i.state === 'running');
  if (running.length === 1) return running[0]!;
  return instances.find((i) => normalizeCwd(i.cwd) === target) ?? null;
}

/** Map a resolved instance (+ a local "starting" latch) to the toolbar status. */
export function statusFromInstance(
  instance: DevInstanceLike | null,
  starting: boolean,
): PreviewStatus {
  if (starting) return 'starting';
  if (!instance) return 'idle';
  return instance.state === 'running' ? 'running' : 'dead';
}

/**
 * Frame width for a device preview inside the pane. `desktop` fills the pane
 * (0 = no cap); tablet/mobile clamp to a realistic device width so the app
 * renders at its responsive breakpoints, centered.
 */
export function frameWidth(device: PreviewDevice): number {
  switch (device) {
    case 'mobile':
      return 390;
    case 'tablet':
      return 834;
    default:
      return 0;
  }
}

/** True when the webview should mount (a running server with a loopback URL). */
export function canRenderWebview(status: PreviewStatus, url: string | undefined): boolean {
  if (status !== 'running' || !url) return false;
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}
