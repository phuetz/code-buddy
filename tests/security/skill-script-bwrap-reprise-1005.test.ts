import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  confineSkillScriptSpawn,
  probeRuntimeSocketsFromSandbox,
  skillScriptConfinementStatus,
  buildSkillScriptPolicy,
} from '../../src/security/native-sandbox.js';

/**
 * Reprise C2-PROTO-1005 : socket du moteur de conteneurs de l'hôte, lien symbolique
 * comme répertoire de travail, canonisation en échec.
 */
const bwrapOk = process.platform === 'linux' && skillScriptConfinementStatus().available;
const tmp: string[] = [];
function mk(prefix: string, base = os.tmpdir()): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(base, prefix)));
  tmp.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const run = (res: ReturnType<typeof confineSkillScriptSpawn>) => {
  if (!res.ok) throw new Error(res.error);
  return spawnSync(res.file, res.args, { env: res.env, encoding: 'utf8', timeout: 20000 });
};

describe('socket du moteur de conteneurs', () => {
  const hostSocket = ['/var/run/docker.sock', '/run/docker.sock', '/run/containerd/containerd.sock'].find((s) => fs.existsSync(s));

  it.skipIf(!bwrapOk || !hostSocket)('un script confiné ne voit plus le socket de l\'hôte', () => {
    const ws = mk('c2r-ws-');
    const res = confineSkillScriptSpawn({
      file: '/bin/sh',
      args: ['-c', `if [ -S ${hostSocket} ]; then echo LEAK; else echo HIDDEN; fi; if [ -S /var/run/docker.sock ]; then echo LEAK; fi`],
      cwd: ws,
      env: { PATH: process.env.PATH },
      skillConfinement: { skillDirs: [] },
    });
    // ÉCHOUE sur l'ancienne logique : « LEAK » (--ro-bind / / laissait /run visible).
    expect(run(res).stdout).toBe('HIDDEN\n');
  });

  it('refuse de lancer le script si la sonde voit encore un socket connu', () => {
    const ws = mk('c2r-ws-');
    const res = confineSkillScriptSpawn(
      { file: '/bin/true', args: [], cwd: ws, env: {}, skillConfinement: { skillDirs: [] } },
      {
        // bwrap « utilisable » simulé, sonde qui renvoie un socket visible
        capabilities: { recommended: 'bwrap', reason: 'x', bwrapPath: '/usr/bin/bwrap', bwrapUsable: true, bwrapVersion: '0.9.0' } as never,
        platform: 'linux',
        existsSync: (p: string) => p === '/var/run/docker.sock' || fs.existsSync(p),
        spawnSync: (() => ({ status: 0, stdout: '/var/run/docker.sock\n', stderr: '', error: undefined })) as never,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/container runtime socket is reachable/);
  });

  it('refuse aussi quand la sonde ne peut pas s\'exécuter', () => {
    const ws = mk('c2r-ws-');
    const policy = buildSkillScriptPolicy(ws, [], { existsSync: (p: string) => p === '/var/run/docker.sock' || fs.existsSync(p) });
    if ('error' in policy) throw new Error(policy.error);
    const probe = probeRuntimeSocketsFromSandbox('/usr/bin/bwrap', policy, {
      existsSync: (p: string) => p === '/var/run/docker.sock' || fs.existsSync(p),
      spawnSync: (() => ({ status: 1, stdout: '', stderr: '', error: undefined })) as never,
    });
    expect('error' in probe).toBe(true);
  });
});

describe('répertoire de travail et canonisation', () => {
  it.skipIf(!bwrapOk)('un cwd qui est un lien vers la maison ne rend pas la maison inscriptible', () => {
    const fakeHome = mk('c2r-home-', '/var/tmp');
    fs.writeFileSync(path.join(fakeHome, 'keep.txt'), 'x');
    const link = path.join(os.tmpdir(), `c2r-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(fakeHome, link);
    tmp.push(link);
    const res = confineSkillScriptSpawn(
      { file: '/bin/sh', args: ['-c', 'echo pwned > from-link.txt 2>/dev/null; echo done'], cwd: link, env: { PATH: process.env.PATH }, skillConfinement: { skillDirs: [] } },
      { homedir: () => fakeHome },
    );
    run(res);
    // ÉCHOUE sur l'ancienne logique : le fichier est créé dans la « maison » via le lien.
    expect(fs.existsSync(path.join(fakeHome, 'from-link.txt'))).toBe(false);
  });

  it('refuse quand la canonisation échoue', () => {
    const res = buildSkillScriptPolicy('/tmp/c2r-does-not-exist-' + process.pid, []);
    expect('error' in res).toBe(true);
    if ('error' in res) expect(res.error).toMatch(/canonicalize/);
  });

  it('un dossier de skill qui est un lien est canonisé', () => {
    const real = mk('c2r-skill-real-');
    const link = path.join(os.tmpdir(), `c2r-skill-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(real, link);
    tmp.push(link);
    const ws = mk('c2r-ws-');
    const policy = buildSkillScriptPolicy(ws, [link]);
    if ('error' in policy) throw new Error(policy.error);
    expect(policy.readOnlyBinds).toContain(real);
    expect(policy.readOnlyBinds).not.toContain(link);
  });
});
