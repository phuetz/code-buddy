/**
 * Mermaid render — turn a Mermaid diagram source into a PNG via the
 * `mmdc` (mermaid-cli) binary, wired to run headless (a generated Puppeteer
 * config with `--no-sandbox` and an auto-resolved Chromium). Used by the Video
 * Studio to render "diagram" scenes; fail-open (returns null when mmdc/Chromium
 * are unavailable, so the caller falls back to an animated text card).
 *
 * @module tools/video/mermaid-render
 */

import { spawn as realSpawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export interface MermaidRenderDeps {
  spawn?: typeof realSpawn;
  mmdcBin?: string;
  env?: NodeJS.ProcessEnv;
  /** Explicit Chromium path (else CODEBUDDY_CHROMIUM_PATH / Playwright cache / PATH). */
  chromiumPath?: string;
  theme?: string;
  background?: string;
  timeoutMs?: number;
}

/** Puppeteer launch config JSON for mmdc (pure). */
export function buildPuppeteerConfig(chromiumPath?: string): string {
  const cfg: Record<string, unknown> = {
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  };
  if (chromiumPath) cfg.executablePath = chromiumPath;
  return JSON.stringify(cfg);
}

/** mmdc argv (pure). `-s 2` renders at 2× for a crisp 1080p framing. */
export function buildMmdcArgs(
  inPath: string,
  outPath: string,
  cfgPath: string,
  theme = 'dark',
  background = '#0e1626'
): string[] {
  return ['-i', inPath, '-o', outPath, '-t', theme, '-b', background, '-s', '2', '-p', cfgPath];
}

function run(
  spawn: typeof realSpawn,
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (c: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(c);
    };
    let child: ReturnType<typeof realSpawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      done(null);
      return;
    }
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      done(null);
    }, timeoutMs);
    child.on('error', () => done(null));
    child.on('close', (c) => done(c));
  });
}

/** Resolve a Chromium executable: env → Playwright cache → null (mmdc's own then). */
async function resolveChromium(env: NodeJS.ProcessEnv, explicit?: string): Promise<string | null> {
  const fromEnv = explicit ?? env.CODEBUDDY_CHROMIUM_PATH ?? env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) return fromEnv;
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = (await fs.readdir(base))
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const d of dirs) {
      const p = path.join(base, d, 'chrome-linux64', 'chrome');
      try {
        await fs.access(p);
        return p;
      } catch {
        /* next */
      }
    }
  } catch {
    /* no cache */
  }
  return null;
}

/**
 * Render `mermaid` to `outPath` (PNG). Returns the path on success, else null
 * (mmdc missing, no Chromium, or render error) so the caller degrades to a card.
 */
export async function renderMermaidPng(
  mermaid: string,
  outPath: string,
  deps: MermaidRenderDeps = {}
): Promise<string | null> {
  const spawn = deps.spawn ?? realSpawn;
  const env = deps.env ?? process.env;
  const mmdcBin = deps.mmdcBin ?? env.CODEBUDDY_MMDC_BIN ?? 'mmdc';
  const timeoutMs = deps.timeoutMs ?? 90_000;
  if ((await run(spawn, mmdcBin, ['--version'], 15_000)) !== 0) return null;

  const chromium = await resolveChromium(env, deps.chromiumPath);
  const inPath = `${outPath}.mmd`;
  const cfgPath = `${outPath}.pptr.json`;
  try {
    await fs.writeFile(inPath, mermaid.trim());
    await fs.writeFile(cfgPath, buildPuppeteerConfig(chromium ?? undefined));
  } catch {
    return null;
  }
  const code = await run(
    spawn,
    mmdcBin,
    buildMmdcArgs(inPath, outPath, cfgPath, deps.theme ?? 'dark', deps.background ?? '#0e1626'),
    timeoutMs
  );
  await Promise.all([inPath, cfgPath].map((f) => fs.rm(f, { force: true }).catch(() => undefined)));
  if (code !== 0) return null;
  try {
    await fs.access(outPath);
    return outPath;
  } catch {
    return null;
  }
}
