/**
 * Environnement et arrêt des processus enfants d'App Studio — tests RÉELS :
 * vrais `spawn` (un faux binaire `vite` qui imprime son environnement, un vrai
 * `npm run build`), vrai petit-enfant `sleep` pour l'arrêt de l'arbre.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildStudioChildEnv, killProcessTree } from '../src/main/studio/child-env';
import { runViteBuild } from '../src/main/studio/preview-probe-service';
import { runNpmBuild } from '../src/main/studio/site-export-service';

const SECRET = 'FAKE_SECRET_API_KEY';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!isAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !isAlive(pid);
}

function parseEnvLines(lines: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of lines) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

describe('buildStudioChildEnv', () => {
  it('garde la liste blanche, jette les clés de l’hôte, ajoute les variables du projet', () => {
    const env = buildStudioChildEnv(
      { VITE_PUBLIC_URL: 'http://127.0.0.1:5173' },
      {
        PATH: '/bin',
        HOME: '/h',
        HTTPS_PROXY: 'http://proxy:3128',
        [SECRET]: 'fuite',
        OPENAI_API_KEY: 'sk-x',
        JWT_SECRET: 'j',
        NODE_OPTIONS: '--require /x.js',
      },
    );
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/h',
      HTTPS_PROXY: 'http://proxy:3128',
      VITE_PUBLIC_URL: 'http://127.0.0.1:5173',
    });
  });

  it('les variables du projet l’emportent sur la liste blanche', () => {
    expect(buildStudioChildEnv({ NODE_ENV: 'production' }, { NODE_ENV: 'development' }).NODE_ENV).toBe('production');
  });
});

describe('killProcessTree (dépendances simulées)', () => {
  it('Windows : taskkill /T /F sur le pid', () => {
    const runTaskkill = vi.fn();
    const child = { pid: 1234, kill: vi.fn(() => true) };
    killProcessTree(child, { platform: 'win32', runTaskkill });
    expect(runTaskkill).toHaveBeenCalledWith(1234);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('POSIX : SIGTERM au groupe puis SIGKILL après le délai', async () => {
    const killPid = vi.fn();
    killProcessTree({ pid: 4321, kill: vi.fn(() => true) }, { platform: 'linux', killPid, graceMs: 10 });
    expect(killPid).toHaveBeenCalledWith(-4321, 'SIGTERM');
    await new Promise((r) => setTimeout(r, 40));
    expect(killPid).toHaveBeenCalledWith(-4321, 'SIGKILL');
  });
});

describe.skipIf(process.platform === 'win32')('processus réels (POSIX : faux binaire vite en script sh)', () => {
  let root: string;
  let grandchild: number | null = null;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-child-env-')));
    mkdirSync(path.join(root, 'node_modules', '.bin'), { recursive: true });
    process.env[SECRET] = 'ne-doit-pas-sortir';
  });

  afterEach(() => {
    delete process.env[SECRET];
    if (grandchild && isAlive(grandchild)) process.kill(grandchild, 'SIGKILL');
    grandchild = null;
    rmSync(root, { recursive: true, force: true });
  });

  function fakeVite(body: string): void {
    const bin = path.join(root, 'node_modules', '.bin', 'vite');
    writeFileSync(bin, `#!/bin/sh\n${body}\n`);
    chmodSync(bin, 0o755);
  }

  it('vite build : la clé de l’hôte n’arrive pas, PATH et les variables du projet oui', async () => {
    fakeVite('env');
    const res = await runViteBuild(root, { extraEnv: { PROJECT_TOKEN: 'du-projet' } });
    expect(res).not.toBeNull();
    const env = parseEnvLines(res!.output);
    expect(env[SECRET]).toBeUndefined();
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.PROJECT_TOKEN).toBe('du-projet');
    expect(env.NO_COLOR).toBe('1');
  });

  it('npm run build : la clé de l’hôte n’arrive pas, les variables du projet oui', async () => {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { build: 'node -e "console.log(JSON.stringify(process.env))"' } }),
    );
    const res = await runNpmBuild(root, { extraEnv: { PROJECT_TOKEN: 'du-projet' } });
    expect(res.code).toBe(0);
    const line = res.output.find((l) => l.startsWith('{'));
    expect(line).toBeDefined();
    const env = JSON.parse(line!) as Record<string, string>;
    expect(env[SECRET]).toBeUndefined();
    expect(env.PROJECT_TOKEN).toBe('du-projet');
    expect(env.CI).toBe('true');
  }, 60_000);

  it('vite build au délai dépassé : le petit-enfant meurt avec son parent', async () => {
    const pidFile = path.join(root, 'grandchild.pid');
    fakeVite(`sleep 300 >/dev/null 2>&1 &\necho $! > "${pidFile}"\nwait`);
    const res = await runViteBuild(root, { timeoutMs: 800 });
    expect(res?.output.join('\n')).toContain('timed out');
    expect(existsSync(pidFile)).toBe(true);
    grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(grandchild).toBeGreaterThan(0);
    expect(await waitDead(grandchild, 3000)).toBe(true);
  }, 20_000);

  it('npm run build au délai dépassé : le petit-enfant meurt aussi', async () => {
    const pidFile = path.join(root, 'grandchild.pid');
    writeFileSync(path.join(root, 'launch.sh'), `sleep 300 >/dev/null 2>&1 &\necho $! > "${pidFile}"\nwait\n`);
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'x', scripts: { build: 'sh launch.sh' } }));
    const res = await runNpmBuild(root, { timeoutMs: 2500 });
    expect(res.output.join('\n')).toContain('interrompu');
    expect(existsSync(pidFile)).toBe(true);
    grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(await waitDead(grandchild, 4000)).toBe(true);
  }, 30_000);
});
